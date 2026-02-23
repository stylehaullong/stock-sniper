import type { Page, BrowserContext } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import {
  createIsolatedContext,
  randomDelay,
  humanType,
  takeScreenshot,
} from "../browser/manager";

// Types matching the main app
interface AutoBuyPayload {
  watchlist_item_id: string;
  user_id: string;
  retailer: string;
  product_url: string;
  product_sku: string | null;
  mode: string;
  max_price: number | null;
  quantity: number;
  encrypted_credentials: {
    encrypted_username: string;
    encrypted_password: string;
    encryption_iv: string;
  };
}

interface PurchaseResult {
  status: "success" | "failed" | "carted" | "checkout_started";
  order_number?: string;
  total_price?: number;
  failure_reason?: string;
  screenshot_url?: string;
}

interface CheckoutStep {
  name: string;
  aiPrompt: string;
  timeout_ms: number;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/**
 * Execute the full auto-buy flow:
 * 1. Create isolated browser session
 * 2. Login to retailer
 * 3. Navigate to product page
 * 4. Add to cart
 * 5. Checkout
 * 6. Confirm order
 */
export async function executeAutoBuy(
  payload: AutoBuyPayload,
  decryptedUsername: string,
  decryptedPassword: string
): Promise<PurchaseResult> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // Step 1: Create isolated browser session with proxy
    const proxyUrl = process.env.PROXY_SERVICE_URL;
    const session = await createIsolatedContext({ proxyUrl });
    context = session.context;
    page = session.page;

    console.log(`[${payload.watchlist_item_id}] Starting auto-buy session`);

    // Step 2: Login
    await reportStatus(payload, "detected", "Starting login...");
    const loginSuccess = await performLogin(page, payload.retailer, decryptedUsername, decryptedPassword);

    if (!loginSuccess) {
      return {
        status: "failed",
        failure_reason: "Login failed - check credentials",
        screenshot_url: await captureAndUploadScreenshot(page),
      };
    }

    console.log(`[${payload.watchlist_item_id}] Login successful`);

    // Step 3: Navigate to product page
    await randomDelay(1000, 3000);
    await page.goto(payload.product_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 4000);

    // Step 4: Check stock and add to cart
    await reportStatus(payload, "detected", "Checking stock...");
    const addToCartResult = await addToCart(page, payload);

    if (!addToCartResult.success) {
      return {
        status: "failed",
        failure_reason: addToCartResult.reason || "Failed to add to cart",
        screenshot_url: await captureAndUploadScreenshot(page),
      };
    }

    await reportStatus(payload, "carted", "Item added to cart");
    console.log(`[${payload.watchlist_item_id}] Added to cart`);

    // Step 5: Checkout
    await randomDelay(1000, 2000);
    await reportStatus(payload, "checkout_started", "Starting checkout...");
    const checkoutResult = await performCheckout(page, payload);

    return checkoutResult;
  } catch (error) {
    console.error(`[${payload.watchlist_item_id}] Auto-buy error:`, error);

    let screenshotUrl: string | undefined;
    if (page) {
      try {
        screenshotUrl = await captureAndUploadScreenshot(page);
      } catch {}
    }

    return {
      status: "failed",
      failure_reason: `Unexpected error: ${String(error)}`,
      screenshot_url: screenshotUrl,
    };
  } finally {
    // Always clean up the isolated context
    if (context) {
      await context.close();
    }
  }
}

/**
 * Perform login to the retailer's website using AI-guided navigation.
 */
async function performLogin(
  page: Page,
  retailer: string,
  username: string,
  password: string
): Promise<boolean> {
  // Navigate to login page
  const loginUrls: Record<string, string> = {
    target: "https://www.target.com/account",
    walmart: "https://www.walmart.com/account/login",
    pokemon_center: "https://www.pokemoncenter.com/account/login",
  };

  const loginUrl = loginUrls[retailer];
  if (!loginUrl) throw new Error(`No login URL for retailer: ${retailer}`);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await randomDelay(2000, 4000);

  // Check for bot detection
  const screenshot = await takeScreenshot(page);
  const botCheck = await aiAnalyze<{
    is_blocked: boolean;
    type: string;
  }>(
    screenshot,
    `Is this page showing any bot detection, CAPTCHA, or access blocked message?
Return JSON: { "is_blocked": boolean, "type": "captcha"|"rate_limit"|"none" }`
  );

  if (botCheck.is_blocked) {
    console.warn(`Bot detection encountered: ${botCheck.type}`);
    // TODO: Integrate CAPTCHA solving service
    return false;
  }

  // Find and fill email/username field
  const pageContent = await page.content();
  const loginFields = await aiAnalyzeText<{
    email_selector: string;
    password_selector: string | null;
    submit_selector: string;
    is_two_step: boolean;
  }>(
    pageContent.substring(0, 10000),
    `Analyze this login page HTML. Find form fields.
Return JSON:
- "email_selector": CSS selector for email/username input
- "password_selector": CSS selector for password input (null if two-step)
- "submit_selector": CSS selector for submit/continue button
- "is_two_step": boolean if login is split into email-then-password steps`
  );

  // Enter email
  await humanType(page, loginFields.email_selector, username);
  await randomDelay(300, 800);

  if (loginFields.is_two_step) {
    // Click continue, then enter password on next page
    await page.click(loginFields.submit_selector);
    await randomDelay(2000, 4000);
    await page.waitForLoadState("domcontentloaded");

    // Re-analyze for password field
    const passwordPage = await page.content();
    const passwordFields = await aiAnalyzeText<{
      password_selector: string;
      submit_selector: string;
    }>(
      passwordPage.substring(0, 10000),
      `Analyze this login page (password step). Find the password field and submit button.
Return JSON: { "password_selector": "CSS selector", "submit_selector": "CSS selector" }`
    );

    await humanType(page, passwordFields.password_selector, password);
    await randomDelay(300, 800);
    await page.click(passwordFields.submit_selector);
  } else {
    // Single page login
    if (loginFields.password_selector) {
      await humanType(page, loginFields.password_selector, password);
    }
    await randomDelay(300, 800);
    await page.click(loginFields.submit_selector);
  }

  // Wait for navigation after login
  await randomDelay(3000, 5000);

  // Verify login success
  const afterLoginScreenshot = await takeScreenshot(page);
  const loginResult = await aiAnalyze<{
    logged_in: boolean;
    needs_2fa: boolean;
    error_message: string | null;
  }>(
    afterLoginScreenshot,
    `Did the login succeed? Is the user now logged in?
Return JSON: { "logged_in": boolean, "needs_2fa": boolean, "error_message": string|null }`
  );

  if (loginResult.needs_2fa) {
    console.warn("2FA required — cannot proceed automatically");
    return false;
  }

  return loginResult.logged_in;
}

/**
 * Add the product to cart using AI-guided interaction.
 */
async function addToCart(
  page: Page,
  payload: AutoBuyPayload
): Promise<{ success: boolean; reason?: string }> {
  const pageContent = await page.content();

  // Use AI to find the add-to-cart button
  const cartInfo = await aiAnalyzeText<{
    in_stock: boolean;
    add_to_cart_selector: string | null;
    price: number | null;
    needs_variant_selection: boolean;
  }>(
    pageContent.substring(0, 15000),
    `Analyze this product page. Is the item in stock? Find the add-to-cart button.
Return JSON:
- "in_stock": boolean
- "add_to_cart_selector": CSS selector for add-to-cart/ship-it button (null if not available)
- "price": number or null
- "needs_variant_selection": boolean`
  );

  if (!cartInfo.in_stock || !cartInfo.add_to_cart_selector) {
    return { success: false, reason: "Item is out of stock" };
  }

  // Check price constraint
  if (payload.max_price && cartInfo.price && cartInfo.price > payload.max_price) {
    return {
      success: false,
      reason: `Price $${cartInfo.price} exceeds max $${payload.max_price}`,
    };
  }

  // Click add to cart
  try {
    await page.click(cartInfo.add_to_cart_selector);
    await randomDelay(2000, 4000);

    // Verify item was added (look for cart confirmation modal/popup)
    const afterCartScreenshot = await takeScreenshot(page);
    const cartResult = await aiAnalyze<{
      added_to_cart: boolean;
      error_message: string | null;
    }>(
      afterCartScreenshot,
      `Was the item successfully added to the cart? Look for confirmation modals, cart count changes, or error messages.
Return JSON: { "added_to_cart": boolean, "error_message": string|null }`
    );

    return {
      success: cartResult.added_to_cart,
      reason: cartResult.error_message || undefined,
    };
  } catch (error) {
    return { success: false, reason: `Click failed: ${String(error)}` };
  }
}

/**
 * Navigate through the checkout flow using AI-guided steps.
 */
async function performCheckout(page: Page, payload: AutoBuyPayload): Promise<PurchaseResult> {
  // Navigate to cart
  await page.goto("https://www.target.com/cart", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await randomDelay(2000, 3000);

  // Find and click checkout button
  let screenshot = await takeScreenshot(page);
  let checkoutInfo = await aiAnalyze<{
    checkout_selector: string;
    cart_total: string | null;
    item_count: number;
  }>(
    screenshot,
    `Analyze this shopping cart page. Find the checkout button.
Return JSON: { "checkout_selector": "CSS selector", "cart_total": "price string", "item_count": number }`
  );

  await page.click(checkoutInfo.checkout_selector);
  await randomDelay(3000, 5000);

  // Iterate through checkout steps until we reach order confirmation
  const maxSteps = 8;
  for (let step = 0; step < maxSteps; step++) {
    await page.waitForLoadState("domcontentloaded");
    screenshot = await takeScreenshot(page);

    const stepInfo = await aiAnalyze<{
      current_step: "shipping" | "payment" | "review" | "confirmation" | "error" | "unknown";
      action_selector: string | null;
      is_final_step: boolean;
      order_number: string | null;
      total_price: string | null;
      error_message: string | null;
      needs_input: boolean;
      input_type: string | null;
    }>(
      screenshot,
      `Analyze this checkout page. What step are we on and what action is needed?
Return JSON:
- "current_step": "shipping"|"payment"|"review"|"confirmation"|"error"|"unknown"
- "action_selector": CSS selector for the primary action button (Continue, Place Order, etc.)
- "is_final_step": boolean - is this the order confirmation page?
- "order_number": string if visible
- "total_price": string if visible
- "error_message": string if there's an error
- "needs_input": boolean if a form field needs to be filled
- "input_type": what input is needed (e.g., "cvv", "address")`
    );

    // Order confirmed!
    if (stepInfo.is_final_step && stepInfo.current_step === "confirmation") {
      return {
        status: "success",
        order_number: stepInfo.order_number || "Unknown",
        total_price: stepInfo.total_price ? parseFloat(stepInfo.total_price.replace(/[^0-9.]/g, "")) : undefined,
        screenshot_url: await captureAndUploadScreenshot(page),
      };
    }

    // Error encountered
    if (stepInfo.current_step === "error" || stepInfo.error_message) {
      return {
        status: "failed",
        failure_reason: stepInfo.error_message || "Checkout error",
        screenshot_url: await captureAndUploadScreenshot(page),
      };
    }

    // Click the action button to proceed
    if (stepInfo.action_selector) {
      try {
        await page.click(stepInfo.action_selector);
        await randomDelay(2000, 4000);
      } catch (error) {
        console.warn(`Failed to click ${stepInfo.action_selector}:`, error);
      }
    } else {
      // No action button found - might be stuck
      return {
        status: "failed",
        failure_reason: `Stuck at checkout step: ${stepInfo.current_step}`,
        screenshot_url: await captureAndUploadScreenshot(page),
      };
    }
  }

  return {
    status: "failed",
    failure_reason: "Checkout timed out - too many steps",
    screenshot_url: await captureAndUploadScreenshot(page),
  };
}

// -- AI Helper Functions --

async function aiAnalyze<T>(screenshotBase64: string, prompt: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: screenshotBase64 },
          },
          { type: "text", text: `${prompt}\n\nReturn ONLY valid JSON, no other text.` },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No AI response");

  let json = text.text.trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);

  return JSON.parse(json.trim());
}

async function aiAnalyzeText<T>(htmlContent: string, prompt: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nReturn ONLY valid JSON, no other text.\n\nPAGE CONTENT:\n${htmlContent}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No AI response");

  let json = text.text.trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);

  return JSON.parse(json.trim());
}

// -- Utility --

async function reportStatus(payload: AutoBuyPayload, status: string, message: string): Promise<void> {
  // Report back to the main app via webhook
  const callbackUrl = process.env.CALLBACK_URL || "http://localhost:3000/api/webhooks/worker-callback";

  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-api-key": process.env.WORKER_API_KEY || "",
      },
      body: JSON.stringify({
        type: "worker_result",
        payload: {
          watchlist_item_id: payload.watchlist_item_id,
          user_id: payload.user_id,
          event_type: "stock_found",
          purchase_result: { status, failure_reason: null },
        },
      }),
    });
  } catch (error) {
    console.warn("Failed to report status:", error);
  }
}

async function captureAndUploadScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buffer = await page.screenshot({ type: "png", fullPage: false });
    // TODO: Upload to Supabase Storage and return URL
    // For now, return base64 (not ideal for storage)
    return `data:image/png;base64,${buffer.toString("base64").substring(0, 100)}...`;
  } catch {
    return undefined;
  }
}
