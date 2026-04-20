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
  const page = stagehand.context.pages()[0];

  let sessionUrl = "";

  try {
    sessionUrl = `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`;

    // =========================
    // STEP 1 - LOGIN
    // =========================
    await page.goto("https://misterroofrepair.sera.tech/admins/login");

    await page.locator('input[type="email"]').fill(process.env.SERA_EMAIL || "");
    await page.locator('input[type="password"]').fill(process.env.SERA_PASSWORD || "");

    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(5000);

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
      };
    }

    // =========================
    // STEP 3 - CLICK CUSTOMER
    // =========================
    const clicked = await page.evaluate((name) => {
      const el = Array.from(document.querySelectorAll("a"))
        .find((e) => e.textContent?.includes(name)) as HTMLElement | null;

      if (el) {
        el.click();
        return true;
      }
      return false;
    }, data.customerName);

    if (!clicked) throw new Error("Customer click failed");

    await page.waitForTimeout(5000);

    // =========================
    // STEP 4 - NOTES
    // =========================
    const notesUrl = page.url() + "?tab=c_Notes";
    await page.goto(notesUrl);

    await page.waitForTimeout(5000);

    // =========================
    // STEP 5 - ADD NOTE
    // =========================
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find((e) => e.textContent?.includes("Add Note")) as HTMLElement;

      if (btn) btn.click();
    });

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
        .find((e) => e.textContent?.includes("Save")) as HTMLElement;

      if (save) save.click();
    });

    await page.waitForTimeout(5000);

    await stagehand.close();

    return {
      success: true,
      message: "Inspection report added to Sera successfully",
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
      if (job) {
        job.status = result.success ? "done" : "failed";
        job.result = result;
      }
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "failed";
        job.error = err.message;
      }
    });

  res.json({
    jobId,
    status: "running",
  });
});

// =============================================================================
// POLLING
// =============================================================================
app.get("/job-status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status === "running") {
    return res.json({
      jobId: job.id,
      status: "running",
    });
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
  res.json({
    status: "ok",
    service: "sera-inspection-server",
  });
});

// =============================================================================
// START
// =============================================================================
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`🚀 Sera server running on port ${PORT}`);
  console.log(`POST /run-sera-inspection`);
  console.log(`GET  /job-status/:jobId`);
  console.log(`GET  /health`);
});
