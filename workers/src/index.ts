import express from "express";
import dotenv from "dotenv";
import { executeAutoBuy } from "./browser/auto-buy-engine";
import { cleanup } from "./browser/manager";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WORKER_API_KEY = process.env.WORKER_API_KEY || "";
const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || "";

// -- Middleware: Authenticate requests --

function authenticateWorkerRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const apiKey = req.headers["x-worker-api-key"];

  if (!apiKey || apiKey !== WORKER_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

// -- Credential Decryption (mirrors main app's encryption module) --

function decryptCredentials(
  encrypted_username: string,
  encrypted_password: string,
  encryption_iv: string,
  userId: string
): { username: string; password: string } {
  const ivData = JSON.parse(encryption_iv);

  const username = decryptValue(
    encrypted_username,
    ivData.username_iv,
    ivData.username_auth,
    userId
  );

  const password = decryptValue(
    encrypted_password,
    ivData.password_iv,
    ivData.password_auth,
    userId
  );

  return { username, password };
}

function decryptValue(
  encryptedHex: string,
  ivHex: string,
  authTagHex: string,
  userId: string
): string {
  const salt = Buffer.from(userId.replace(/-/g, ""), "hex").subarray(0, 32);
  const key = crypto.scryptSync(MASTER_ENCRYPTION_KEY, salt, 32);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// -- Routes --

/**
 * POST /api/auto-buy
 * Receives auto-buy jobs from QStash/main app.
 */
app.post("/api/auto-buy", authenticateWorkerRequest, async (req, res) => {
  const { type, payload } = req.body;

  if (type !== "auto_buy" || !payload) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const {
    watchlist_item_id,
    user_id,
    retailer,
    product_url,
    product_sku,
    mode,
    max_price,
    quantity,
    encrypted_credentials,
  } = payload;

  console.log(`[${watchlist_item_id}] Received auto-buy job for ${retailer}`);

  // Decrypt credentials
  let username: string;
  let password: string;

  try {
    const creds = decryptCredentials(
      encrypted_credentials.encrypted_username,
      encrypted_credentials.encrypted_password,
      encrypted_credentials.encryption_iv,
      user_id
    );
    username = creds.username;
    password = creds.password;
  } catch (error) {
    console.error(`[${watchlist_item_id}] Failed to decrypt credentials:`, error);
    res.status(500).json({ error: "Credential decryption failed" });
    return;
  }

  // Execute auto-buy in the background (don't block the response)
  // QStash needs a response within 30 seconds
  res.json({ accepted: true, job_id: watchlist_item_id });

  // Run the actual purchase flow
  try {
    const result = await executeAutoBuy(payload, username, password);

    // Report result back to main app
    const callbackUrl =
      process.env.CALLBACK_URL || "http://localhost:3000/api/webhooks/worker-callback";

    await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-api-key": WORKER_API_KEY,
      },
      body: JSON.stringify({
        type: "worker_result",
        payload: {
          job_id: watchlist_item_id,
          watchlist_item_id,
          user_id,
          event_type: result.status === "success" ? "checkout_complete" : "checkout_failed",
          purchase_result: result,
        },
      }),
    });

    console.log(`[${watchlist_item_id}] Auto-buy completed: ${result.status}`);
  } catch (error) {
    console.error(`[${watchlist_item_id}] Auto-buy failed:`, error);
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// -- Graceful Shutdown --

process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await cleanup();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down worker...");
  await cleanup();
  process.exit(0);
});

// -- Start Server --

app.listen(PORT, () => {
  console.log(`Stock Sniper Worker running on port ${PORT}`);
});
