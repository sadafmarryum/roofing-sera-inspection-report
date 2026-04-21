import { Stagehand } from "@browserbasehq/stagehand";
import express from "express";

// =============================================================================
// JOB STORE
// =============================================================================
type JobStatus = "running" | "done" | "failed";

interface Job {
  id: string;
  status: JobStatus;
  startedAt: number;
  result?: any;
  error?: string;
}

const jobs = new Map<string, Job>();

function makeJobId() {
  return "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// =============================================================================
// EXPRESS APP
// =============================================================================
const app = express();
app.use(express.json());

// =============================================================================
// CORE AUTOMATION
// =============================================================================
// async function clickAddNote(page: any): Promise<void> {
//   // First: debug what spans exist
//   const debug = await page.evaluate(() => {
//     return Array.from(document.querySelectorAll("span")).map(s => ({
//       text: (s.textContent || "").trim(),
//       className: s.className,
//       width: s.getBoundingClientRect().width,
//       height: s.getBoundingClientRect().height,
//     }));
//   });
//   console.log("All spans:", JSON.stringify(debug, null, 2));

//   const coords = await page.evaluate(() => {
//     // Try 1: find button that contains "Add Note" text anywhere
//     const buttons = Array.from(document.querySelectorAll("button"));
//     for (const btn of buttons) {
//       const text = (btn.textContent || "").replace(/\s+/g, " ").trim();
//       if (text.includes("Add Note")) {
//         (btn as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
//         const rect = btn.getBoundingClientRect();
//         console.log("Found button:", text, rect);
//         if (rect.width > 0 && rect.height > 0) {
//           return {
//             x: Math.round(rect.left + rect.width / 2),
//             y: Math.round(rect.top + rect.height / 2),
//             found: true,
//             method: "button text match"
//           };
//         }
//       }
//     }
//     return { x: 0, y: 0, found: false, method: "none" };
//   });

//   console.log("clickAddNote coords:", JSON.stringify(coords));

//   if (!coords.found) throw new Error("Add Note button not found");

//   await page.waitForTimeout(500);

//   await page.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x, y: coords.y, button: "none" });
//   await page.sendCDP("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
//   await page.waitForTimeout(80);
//   await page.sendCDP("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
// }

// async function clickAddNote(page: any): Promise<void> {
//   await page.locator("button", { hasText: "Add Note" }).first().click();
// }

 // await page.locator("i.tag-menu-btn").first().click();
 //        await page.waitForTimeout(1000);

async function runSeraTask(data: {
  customerName: string;
  formattedReport: string;
  jobNimbusUrl?: string;
  companyCamUrl?: string;
}) {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: {
      modelName: "google/gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY || "",
    },
  });

  await stagehand.init();
  // const page = stagehand.context.pages()[0];
  const page = stagehand.context.activePage()!;

  let sessionUrl = "";

  try {
    sessionUrl = `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`;

    // =========================
    // STEP 1 - LOGIN (FIXED)
    // =========================
    console.log("\n[1] Login started");

    await page.goto("https://misterroofrepair.sera.tech/admins/login");
    await page.waitForTimeout(3000);

    const email = process.env.SERA_EMAIL || "";
    const password = process.env.SERA_PASSWORD || "";

    const currentUrl = await page.url();

    if (currentUrl.includes("/login")) {
      console.log("    → Filling credentials");

      // FIXED SELECTORS (no crash)
      const emailInput = await page.locator("input").first();
      const passwordInput = await page.locator('input[type="password"]').first();

      await emailInput.fill(email);
      await passwordInput.fill(password);

      await page.waitForTimeout(500);

      // click login safely
      const clicked = await page.evaluate(() => {
        const btn = Array.from(
          document.querySelectorAll("button, input[type='submit']")
        ).find(el =>
          el.textContent?.toLowerCase().includes("login") ||
          el.textContent?.toLowerCase().includes("sign in")
        ) as HTMLElement | null;

        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        await page.locator("button, input[type='submit']").first().click();
      }

      // wait redirect
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);
        const url = await page.url();
        if (!url.includes("/login")) break;
        if (i === 29) throw new Error("Login failed");
      }

      console.log("    ✅ Login success");
    }

    // =========================
    // STEP 2 - SEARCH CUSTOMER
    // =========================
    const searchUrl = `https://misterroofrepair.sera.tech/customers?name=${encodeURIComponent(
      data.customerName
    )}`;

    await page.goto(searchUrl);
    await page.waitForTimeout(5000);

    const customerExists = await page.evaluate(() => {
      return !document.body.innerText.includes("No customers found");
    });

    if (!customerExists) {
      return {
        success: false,
        message: `No customer found in Sera for ${data.customerName}`,
        customerName: data.customerName,
        sessionUrl,
      };
    }

    // =========================
    // STEP 3 - CLICK CUSTOMER
    // =========================
    const clickedCustomer = await page.evaluate((name) => {
      const el = Array.from(document.querySelectorAll("a"))
        .find(e => e.textContent?.includes(name)) as HTMLElement | null;

      if (el) {
        el.click();
        return true;
      }
      return false;
    }, data.customerName);

    if (!clickedCustomer) throw new Error("Customer click failed");

    await page.waitForTimeout(5000);

    // =========================
    // STEP 4 - NOTES
    // =========================
    await page.goto(page.url() + "?tab=c_Notes");
    await page.waitForTimeout(5000);

    // =========================
    // STEP 5 - ADD NOTE
   // =========================
    // await clickAddNote(page);
    await page.locator("i.fa-plus").first().click();
    await page.waitForTimeout(3000);

    // =========================
    // STEP 6 - FILL NOTE
    // =========================
    await page.evaluate((note) => {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
      if (textarea) textarea.value = note;
    }, data.formattedReport);

    await page.waitForTimeout(1000);

    // =========================
    // STEP 7 - SAVE
    // =========================
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll("button"))
        .find(e => e.textContent?.includes("Save")) as HTMLElement;

      save?.click();
    });

    await page.waitForTimeout(5000);

    await stagehand.close();

    return {
      success: true,
      message: "Inspection report added successfully",
      customerName: data.customerName,
      jobNimbusUrl: data.jobNimbusUrl || null,
      companyCamUrl: data.companyCamUrl || null,
      sessionUrl,
    };

  } catch (err: any) {
    await stagehand.close();

    return {
      success: false,
      message: err.message,
      customerName: data.customerName,
      sessionUrl,
    };
  }
}

// =============================================================================
// START JOB
// =============================================================================
app.post("/run-sera-inspection", (req, res) => {
  const jobId = makeJobId();

  jobs.set(jobId, {
    id: jobId,
    status: "running",
    startedAt: Date.now(),
  });

  runSeraTask(req.body)
    .then((result) => {
      const job = jobs.get(jobId);
      if (!job) return;

      jobs.set(jobId, {
        ...job,
        status: result.success ? "done" : "failed",
        result,
      });
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (!job) return;

      jobs.set(jobId, {
        ...job,
        status: "failed",
        error: err.message,
      });
    });

  res.json({ jobId, status: "running" });
});

// =============================================================================
// POLLING
// =============================================================================
app.get("/job-status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) return res.status(404).json({ error: "Job not found" });

  if (job.status === "running") {
    return res.json({ jobId: job.id, status: "running" });
  }

  const response = {
    jobId: job.id,
    status: job.status,
    ...job.result,
    error: job.error,
  };

  jobs.delete(job.id);
  res.json(response);
});

// =============================================================================
// HEALTH
// =============================================================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sera-inspection-server" });
});

// =============================================================================
// START
// =============================================================================
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`🚀 Sera server running on port ${PORT}`);
});
