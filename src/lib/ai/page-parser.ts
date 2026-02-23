import Anthropic from "@anthropic-ai/sdk";
import type { StockCheckResult } from "@/types";

// Initialize Anthropic client (lazy)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return anthropicClient;
}

/**
 * Send page content to Claude for AI-powered analysis.
 * Returns structured JSON based on the prompt.
 */
export async function analyzePageContent<T>(
  prompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<T> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: options?.maxTokens || 1024,
    temperature: options?.temperature || 0,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from AI");
  }

  // Parse JSON from response, handling potential markdown code blocks
  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }

  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", jsonStr);
    throw new Error(`AI returned invalid JSON: ${jsonStr.substring(0, 200)}`);
  }
}

/**
 * Analyze a screenshot image using Claude's vision capabilities.
 * Useful for CAPTCHA detection, visual verification, etc.
 */
export async function analyzeScreenshot<T>(
  base64Image: string,
  prompt: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png"
): Promise<T> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  const textContent = response.content.find((block) => block.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from AI");
  }

  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);

  return JSON.parse(jsonStr.trim()) as T;
}

/**
 * Parse stock check result from AI analysis of a product page.
 */
export async function parseStockStatus(
  pageContent: string,
  aiPrompt: string
): Promise<StockCheckResult> {
  const result = await analyzePageContent<{
    in_stock: boolean;
    price: number | null;
    product_name: string;
    product_image_url: string | null;
    add_to_cart_available: boolean;
    stock_notes: string;
  }>(aiPrompt);

  return {
    in_stock: result.in_stock,
    price: result.price,
    product_name: result.product_name,
    product_image_url: result.product_image_url,
    add_to_cart_available: result.add_to_cart_available,
    raw_status: result.stock_notes,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Detect if a page is showing a CAPTCHA or bot detection screen.
 */
export async function detectBotProtection(
  screenshotBase64: string
): Promise<{
  is_blocked: boolean;
  type: "captcha" | "rate_limit" | "ip_block" | "none";
  description: string;
}> {
  return analyzeScreenshot(
    screenshotBase64,
    `Analyze this screenshot of a webpage. Determine if it's showing any bot detection or CAPTCHA.
Return JSON:
- "is_blocked": boolean - is access being blocked?
- "type": "captcha" | "rate_limit" | "ip_block" | "none"
- "description": brief description of what's shown

Look for: reCAPTCHA, hCaptcha, Akamai bot detection, "Access Denied", "Please verify", rate limit messages, IP block notices, Cloudflare challenges.

Return ONLY valid JSON.`
  );
}
