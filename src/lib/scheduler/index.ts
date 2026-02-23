import { Client } from "@upstash/qstash";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const CRON_DESTINATION = `${APP_URL}/api/cron/stock-check`;

function getQStashClient() {
  return new Client({ token: process.env.QSTASH_TOKEN! });
}

/**
 * Ensure the stock-check cron schedule exists.
 * Called when a watchlist item is added.
 * Idempotent — if schedule already exists, does nothing.
 */
export async function ensureScheduleExists(): Promise<void> {
  if (!process.env.QSTASH_TOKEN) {
    console.warn("[Scheduler] QSTASH_TOKEN not set, skipping schedule creation");
    return;
  }

  try {
    const qstash = getQStashClient();
    const schedules = await qstash.schedules.list();

    // Check if our schedule already exists
    const existing = schedules.find((s) => s.destination === CRON_DESTINATION);
    if (existing) {
      return; // Already running
    }

    // Create — every minute (QStash minimum)
    await qstash.schedules.create({
      destination: CRON_DESTINATION,
      cron: "* * * * *",
      retries: 1,
    });

    console.log("[Scheduler] Created stock-check cron schedule");
  } catch (err) {
    console.error("[Scheduler] Failed to create schedule:", err);
  }
}

/**
 * Remove the stock-check cron schedule.
 * Called when the last active watchlist item is removed.
 */
export async function removeScheduleIfEmpty(activeItemCount: number): Promise<void> {
  if (!process.env.QSTASH_TOKEN) return;
  if (activeItemCount > 0) return;

  try {
    const qstash = getQStashClient();
    const schedules = await qstash.schedules.list();

    for (const schedule of schedules) {
      if (schedule.destination === CRON_DESTINATION) {
        await qstash.schedules.delete(schedule.scheduleId);
        console.log("[Scheduler] Removed stock-check cron schedule (no active items)");
      }
    }
  } catch (err) {
    console.error("[Scheduler] Failed to remove schedule:", err);
  }
}
