import { Stagehand } from "@browserbasehq/stagehand";
import {
  getActivePlaybook,
  savePlaybook,
  recordPlaybookSuccess,
  recordPlaybookFailure,
  replayPlaybook,
  recordAgentCheckout,
} from "./playbook-engine";

// -- Types --

export interface AutoBuyConfig {
  product_url: string;
  product_name: string;
  max_price: number | null;
  quantity: number;
  retailer: string;
  username: string;
  password: string;
  cvv?: string;
  browserbase_context_id?: string | null;
}

export interface AutoBuyResult {
  status: "success" | "failed" | "carted" | "out_of_stock";
  order_number?: string;
  total_price?: number;
  failure_reason?: string;
  steps_completed: string[];
  used_playbook?: boolean;
}

// Mobile config
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// -- Main Entry --

export async function executeAutoBuy(config: AutoBuyConfig): Promise<AutoBuyResult> {
  const steps: string[] = [];
  let stagehand: Stagehand | null = null;

  try {
    // Step 1: Create browser session
    steps.push("Creating browser session");
    const { stagehandInstance, page } = await createBrowserSession(config);
    stagehand = stagehandInstance;
    steps.push("Browser session created");

    // Step 2: Verify login
    steps.push("Checking login session");
    const loginValid = await checkLogin(page);
    if (!loginValid) {
      return {
        status: "failed",
        failure_reason: "Login session expired. Please reconnect in Credentials.",
        steps_completed: steps,
      };
    }
    steps.push("Login session valid");

    // Step 3: Try playbook-first approach
    const playbook = await getActivePlaybook(config.retailer);

    if (playbook) {
      console.log(`[AutoBuy] Found playbook v${playbook.version} for ${config.retailer} (${playbook.success_count} successes)`);
      steps.push(`Using playbook v${playbook.version}`);

      const variables: Record<string, string> = {
        product_url: config.product_url,
        cvv: config.cvv || "",
      };

      const replayResult = await replayPlaybook(page, playbook, variables);

      if (replayResult.success) {
        steps.push(...replayResult.steps_completed);
        const confirmation = await extractConfirmation(page);

        if (confirmation.confirmed) {
          await recordPlaybookSuccess(playbook.id);
          steps.push("Order confirmed via playbook!");
          return {
            status: "success",
            order_number: confirmation.orderNumber,
            total_price: confirmation.totalPrice,
            steps_completed: steps,
            used_playbook: true,
          };
        } else {
          console.log("[AutoBuy] Playbook completed but no confirmation found");
          steps.push("Playbook finished but order not confirmed — falling back to agent");
        }
      } else {
        console.log(`[AutoBuy] Playbook failed at step ${replayResult.failedAt}: ${replayResult.error}`);
        steps.push(`Playbook failed: ${replayResult.error}`);
        await recordPlaybookFailure(playbook.id);
      }

      steps.push("Falling back to AI agent");
    } else {
      console.log(`[AutoBuy] No playbook for ${config.retailer} — using AI agent`);
      steps.push("No playbook — using AI agent");
    }

    // Step 4: AI Agent flow (fallback or first run)
    const agentResult = await runAgentFlow(stagehand, page, config, steps);

    // Step 5: If agent succeeded, record and save the playbook
    if (agentResult.status === "success") {
      try {
        console.log("[AutoBuy] Saving playbook from successful agent run");
        const { steps: playbookSteps } = await recordAgentCheckout(stagehand, page, { cvv: config.cvv });
        await savePlaybook(config.retailer, playbookSteps);
        steps.push("Playbook saved for future runs");
      } catch (err: any) {
        console.log("[AutoBuy] Failed to save playbook:", err.message);
      }
    }

    return agentResult;

  } catch (error: any) {
    console.error("[AutoBuy] Fatal error:", error);
    return {
      status: "failed",
      failure_reason: error.message || String(error),
      steps_completed: steps,
    };
  } finally {
    if (stagehand) {
      try { await stagehand.close(); } catch {}
    }
  }
}

// -- Browser Session --

async function createBrowserSession(config: AutoBuyConfig): Promise<{
  stagehandInstance: Stagehand;
  page: any;
}> {
  let sessionId: string | undefined;

  if (config.browserbase_context_id) {
    // Pre-create session with context + mobile settings via Browserbase API
    const BB_API = "https://api.browserbase.com/v1";
    const res = await fetch(`${BB_API}/sessions`, {
      method: "POST",
      headers: {
        "x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        browserSettings: {
          context: { id: config.browserbase_context_id, persist: true },
          solveCaptchas: true,
          viewport: MOBILE_VIEWPORT,
        },
      }),
    });
    if (res.ok) {
      const session = await res.json();
      sessionId = session.id;
      console.log("[AutoBuy] Pre-created session with context:", sessionId);
    }
  }

  const opts: any = {
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    verbose: 0,
    logger: () => {},
    model: {
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
  };

  if (sessionId) {
    // Connect to the pre-created session — don't pass session create params
    opts.browserbaseSessionID = sessionId;
  } else {
    // No context — create a new session with mobile settings
    opts.browserbaseSessionCreateParams = {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      browserSettings: {
        viewport: MOBILE_VIEWPORT,
      },
    };
  }

  const stagehandInstance = new Stagehand(opts);
  await stagehandInstance.init();
  const page = stagehandInstance.context.pages()[0];

  return { stagehandInstance, page };
}

// -- Login Check --

async function checkLogin(page: any): Promise<boolean> {
  await page.goto("https://www.target.com/account", {
    waitUntil: "domcontentloaded",
    timeoutMs: 15000,
  });
  await delay(2000, 2500);
  const url = page.url();
  return !url.includes("/login") && !url.includes("/sign-in");
}

// -- AI Agent Flow (fallback) --

async function runAgentFlow(
  stagehand: Stagehand,
  page: any,
  config: AutoBuyConfig,
  steps: string[]
): Promise<AutoBuyResult> {
  try {
    // Navigate to product
    steps.push("Navigating to product");
    await page.goto(config.product_url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
    await delay(1500, 2000);

    // Quick out-of-stock check via page text
    const bodyText: string = await page.locator("body").innerText().catch(() => "");
    const oosPatterns = [/out of stock/i, /sold out/i, /temporarily unavailable/i, /currently unavailable/i];
    if (oosPatterns.some((p) => p.test(bodyText))) {
      return {
        status: "out_of_stock",
        failure_reason: "Product is out of stock",
        steps_completed: steps,
      };
    }

    // Price check
    if (config.max_price) {
      const priceMatch = bodyText.match(/\$(\d+\.?\d*)/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[1]);
        if (price > config.max_price) {
          return {
            status: "failed",
            failure_reason: `Price $${price} exceeds max $${config.max_price}`,
            steps_completed: steps,
          };
        }
      }
    }

    // Add to cart — try direct selectors first, then AI
    steps.push("Adding to cart");
    let addedToCart = false;

    const cartSelectors = [
      'button[data-test="addToCartButton"]',
      'button[data-test="shipItButton"]',
      '[data-test="orderPickupButton"]',
      'button:has-text("Add to cart")',
    ];

    for (const sel of cartSelectors) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ timeout: 2000 });
        await el.click();
        addedToCart = true;
        console.log(`[AutoBuy] Clicked add to cart via: ${sel}`);
        break;
      } catch {
        continue;
      }
    }

    if (!addedToCart) {
      try {
        await stagehand.act("click the 'Add to cart' button");
        addedToCart = true;
        console.log("[AutoBuy] Clicked add to cart via AI");
      } catch {}
    }

    if (!addedToCart) {
      return {
        status: "out_of_stock",
        failure_reason: "Could not find Add to cart button",
        steps_completed: steps,
      };
    }

    await delay(2000, 2500);

    // Dismiss popups
    for (const sel of ['button:has-text("No thanks")', 'button:has-text("View cart & check out")', 'button[aria-label="close"]']) {
      try {
        await page.locator(sel).first().click({ timeout: 1500 });
        break;
      } catch {}
    }

    steps.push("Added to cart");
    steps.push("Starting checkout");

    // Go to cart
    await page.goto("https://www.target.com/cart", { waitUntil: "domcontentloaded", timeoutMs: 15000 });
    await delay(1500, 2000);

    // Run checkout agent
    const cvvInstruction = config.cvv
      ? `6. If a "Confirm CVV" dialog appears, type the CVV code: ${config.cvv} into the CVV field and click "Confirm"`
      : `6. If a "Confirm CVV" dialog appears, STOP — no CVV was provided`;

    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    });

    await agent.execute({
      instruction: `Complete Target checkout on this cart page:

1. Click "Check out" or "Checkout" button
2. If shipping/delivery step appears, click "Save and continue"
3. If payment step appears, click "Save and continue" (use saved payment)
4. Click "Place your order"
5. Wait for order confirmation
${cvvInstruction}

RULES: Do NOT change address or payment. Click "Place your order" when visible. STOP on confirmation, login, or error. Ignore promos/upsells.`,
      maxSteps: 20,
    });

    steps.push("Checkout agent completed");
    await delay(3000, 4000);

    // Check confirmation
    const confirmation = await extractConfirmation(page);
    if (confirmation.confirmed) {
      steps.push("Order confirmed!");
      return {
        status: "success",
        order_number: confirmation.orderNumber,
        total_price: confirmation.totalPrice,
        steps_completed: steps,
        used_playbook: false,
      };
    }

    const finalUrl = page.url();
    if (finalUrl.includes("/login")) {
      return { status: "carted", failure_reason: "Session expired during checkout.", steps_completed: steps };
    }

    return {
      status: "carted",
      failure_reason: `Checkout did not complete. Final URL: ${finalUrl}`,
      steps_completed: steps,
    };

  } catch (error: any) {
    return {
      status: "failed",
      failure_reason: `Agent error: ${error.message}`,
      steps_completed: steps,
    };
  }
}

// -- Confirmation Extraction --

async function extractConfirmation(
  page: any
): Promise<{ confirmed: boolean; orderNumber?: string; totalPrice?: number }> {
  const finalUrl = page.url();

  // Fast: URL check
  if (finalUrl.includes("order-confirmation")) {
    const text: string = await page.locator("body").innerText().catch(() => "");
    const orderMatch = text.match(/order\s*#?\s*(\d{5,})/i) || text.match(/confirmation\s*#?\s*(\d{5,})/i);
    const totalMatch = text.match(/total[:\s]*\$(\d+\.?\d*)/i);
    return {
      confirmed: true,
      orderNumber: orderMatch?.[1],
      totalPrice: totalMatch ? parseFloat(totalMatch[1]) : undefined,
    };
  }

  // Check page text for confirmation keywords
  const text: string = await page.locator("body").innerText().catch(() => "");
  const confirmPatterns = [/thanks for your order/i, /order has been placed/i, /order confirmed/i, /order\s*#\s*\d{5,}/i];
  if (confirmPatterns.some((p) => p.test(text))) {
    const orderMatch = text.match(/order\s*#?\s*(\d{5,})/i) || text.match(/confirmation\s*#?\s*(\d{5,})/i);
    const totalMatch = text.match(/total[:\s]*\$(\d+\.?\d*)/i);
    return {
      confirmed: true,
      orderNumber: orderMatch?.[1],
      totalPrice: totalMatch ? parseFloat(totalMatch[1]) : undefined,
    };
  }

  return { confirmed: false };
}

// -- Helpers --

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}