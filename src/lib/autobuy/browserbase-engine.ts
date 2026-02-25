import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

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
}

// -- Main Entry --

export async function executeAutoBuy(config: AutoBuyConfig): Promise<AutoBuyResult> {
  const steps: string[] = [];
  let stagehand: Stagehand | null = null;

  try {
    // Step 1: Initialize Stagehand with Browserbase
    steps.push("Creating browser session");

    // If we have a saved context, create session with it (skips login)
    let sessionConfig: any = undefined;
    if (config.browserbase_context_id) {
      console.log("[AutoBuy] Using saved context:", config.browserbase_context_id);
      const BB_API = "https://api.browserbase.com/v1";
      const sessionRes = await fetch(`${BB_API}/sessions`, {
        method: "POST",
        headers: {
          "x-bb-api-key": process.env.BROWSERBASE_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: process.env.BROWSERBASE_PROJECT_ID!,
          browserSettings: {
            context: {
              id: config.browserbase_context_id,
              persist: true,
            },
            solveCaptchas: true,
            viewport: { width: 390, height: 844 },
          },
        }),
      });
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        sessionConfig = session.id;
        console.log("[AutoBuy] Session created with context:", session.id);
      } else {
        console.log("[AutoBuy] Failed to create session with context, falling back to fresh session");
      }
    }

    const stagehandOpts: any = {
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      experimental: true,
      verbose: 0,
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
      browserSettings: {
        viewport: { width: 390, height: 844 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      },
    };
    if (sessionConfig) {
      stagehandOpts.browserbaseSessionID = sessionConfig;
    }

    stagehand = new Stagehand(stagehandOpts);
    await stagehand.init();
    steps.push("Browser session created");

    const page = stagehand.context.pages()[0];

    // Step 2: Login (skip if using saved context)
    if (config.browserbase_context_id && sessionConfig) {
      steps.push("Using saved login session");
      // Verify we're still logged in by visiting Target
      await page.goto("https://www.target.com/account", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await delay(2000, 3000);

      const currentUrl = page.url();
      console.log("[AutoBuy] Account page URL:", currentUrl);

      if (currentUrl.includes("/login") || currentUrl.includes("/sign-in")) {
        console.log("[AutoBuy] Session expired — falling back to login");
        steps.push("Session expired — logging in");
        // Fall through to login
      } else {
        steps.push("Login session valid");
        console.log("[AutoBuy] Logged in via saved context");
      }

      // If still on login page, need to log in
      if (currentUrl.includes("/login") || currentUrl.includes("/sign-in")) {
        const loginResult = await performLogin(stagehand, page, config);
        if (!loginResult.success) {
          return {
            status: "failed",
            failure_reason: `Login failed: ${loginResult.reason}`,
            steps_completed: steps,
          };
        }
        steps.push("Login successful");
      }
    } else {
      // No saved context — full login flow
      steps.push("Logging into Target");
      const loginResult = await performLogin(stagehand, page, config);
      if (!loginResult.success) {
        return {
          status: "failed",
          failure_reason: loginResult.reason || "Login failed",
          steps_completed: steps,
        };
      }
      steps.push("Login successful");
    }

    // Step 3: Navigate to product and add to cart
    steps.push("Navigating to product page");
    await page.goto(config.product_url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await delay(1500, 2500);

    // Check if product is available and get info
    let productStatus: any = null;
    try {
      productStatus = await stagehand.extract({
        instruction: "Extract product information from this Target product page: the product name, the price, and whether there is an 'Add to cart' button visible. Also check if there is any 'Out of stock', 'Sold out', or 'Temporarily out of stock' message.",
        schema: z.object({
          product_name: z.string().describe("The product name/title"),
          price: z.string().nullable().describe("The product price if visible"),
          has_add_to_cart_button: z.boolean().describe("Whether an Add to cart button is visible"),
          out_of_stock_message: z.string().nullable().describe("Any explicit out of stock or sold out message, null if none found"),
        }),
      });
      console.log("[AutoBuy] Product status:", JSON.stringify(productStatus));
    } catch (err: any) {
      console.log("[AutoBuy] Extract failed, proceeding to try add to cart anyway:", err.message);
    }

    // Only block if there's an EXPLICIT out of stock message
    if (productStatus?.out_of_stock_message && !productStatus?.has_add_to_cart_button) {
      return {
        status: "out_of_stock",
        failure_reason: productStatus.out_of_stock_message,
        steps_completed: steps,
      };
    }

    // Price check
    if (config.max_price && productStatus?.price) {
      const price = parseFloat(productStatus.price.replace(/[^0-9.]/g, ""));
      if (price > config.max_price) {
        return {
          status: "failed",
          failure_reason: `Price $${price} exceeds max price $${config.max_price}`,
          steps_completed: steps,
        };
      }
    }

    // Try to add to cart — attempt multiple approaches
    steps.push("Adding to cart");
    let addedToCart = false;

    try {
      await stagehand.act("click the 'Add to cart' button on the product page");
      addedToCart = true;
    } catch {
      // Try alternative selectors
      try {
        await stagehand.act("find and click any button that says 'Add to cart' or 'Add to Cart'");
        addedToCart = true;
      } catch {
        console.log("[AutoBuy] Could not click add to cart button");
      }
    }

    if (!addedToCart) {
      return {
        status: "out_of_stock",
        failure_reason: "Could not find or click 'Add to cart' button — product may be unavailable",
        steps_completed: steps,
      };
    }

    await delay(2000, 3000);

    // Handle any popups (warranty, protection plans, etc.)
    try {
      await stagehand.act({
        action: "if there is a popup or modal about protection plans, warranties, or accessories, close it or click 'No thanks' or 'Skip'",
        timeoutMs: 5000,
      });
    } catch {
      // No popup — that's fine
    }

    // Brief check if cart was updated — don't block on failure
    try {
      const cartCheck = await stagehand.extract({
        instruction: "Was the item added to cart? Look for 'Added to cart' confirmation, cart count change, or any error like 'couldn't add to cart'.",
        schema: z.object({
          added: z.boolean().describe("Whether the item appears to have been added"),
          error: z.string().nullable().describe("Any error message"),
        }),
      });
      if (cartCheck.error && !cartCheck.added) {
        console.log("[AutoBuy] Cart check reports error:", cartCheck.error);
      }
    } catch {
      // Proceed anyway — we'll find out at checkout
    }
    steps.push("Added to cart");

    // Step 4: Checkout
    steps.push("Starting checkout");
    const checkoutResult = await performCheckout(stagehand, page, config, steps);
    return checkoutResult;

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

// -- Login Flow --

async function performLogin(
  stagehand: Stagehand,
  page: any,
  config: AutoBuyConfig
): Promise<{ success: boolean; reason?: string }> {
  try {
    await page.goto("https://www.target.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(3000, 4000);

    // Use the agent for the entire login flow — it handles
    // CAPTCHAs, two-step forms, popups, and unexpected pages better
    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    });

    const loginResult = await agent.execute({
      instruction: `Log into Target.com with these credentials:
       Email: ${config.username}
       Password: ${config.password}
       
       Steps:
       1. Find the email/username field and type the email
       2. Find the password field and type the password (it may appear after clicking Continue, or may already be visible)
       3. Click the Sign In button
       4. If you see a verification code / MFA prompt, stop — do not try to solve it
       5. Wait for the page to redirect away from the login page
       
       Stop once you are logged in (URL no longer contains /login).`,
      maxSteps: 15,
    });

    console.log("[AutoBuy] Login agent result:", JSON.stringify({ success: loginResult.success, message: loginResult.message, completed: loginResult.completed }));
    
    await delay(2000, 3000);

    // Check URL to verify login
    const currentUrl = page.url();
    console.log("[AutoBuy] Current URL after login:", currentUrl);
    
    // Check for MFA/verification page
    if (currentUrl.includes("verify") || currentUrl.includes("mfa") || currentUrl.includes("challenge")) {
      return { success: false, reason: "Target is requiring MFA/verification. This usually happens when logging in from an unfamiliar location. Try enabling Browserbase proxies from your region, or log into Target from a regular browser first to 'trust' the device." };
    }

    const loggedIn = !currentUrl.includes("/login") && !currentUrl.includes("/account/sign-in");

    if (!loggedIn) {
      try {
        const loginStatus = await stagehand.extract({
          instruction: "Is there a login error message visible on this page?",
          schema: z.object({
            has_error: z.boolean().describe("Whether there is a login error"),
            error_message: z.string().nullable().describe("The error message"),
          }),
        });
        if (loginStatus.has_error) {
          return { success: false, reason: loginStatus.error_message || "Login failed" };
        }
      } catch {}
      return { success: false, reason: "Still on login page after agent execution" };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, reason: `Login error: ${error.message}` };
  }
}

// -- Checkout Flow --

async function performCheckout(
  stagehand: Stagehand,
  page: any,
  config: AutoBuyConfig,
  steps: string[]
): Promise<AutoBuyResult> {
  try {
    // Go to cart
    await page.goto("https://www.target.com/cart", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await delay(2000, 3000);

    // Use agent for the entire checkout flow
    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    });

    const cvvInstruction = config.cvv 
      ? `6. If a "Confirm CVV" dialog appears, type the CVV code: ${config.cvv} into the CVV field and click "Confirm"`
      : `6. If a "Confirm CVV" dialog appears, STOP — no CVV was provided`;

    const checkoutResult = await agent.execute({
      instruction: `You are on Target's cart page on mobile. Complete the checkout process:

1. Click the "Check out" or "Checkout" button to start checkout
2. If asked to choose shipping or delivery method, select the cheapest/default option and click "Save and continue" or "Continue"
3. If asked about payment, the saved payment method should already be selected — just click "Save and continue" or "Continue"  
4. On the order review page, look for "Place your order" button and click it
5. After placing the order, look for the order confirmation number
${cvvInstruction}

IMPORTANT RULES:
- Do NOT change the shipping address — use whatever is already saved
- Do NOT change the payment method — use whatever is already saved  
- If you see a "Place your order" button, click it immediately
- If you see an order confirmation page with an order number, STOP — you are done
- If you see a login page, STOP — the session has expired
- If you see an error message, STOP
- Do not click on any promotional offers, upsells, or "add more items"
- If a step asks you to "Continue" or "Save and continue", click that button

The goal is to complete checkout as fast as possible using saved shipping and payment info.`,
      maxSteps: 20,
    });

    console.log("[AutoBuy] Checkout agent completed");
    steps.push("Checkout agent completed");

    await delay(3000, 5000);

    // Check the final page state
    const finalUrl = page.url();
    console.log("[AutoBuy] Final URL:", finalUrl);

    // Use stagehand to analyze the final page
    let pageAnalysis: any = {};
    try {
      pageAnalysis = await stagehand.extract({
        instruction: "Analyze this page. What page are you on? Is there an order confirmation with an order number? Is there an error message? What does the page say? Describe everything you see.",
        schema: z.object({
          page_type: z.string().describe("What type of page is this: cart, checkout, order-confirmation, login, error, product, homepage, or other"),
          visible_text_summary: z.string().describe("A brief summary of the main text visible on the page"),
          has_order_confirmation: z.boolean().describe("Is there an order confirmation or thank you message?"),
          order_number: z.string().nullable().describe("Order/confirmation number if visible"),
          total_price: z.string().nullable().describe("Order total if visible"),
          error_message: z.string().nullable().describe("Any error message visible on the page"),
          main_button_text: z.string().nullable().describe("Text of the main action button if any"),
        }),
      });
      console.log("[AutoBuy] Page analysis:", JSON.stringify(pageAnalysis));
    } catch (err: any) {
      console.log("[AutoBuy] Failed to analyze page:", err.message);
    }

    // Check for order confirmation
    if (pageAnalysis.has_order_confirmation || 
        finalUrl.includes("order-confirmation")) {
      steps.push("Order confirmed!");
      return {
        status: "success",
        order_number: pageAnalysis.order_number || "Unknown",
        total_price: pageAnalysis.total_price
          ? parseFloat(pageAnalysis.total_price.replace(/[^0-9.]/g, ""))
          : undefined,
        steps_completed: steps,
      };
    }

    // Check for specific errors
    if (pageAnalysis.error_message) {
      return {
        status: "carted",
        failure_reason: `Checkout error: ${pageAnalysis.error_message}`,
        steps_completed: steps,
      };
    }

    // Check if still in checkout/cart
    if (finalUrl.includes("/cart") || finalUrl.includes("/checkout")) {
      return {
        status: "carted",
        failure_reason: `Checkout did not complete. Page: ${pageAnalysis.page_type || "unknown"}. ${pageAnalysis.visible_text_summary || ""} Main button: ${pageAnalysis.main_button_text || "none"}`,
        steps_completed: steps,
      };
    }

    // Check for login redirect (session expired)
    if (finalUrl.includes("/login")) {
      return {
        status: "carted",
        failure_reason: "Session expired during checkout — item is in cart. Please reconnect credentials.",
        steps_completed: steps,
      };
    }

    // Unknown state
    return {
      status: "carted",
      failure_reason: `Checkout ended on unexpected page: ${finalUrl}`,
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

// -- Helpers --

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}