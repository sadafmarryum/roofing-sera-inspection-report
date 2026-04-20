// sera-inspection-server.ts

import { Stagehand } from "@browserbasehq/stagehand";
import express from "express";

const app = express();
app.use(express.json());

async function runSeraTask(data: {
  customerName: string;
  formattedNote: string;
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

  try {
    // =========================
    // STEP 1 - LOGIN
    // =========================
    await page.goto("https://misterroofrepair.sera.tech/admins/login");

    await page.locator('input[type="email"]').fill(process.env.SERA_EMAIL!);
    await page.locator('input[type="password"]').fill(process.env.SERA_PASSWORD!);

    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(5000);

    // =========================
    // STEP 2 - SEARCH CUSTOMER
    // =========================
    const searchUrl = `https://misterroofrepair.sera.tech/customers?name=${encodeURIComponent(data.customerName)}`;
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
        .find(e => e.textContent?.includes(name)) as HTMLElement | null;
      if (el) {
        el.click();
        return true;
      }
      return false;
    }, data.customerName);

    await page.waitForTimeout(5000);

    // =========================
    // STEP 4 - OPEN NOTES TAB
    // =========================
    const notesUrl = page.url() + "?tab=c_Notes";
    await page.goto(notesUrl);

    await page.waitForTimeout(5000);

    // =========================
    // STEP 5 - CLICK ADD NOTE
    // =========================
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(e => e.textContent?.includes("Add Note")) as HTMLElement;
      if (btn) btn.click();
    });

    await page.waitForTimeout(3000);

    // =========================
    // STEP 6 - PASTE NOTE
    // =========================
    await page.evaluate((note) => {
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
      if (textarea) textarea.value = note;
    }, data.formattedNote);

    await page.waitForTimeout(1000);

    // CLICK SAVE
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll("button"))
        .find(e => e.textContent?.includes("Save")) as HTMLElement;
      if (save) save.click();
    });

    await page.waitForTimeout(5000);

    await stagehand.close();

    return {
      success: true,
      message: "Inspection report added to Sera successfully",
    };

  } catch (err: any) {
    await stagehand.close();
    return {
      success: false,
      message: err.message,
    };
  }
}

// =========================
// API ENDPOINT
// =========================
app.post("/run-sera-inspection", async (req, res) => {
  const result = await runSeraTask(req.body);
  res.json(result);
});

app.listen(3001, () => {
  console.log("Sera automation server running on port 3001");
});