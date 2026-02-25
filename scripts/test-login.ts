/**
 * Quick test: Launch a stealth Chrome browser, navigate to Target login.
 * You log in manually, close the browser, then we verify the session was saved.
 * 
 * Run: npx tsx scripts/test-login.ts
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";

chromium.use(StealthPlugin());

const PROFILE_DIR = path.join(process.cwd(), ".browser-profiles", "test-target");

async function main() {
  // Ensure profile dir exists
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  console.log("=== Step 1: Launch browser ===");
  console.log(`Profile dir: ${PROFILE_DIR}`);
  console.log("A Chrome window will open. Log into Target, then CLOSE the browser.\n");

  // Launch headed browser with persistent profile
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome", // Uses your installed Chrome
    viewport: { width: 1280, height: 720 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://www.target.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  console.log("Browser opened to Target login page.");
  console.log("→ Log in with your credentials");
  console.log("→ Handle MFA if prompted");
  console.log("→ Close the browser window when you see your account\n");

  // Wait for user to close the browser
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });

  console.log("\n=== Step 2: Verify session ===");
  console.log("Relaunching headless to check if login persisted...\n");

  // Relaunch headless with same profile
  const ctx2 = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    channel: "chrome",
    viewport: { width: 1280, height: 720 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  const page2 = ctx2.pages()[0] || await ctx2.newPage();
  await page2.goto("https://www.target.com/account", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });

  await new Promise((r) => setTimeout(r, 3000));
  const url = page2.url();
  const text = await page2.innerText("body").catch(() => "");

  if (url.includes("/login") || url.includes("/sign-in")) {
    console.log("❌ NOT logged in. The session didn't persist.");
    console.log(`   URL: ${url}`);
  } else {
    console.log("✅ LOGGED IN! Session persisted across browser restarts.");
    console.log(`   URL: ${url}`);

    // Try to find username/account name
    const hiMatch = text.match(/Hi,?\s+(\w+)/i);
    if (hiMatch) {
      console.log(`   Logged in as: ${hiMatch[1]}`);
    }
  }

  await ctx2.close();
  console.log("\nDone. Profile saved at:", PROFILE_DIR);
}

main().catch(console.error);