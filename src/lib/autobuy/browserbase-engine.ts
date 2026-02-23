import { chromium, type Page, type Browser } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface AutoBuyConfig {
  product_url: string;
  product_name: string;
  max_price: number | null;
  quantity: number;
  retailer: string;
  username: string;
  password: string;
}

export interface AutoBuyResult {
  status: "success" | "failed" | "carted" | "out_of_stock";
  order_number?: string;
  total_price?: number;
  failure_reason?: string;
  steps_completed: string[];
  screenshot_base64?: string;
}

/**
 * Execute auto-buy via Browserbase cloud browser.
 * Connects to a remote Chromium instance, logs in, adds to cart, and checks out.
 */
export async function executeAutoBuy(config: AutoBuyConfig): Promise<AutoBuyResult> {
  const steps: string[] = [];
  let browser: Browser | null = null;

  try {
    // Step 1: Create Browserbase session
    steps.push("Creating browser session");
    const sessionRes = await fetch("https://www.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        browserSettings: {
          fingerprint: {
            browsers: ["chrome"],
            devices: ["desktop"],
            operatingSystems: ["windows"],
          },
        },
      }),
    });

    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      throw new Error(`Browserbase session creation failed: ${sessionRes.status} ${errText}`);
    }

    const session = await sessionRes.json();
    const connectUrl = `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${session.id}`;

    // Step 2: Connect Playwright to the cloud browser
    steps.push("Connecting to cloud browser");
    browser = await chromium.connectOverCDP(connectUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0];

    // Set reasonable timeout
    page.setDefaultTimeout(15000);

    // Step 3: Login to Target
    steps.push("Logging into Target");
    const loginSuccess = await performTargetLogin(page, config.username, config.password);

    if (!loginSuccess.success) {
      return {
        status: "failed",
        failure_reason: loginSuccess.reason || "Login failed",
        steps_completed: steps,
        screenshot_base64: await safeScreenshot(page),
      };
    }
    steps.push("Login successful");

    // Step 4: Navigate to product page
    steps.push("Navigating to product page");
    await page.goto(config.product_url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await delay(2000, 4000);

    // Step 5: Add to cart
    steps.push("Adding to cart");
    const cartResult = await addToCart(page, config);

    if (!cartResult.success) {
      return {
        status: cartResult.out_of_stock ? "out_of_stock" : "failed",
        failure_reason: cartResult.reason,
        steps_completed: steps,
        screenshot_base64: await safeScreenshot(page),
      };
    }
    steps.push("Added to cart");

    // Step 6: Checkout
    steps.push("Starting checkout");
    const checkoutResult = await performCheckout(page, config);

    return {
      ...checkoutResult,
      steps_completed: steps,
      screenshot_base64: await safeScreenshot(page),
    };
  } catch (error: any) {
    return {
      status: "failed",
      failure_reason: error.message || String(error),
      steps_completed: steps,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

// -- Target Login --

async function performTargetLogin(
  page: Page,
  username: string,
  password: string
): Promise<{ success: boolean; reason?: string }> {
  try {
    await page.goto("https://www.target.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await delay(2000, 3000);

    // Take screenshot and use AI to find login fields
    const screenshot = await page.screenshot({ type: "png" });
    const b64 = screenshot.toString("base64");

    const loginFields = await aiVision<{
      has_email_field: boolean;
      has_password_field: boolean;
      is_two_step: boolean;
      is_blocked: boolean;
      blocked_reason: string | null;
    }>(
      b64,
      `Analyze this Target.com login page screenshot.
Return JSON:
- "has_email_field": boolean - is there an email/username input visible?
- "has_password_field": boolean - is there a password input visible?
- "is_two_step": boolean - does Target split login into email-first then password?
- "is_blocked": boolean - is there a CAPTCHA, bot detection, or access denied message?
- "blocked_reason": string or null`
    );

    if (loginFields.is_blocked) {
      return { success: false, reason: `Blocked: ${loginFields.blocked_reason}` };
    }

    // Target uses a two-step login: email first, then password
    // Try to find and fill the email field
    await page.locator('input[type="email"], input[name="username"], input[id*="email"], input[id*="user"], #username').first().fill(username);
    await delay(500, 1000);

    // Click continue/sign-in button
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Continue"), button[id*="login"]').first().click();
    await delay(2000, 3000);

    // Check if password field appeared (two-step)
    const hasPasswordField = await page.locator('input[type="password"]').isVisible().catch(() => false);

    if (hasPasswordField) {
      await page.locator('input[type="password"]').first().fill(password);
      await delay(500, 1000);
      await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
      await delay(3000, 5000);
    }

    // Verify login success
    const afterLoginUrl = page.url();
    const loggedIn =
      !afterLoginUrl.includes("/login") &&
      !afterLoginUrl.includes("/account/login");

    // Double check with a screenshot if URL is ambiguous
    if (!loggedIn) {
      const afterShot = await page.screenshot({ type: "png" });
      const verify = await aiVision<{
        logged_in: boolean;
        error_message: string | null;
        needs_2fa: boolean;
      }>(
        afterShot.toString("base64"),
        `After a login attempt on Target.com, analyze this page.
Return JSON:
- "logged_in": boolean - is the user now logged in?
- "error_message": string or null - any error shown?
- "needs_2fa": boolean - is 2FA/verification required?`
      );

      if (verify.needs_2fa) {
        return { success: false, reason: "2FA required — cannot proceed automatically" };
      }
      if (!verify.logged_in) {
        return { success: false, reason: verify.error_message || "Login failed - check credentials" };
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, reason: `Login error: ${error.message}` };
  }
}

// -- Add to Cart --

async function addToCart(
  page: Page,
  config: AutoBuyConfig
): Promise<{ success: boolean; reason?: string; out_of_stock?: boolean }> {
  try {
    // Take screenshot and analyze with AI
    const screenshot = await page.screenshot({ type: "png" });
    const analysis = await aiVision<{
      in_stock: boolean;
      price: number | null;
      add_to_cart_visible: boolean;
      button_text: string | null;
    }>(
      screenshot.toString("base64"),
      `Analyze this Target.com product page screenshot.
Return JSON:
- "in_stock": boolean - is the item available for purchase?
- "price": number or null - current price in USD
- "add_to_cart_visible": boolean - is there an "Add to cart" or "Ship it" button visible?
- "button_text": string - exact text on the purchase button (e.g., "Ship it", "Add to cart")`
    );

    if (!analysis.in_stock || !analysis.add_to_cart_visible) {
      return { success: false, reason: "Item is out of stock", out_of_stock: true };
    }

    // Check price constraint
    if (config.max_price && analysis.price && analysis.price > config.max_price) {
      return { success: false, reason: `Price $${analysis.price} exceeds max $${config.max_price}` };
    }

    // Click the add to cart / ship it button
    const buttonSelectors = [
      'button[data-test="shipItButton"]',
      'button[data-test="addToCartButton"]',
      'button:has-text("Ship it")',
      'button:has-text("Add to cart")',
      'button:has-text("Add to Cart")',
    ];

    let clicked = false;
    for (const selector of buttonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch {}
    }

    if (!clicked) {
      // Fallback: use AI to find and click
      const pageContent = await page.content();
      const btnInfo = await aiAnalyzeText<{
        selector: string;
      }>(
        pageContent.substring(0, 15000),
        `Find the add-to-cart or "Ship it" button on this Target product page.
Return JSON: { "selector": "CSS selector for the button" }`
      );
      await page.locator(btnInfo.selector).first().click();
    }

    await delay(2000, 4000);

    // Verify item was added — look for confirmation
    const afterShot = await page.screenshot({ type: "png" });
    const cartVerify = await aiVision<{
      added_to_cart: boolean;
      error_message: string | null;
    }>(
      afterShot.toString("base64"),
      `After clicking "Add to cart" on Target.com, was the item successfully added?
Look for: cart confirmation modal, "Added to cart" message, cart count increase, or any errors.
Return JSON: { "added_to_cart": boolean, "error_message": string|null }`
    );

    return {
      success: cartVerify.added_to_cart,
      reason: cartVerify.error_message || undefined,
    };
  } catch (error: any) {
    return { success: false, reason: `Add to cart error: ${error.message}` };
  }
}

// -- Checkout Flow --

async function performCheckout(
  page: Page,
  config: AutoBuyConfig
): Promise<AutoBuyResult> {
  const steps: string[] = [];

  try {
    // Go to cart
    await page.goto("https://www.target.com/cart", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(2000, 3000);

    // Click checkout
    const checkoutSelectors = [
      'button[data-test="checkout-button"]',
      'a[data-test="checkout-button"]',
      'button:has-text("Check out")',
      'button:has-text("Checkout")',
      'a:has-text("Check out")',
    ];

    let clickedCheckout = false;
    for (const sel of checkoutSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          clickedCheckout = true;
          break;
        }
      } catch {}
    }

    if (!clickedCheckout) {
      return {
        status: "carted",
        failure_reason: "Could not find checkout button — item is in cart but checkout failed",
        steps_completed: steps,
      };
    }

    steps.push("Clicked checkout");
    await delay(3000, 5000);

    // Iterate through checkout steps (max 10 iterations)
    for (let i = 0; i < 10; i++) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await delay(1500, 2500);

      const screenshot = await page.screenshot({ type: "png" });
      const stepInfo = await aiVision<{
        current_step: "shipping" | "payment" | "review" | "confirmation" | "error" | "login" | "unknown";
        action_needed: string;
        primary_button_text: string | null;
        order_number: string | null;
        total_price: string | null;
        error_message: string | null;
        is_order_confirmed: boolean;
      }>(
        screenshot.toString("base64"),
        `Analyze this Target.com checkout page. What step are we on?
Return JSON:
- "current_step": "shipping"|"payment"|"review"|"confirmation"|"error"|"login"|"unknown"
- "action_needed": brief description of what to do next
- "primary_button_text": text on the main action button if visible
- "order_number": order confirmation number if visible
- "total_price": order total if visible
- "error_message": any error message shown
- "is_order_confirmed": boolean - is this showing an order confirmation/thank you page?`
      );

      steps.push(`Checkout step: ${stepInfo.current_step} — ${stepInfo.action_needed}`);

      // Order confirmed!
      if (stepInfo.is_order_confirmed) {
        return {
          status: "success",
          order_number: stepInfo.order_number || "Unknown",
          total_price: stepInfo.total_price
            ? parseFloat(stepInfo.total_price.replace(/[^0-9.]/g, ""))
            : undefined,
          steps_completed: steps,
        };
      }

      // Error
      if (stepInfo.current_step === "error") {
        return {
          status: "failed",
          failure_reason: stepInfo.error_message || "Checkout error",
          steps_completed: steps,
        };
      }

      // Need to re-login
      if (stepInfo.current_step === "login") {
        return {
          status: "failed",
          failure_reason: "Session expired — redirected to login during checkout",
          steps_completed: steps,
        };
      }

      // Click the primary button to advance
      if (stepInfo.primary_button_text) {
        const buttonSelectors = [
          `button:has-text("${stepInfo.primary_button_text}")`,
          'button[data-test="placeOrderButton"]',
          'button[data-test="save-and-continue-button"]',
          'button:has-text("Place your order")',
          'button:has-text("Continue")',
          'button:has-text("Save")',
        ];

        let clicked = false;
        for (const sel of buttonSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              clicked = true;
              break;
            }
          } catch {}
        }

        if (!clicked) {
          // Last resort — try any visible primary-looking button
          try {
            await page.locator('button[type="submit"], button.btn-primary').first().click();
          } catch {}
        }
      }

      await delay(2000, 3000);
    }

    return {
      status: "failed",
      failure_reason: "Checkout timed out after 10 steps",
      steps_completed: steps,
    };
  } catch (error: any) {
    return {
      status: "failed",
      failure_reason: `Checkout error: ${error.message}`,
      steps_completed: steps,
    };
  }
}

// -- AI Helpers --

async function aiVision<T>(base64Image: string, prompt: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64Image } },
          { type: "text", text: `${prompt}\n\nReturn ONLY valid JSON, no other text.` },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No AI response");
  return parseJson<T>(text.text);
}

async function aiAnalyzeText<T>(html: string, prompt: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      { role: "user", content: `${prompt}\n\nReturn ONLY valid JSON.\n\nPAGE HTML:\n${html}` },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No AI response");
  return parseJson<T>(text.text);
}

function parseJson<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith("```json")) s = s.slice(7);
  if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  return JSON.parse(s.trim());
}

async function safeScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buf = await page.screenshot({ type: "png" });
    return buf.toString("base64");
  } catch {
    return undefined;
  }
}

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}
