import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// User agent rotation pool
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
];

// Screen resolutions pool
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1680, height: 1050 },
];

// Timezone pool
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let browser: Browser | null = null;

/**
 * Get or create the shared browser instance.
 */
async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=VizDisplayCompositor",
      ],
    });
  }
  return browser;
}

/**
 * Create an isolated browser context with randomized fingerprint.
 * Each user session gets its own context — no data leakage between users.
 */
export async function createIsolatedContext(options?: {
  proxyUrl?: string;
}): Promise<{ context: BrowserContext; page: Page }> {
  const b = await getBrowser();

  const userAgent = randomChoice(USER_AGENTS);
  const viewport = randomChoice(VIEWPORTS);
  const timezone = randomChoice(TIMEZONES);

  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    userAgent,
    viewport,
    locale: "en-US",
    timezoneId: timezone,
    // Geolocation fuzzing (US-based)
    geolocation: {
      latitude: 37.7749 + (Math.random() - 0.5) * 10,
      longitude: -122.4194 + (Math.random() - 0.5) * 20,
    },
    permissions: ["geolocation"],
    // Anti-detection: mimic real browser
    javaScriptEnabled: true,
    bypassCSP: false,
    hasTouch: false,
    isMobile: false,
    colorScheme: "light",
  };

  // Add proxy if provided
  if (options?.proxyUrl) {
    const proxyUrl = new URL(options.proxyUrl);
    contextOptions.proxy = {
      server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
      username: proxyUrl.username || undefined,
      password: proxyUrl.password || undefined,
    };
  }

  const context = await b.newContext(contextOptions);

  // Anti-detection scripts
  await context.addInitScript(() => {
    // Override webdriver flag
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    // Override plugins
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    // Override platform
    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });

    // Chrome runtime mock
    (window as any).chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };

    // WebGL vendor/renderer randomization
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return "Intel Inc.";
      if (parameter === 37446) return "Intel Iris OpenGL Engine";
      return getParameter.call(this, parameter);
    };
  });

  const page = await context.newPage();

  // Add random mouse movements to appear more human
  await addHumanBehavior(page);

  return { context, page };
}

/**
 * Add subtle human-like behavior to a page.
 */
async function addHumanBehavior(page: Page): Promise<void> {
  // Random delays between actions
  page.on("framenavigated", async () => {
    await randomDelay(500, 2000);
  });
}

/**
 * Wait a random amount of time (to appear human).
 */
export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Human-like typing with variable speed.
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await randomDelay(100, 300);

  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 100) + 30,
    });
  }
}

/**
 * Take a screenshot and return as base64.
 */
export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "png", fullPage: false });
  return buffer.toString("base64");
}

/**
 * Clean up - close all contexts and browser.
 */
export async function cleanup(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
