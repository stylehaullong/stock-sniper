import { Client } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import type { MonitorJobPayload, AutoBuyJobPayload } from "@/types";

// QStash client for scheduling jobs
const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
});

// Redis for rate limiting and state management
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export { redis };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Schedule a stock monitoring check.
 * This is called by the scheduler to enqueue individual product checks.
 */
export async function enqueueStockCheck(payload: MonitorJobPayload): Promise<string> {
  const response = await qstash.publishJSON({
    url: `${APP_URL}/api/webhooks/worker-callback`,
    body: {
      type: "stock_check",
      payload,
    },
    retries: 2,
    // Deduplicate by watchlist item ID to prevent double-checks
    deduplicationId: `stock-check-${payload.watchlist_item_id}`,
  });

  return response.messageId;
}

/**
 * Schedule an auto-buy job.
 * This is triggered when stock is detected for an auto-buy watchlist item.
 * Sent to the external worker service, not Vercel.
 */
export async function enqueueAutoBuy(payload: AutoBuyJobPayload): Promise<string> {
  const workerUrl = process.env.WORKER_BASE_URL;
  if (!workerUrl) {
    throw new Error("WORKER_BASE_URL is not configured");
  }

  const response = await qstash.publishJSON({
    url: `${workerUrl}/api/auto-buy`,
    body: {
      type: "auto_buy",
      payload,
    },
    retries: 1, // Don't retry auto-buy aggressively (could double-purchase)
    // Deduplicate to prevent multiple buy attempts for same item
    deduplicationId: `auto-buy-${payload.watchlist_item_id}-${Date.now()}`,
    headers: {
      "x-worker-api-key": process.env.WORKER_API_KEY!,
    },
  });

  return response.messageId;
}

/**
 * Schedule the main polling scheduler to run periodically.
 * This is a cron-like job that checks which items are due for polling.
 */
export async function schedulePollingCron(): Promise<void> {
  await qstash.schedules.create({
    destination: `${APP_URL}/api/webhooks/worker-callback`,
    body: JSON.stringify({ type: "run_scheduler" }),
    cron: "* * * * *", // Every minute
    retries: 1,
  });
}

// -- Rate Limiting --

/**
 * Check if a user has exceeded their rate limit for stock checks.
 */
export async function checkUserRateLimit(
  userId: string,
  maxChecksPerMinute: number
): Promise<boolean> {
  const key = `rate:user:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 60);
  }

  return current <= maxChecksPerMinute;
}

/**
 * Track concurrent auto-buy sessions per user.
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  const key = `sessions:${userId}`;
  const count = await redis.get<number>(key);
  return count || 0;
}

export async function incrementSessionCount(userId: string): Promise<void> {
  const key = `sessions:${userId}`;
  await redis.incr(key);
  await redis.expire(key, 300); // Auto-expire after 5 minutes
}

export async function decrementSessionCount(userId: string): Promise<void> {
  const key = `sessions:${userId}`;
  const current = await redis.get<number>(key);
  if (current && current > 0) {
    await redis.decr(key);
  }
}

/**
 * Distributed lock to prevent duplicate processing of the same item.
 */
export async function acquireLock(
  lockKey: string,
  ttlSeconds: number = 60
): Promise<boolean> {
  const result = await redis.set(lockKey, "locked", {
    nx: true,
    ex: ttlSeconds,
  });
  return result === "OK";
}

export async function releaseLock(lockKey: string): Promise<void> {
  await redis.del(lockKey);
}
