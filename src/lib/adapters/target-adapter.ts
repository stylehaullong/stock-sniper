import type { RetailerAdapter, CheckoutStep, LoginFlow, Retailer } from "@/types";

export class TargetAdapter implements RetailerAdapter {
  retailer: Retailer = "target";
  displayName = "Target";

  urlPatterns = [
    /^https?:\/\/(www\.)?target\.com\/p\//,
    /^https?:\/\/(www\.)?target\.com\/.*\/A-\d+/,
    /^https?:\/\/(www\.)?target\.com\/.*[?&]preselect=\d+/,
  ];

  matchesUrl(url: string): boolean {
    return this.urlPatterns.some((pattern) => pattern.test(url));
  }

  extractProductId(url: string): string | null {
    // Target uses DPCI or TCIN (e.g., A-12345678)
    const tcinMatch = url.match(/A-(\d+)/);
    if (tcinMatch) return tcinMatch[1];

    // Also check for preselect param
    const preselectMatch = url.match(/preselect=(\d+)/);
    if (preselectMatch) return preselectMatch[1];

    return null;
  }

  /**
   * AI prompt to analyze a Target product page and determine stock status.
   * We send the page's DOM/text content and ask the AI to extract structured data.
   */
  getStockCheckPrompt(pageContent: string): string {
    return `You are analyzing a Target.com product page to determine stock availability.

Analyze the following page content and return a JSON object with these fields:
- "in_stock": boolean - true if the item is available for purchase (shipping or pickup)
- "price": number or null - current price in USD (e.g., 49.99)
- "product_name": string - the product name
- "product_image_url": string or null - URL of the main product image
- "add_to_cart_available": boolean - true if there's an active "Add to cart" or "Ship it" button
- "stock_notes": string - any relevant stock info (e.g., "Only 3 left", "Sold out", "Shipping only")

Important notes:
- Target may show "Sold out" or "Out of stock" or "Notify me when it's back"
- "Temporarily out of stock" means NOT in stock
- "Add to cart" being present and clickable means IN STOCK
- "Ship it" button means available for shipping
- Check for both shipping AND store pickup availability
- If the page shows a CAPTCHA or bot detection, set in_stock to false and note it in stock_notes

Return ONLY valid JSON, no other text.

PAGE CONTENT:
${pageContent}`;
  }

  /**
   * AI prompt to identify the add-to-cart button element on the page.
   */
  getAddToCartPrompt(pageContent: string): string {
    return `You are analyzing a Target.com product page DOM to find the "Add to cart" button.

Find the primary add-to-cart or purchase button and return a JSON object:
- "selector": CSS selector to find the button (e.g., "[data-test='shipItButton']", "button#addToCart")
- "button_text": the text on the button
- "alternative_selectors": array of alternative CSS selectors that might work
- "needs_quantity_selection": boolean - does the user need to select quantity first?
- "needs_variant_selection": boolean - does the user need to select a variant (color, size, etc.)?

Target commonly uses these patterns:
- data-test="shipItButton" for the Ship It button
- data-test="orderPickupButton" for store pickup
- data-test="addToCartButton" for generic add to cart
- Buttons containing text "Add to cart", "Ship it", "Pick it up"

Return ONLY valid JSON, no other text.

PAGE DOM:
${pageContent}`;
  }

  /**
   * Checkout flow steps after the item is in the cart.
   * Each step uses AI to navigate the dynamic checkout pages.
   */
  getCheckoutFlowSteps(): CheckoutStep[] {
    return [
      {
        name: "navigate_to_cart",
        description: "Navigate to the shopping cart",
        aiPrompt: `Analyze this Target.com page. Find the cart icon or "View cart" link.
Return JSON: { "selector": "CSS selector for cart link", "url": "/cart" if direct navigation is better }`,
        timeout_ms: 10000,
      },
      {
        name: "initiate_checkout",
        description: "Click the checkout button in the cart",
        aiPrompt: `Analyze this Target.com cart page. Find the checkout button.
Return JSON: { "selector": "CSS selector for checkout button", "button_text": "text on button" }
Common selectors: [data-test="checkout-button"], button containing "Check out"`,
        timeout_ms: 10000,
      },
      {
        name: "select_shipping",
        description: "Confirm shipping method if prompted",
        aiPrompt: `Analyze this Target.com checkout page. Determine the current checkout step.
Return JSON:
- "step": "shipping" | "payment" | "review" | "confirmation" | "unknown"
- "action_needed": description of what needs to happen
- "selector": CSS selector of the primary action button (e.g., "Continue", "Save & continue")
- "is_complete": boolean if this step is already done`,
        timeout_ms: 15000,
      },
      {
        name: "confirm_payment",
        description: "Confirm saved payment method",
        aiPrompt: `Analyze this Target.com checkout payment page.
Return JSON:
- "has_saved_payment": boolean - is there a saved payment method?
- "selector": CSS selector to continue/confirm payment
- "needs_cvv": boolean - does it ask for CVV re-entry?
- "cvv_selector": CSS selector for CVV input if needed`,
        timeout_ms: 15000,
      },
      {
        name: "place_order",
        description: "Click the final place order button",
        aiPrompt: `Analyze this Target.com order review page.
Return JSON:
- "total_price": string - order total shown
- "selector": CSS selector for "Place your order" button
- "button_text": text on the button
- "order_summary": brief description of items in order`,
        timeout_ms: 15000,
      },
      {
        name: "confirm_order",
        description: "Verify order confirmation",
        aiPrompt: `Analyze this Target.com page after placing an order.
Return JSON:
- "success": boolean - was the order placed successfully?
- "order_number": string or null - the order confirmation number
- "estimated_delivery": string or null
- "total_charged": string or null
- "error_message": string or null if something went wrong`,
        timeout_ms: 20000,
      },
    ];
  }

  /**
   * Login flow for Target.com
   */
  getLoginFlow(): LoginFlow {
    return {
      loginUrl: "https://www.target.com/account",
      steps: [
        {
          name: "enter_email",
          description: "Enter email/username on the login page",
          aiPrompt: `Analyze this Target.com login page.
Return JSON:
- "email_selector": CSS selector for email/username input
- "continue_selector": CSS selector for the continue/sign-in button
- "is_two_step": boolean - does Target split login into email then password?`,
          timeout_ms: 10000,
        },
        {
          name: "enter_password",
          description: "Enter password",
          aiPrompt: `Analyze this Target.com login page (password step).
Return JSON:
- "password_selector": CSS selector for password input
- "submit_selector": CSS selector for sign-in button
- "keep_signed_in_selector": CSS selector for "Keep me signed in" checkbox if present`,
          timeout_ms: 10000,
        },
        {
          name: "handle_2fa",
          description: "Handle two-factor authentication if prompted",
          aiPrompt: `Analyze this Target.com page after login attempt.
Return JSON:
- "needs_2fa": boolean - is 2FA/verification required?
- "type": "sms" | "email" | "captcha" | "none"
- "input_selector": CSS selector for verification code input if needed
- "submit_selector": CSS selector for verify button
- "is_logged_in": boolean - are we already logged in?`,
          timeout_ms: 15000,
        },
      ],
    };
  }
}
