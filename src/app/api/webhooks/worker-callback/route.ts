import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { getAdapter } from "@/lib/adapters";
import { parseStockStatus } from "@/lib/ai/page-parser";
import { sendStockAlert, sendPurchaseConfirmation, sendPurchaseFailure } from "@/lib/notifications";
import {
  enqueueAutoBuy,
  acquireLock,
  releaseLock,
  checkUserRateLimit,
  getActiveSessionCount,
  incrementSessionCount,
} from "@/lib/queue";
import { decryptCredentials } from "@/lib/encryption";
import { TIER_LIMITS } from "@/types";
import type { MonitorJobPayload, WorkerCallbackPayload, WatchlistItem } from "@/types";

// POST /api/webhooks/worker-callback
export async function POST(request: NextRequest) {
  // Verify the request is from QStash or our worker
  // In production, verify QStash signature or worker API key
  const workerApiKey = request.headers.get("x-worker-api-key");
  const isFromWorker = workerApiKey === process.env.WORKER_API_KEY;

  // QStash sends its own verification headers
  // TODO: Verify QStash signature in production

  const body = await request.json();
  const { type } = body;

  try {
    switch (type) {
      case "run_scheduler":
        return await handleSchedulerRun();

      case "stock_check":
        return await handleStockCheck(body.payload as MonitorJobPayload);

      case "worker_result":
        if (!isFromWorker) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return await handleWorkerResult(body.payload as WorkerCallbackPayload);

      default:
        return NextResponse.json({ error: `Unknown job type: ${type}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`Error processing ${type}:`, error);
    return NextResponse.json(
      { error: "Internal processing error" },
      { status: 500 }
    );
  }
}

/**
 * Scheduler: Find items due for polling and enqueue stock checks.
 * Runs every minute via QStash cron.
 */
async function handleSchedulerRun(): Promise<NextResponse> {
  const supabase = createAdminClient();

  // Get items due for polling
  const { data: items, error } = await supabase.rpc("get_items_due_for_polling", {
    batch_size: 50,
  });

  if (error || !items) {
    console.error("Failed to get polling items:", error);
    return NextResponse.json({ error: "Scheduler failed" }, { status: 500 });
  }

  let enqueued = 0;

  for (const item of items as WatchlistItem[]) {
    // Rate limit per user
    const withinLimit = await checkUserRateLimit(item.user_id, 60);
    if (!withinLimit) continue;

    // Acquire lock to prevent duplicate processing
    const lockKey = `lock:stock-check:${item.id}`;
    const locked = await acquireLock(lockKey, item.poll_interval_seconds);
    if (!locked) continue;

    try {
      const adapter = getAdapter(item.retailer);

      // For now, stock checks happen in this serverless function
      // For auto-buy, we'll dispatch to the external worker
      const payload: MonitorJobPayload = {
        watchlist_item_id: item.id,
        user_id: item.user_id,
        retailer: item.retailer,
        product_url: item.product_url,
        product_sku: item.product_sku,
        mode: item.mode,
        max_price: item.max_price ? Number(item.max_price) : null,
        quantity: item.quantity,
      };

      // TODO: In production, this would fetch the page via proxy
      // For now, we use a lightweight API check or headless fetch
      await handleStockCheck(payload);
      enqueued++;
    } catch (err) {
      console.error(`Error processing item ${item.id}:`, err);
      await releaseLock(lockKey);
    }
  }

  return NextResponse.json({ processed: enqueued, total: items.length });
}

/**
 * Handle a stock check for a single product.
 * This runs in a Vercel serverless function — lightweight check only.
 */
async function handleStockCheck(payload: MonitorJobPayload): Promise<NextResponse> {
  const supabase = createAdminClient();
  const adapter = getAdapter(payload.retailer);

  try {
    // Fetch page content via Target's API or a lightweight fetch
    // In production, this goes through a residential proxy
    const pageResponse = await fetch(payload.product_url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!pageResponse.ok) {
      throw new Error(`HTTP ${pageResponse.status} fetching product page`);
    }

    const pageContent = await pageResponse.text();

    // Use AI to parse the page and determine stock status
    const stockPrompt = adapter.getStockCheckPrompt(
      // Truncate to avoid excessive token usage
      pageContent.substring(0, 15000)
    );
    const stockResult = await parseStockStatus(pageContent.substring(0, 15000), stockPrompt);

    // Update the watchlist item with latest status
    const newStatus = stockResult.in_stock ? "in_stock" : "out_of_stock";
    await supabase
      .from("watchlist_items")
      .update({
        last_checked_at: new Date().toISOString(),
        last_status: newStatus,
        last_price: stockResult.price,
        product_name: stockResult.product_name || undefined,
        product_image_url: stockResult.product_image_url || undefined,
      })
      .eq("id", payload.watchlist_item_id);

    // Log the check
    await supabase.from("activity_log").insert({
      user_id: payload.user_id,
      watchlist_item_id: payload.watchlist_item_id,
      event_type: stockResult.in_stock ? "stock_found" : "stock_check",
      details: {
        in_stock: stockResult.in_stock,
        price: stockResult.price,
        raw_status: stockResult.raw_status,
      },
    });

    // If in stock, take action based on mode
    if (stockResult.in_stock && stockResult.add_to_cart_available) {
      // Check max price constraint
      if (payload.max_price && stockResult.price && stockResult.price > payload.max_price) {
        console.log(
          `Item ${payload.watchlist_item_id} in stock but price $${stockResult.price} exceeds max $${payload.max_price}`
        );
        return NextResponse.json({ status: "price_exceeded", result: stockResult });
      }

      // Get the watchlist item for full context
      const { data: item } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("id", payload.watchlist_item_id)
        .single();

      if (!item) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }

      // Always send notification
      await sendStockAlert(payload.user_id, item as WatchlistItem, stockResult);

      // If auto-buy mode, dispatch to external worker
      if (payload.mode === "auto_buy") {
        await dispatchAutoBuy(payload, supabase);
      }
    }

    return NextResponse.json({ status: "checked", result: stockResult });
  } catch (error) {
    console.error(`Stock check failed for ${payload.watchlist_item_id}:`, error);

    await supabase.from("activity_log").insert({
      user_id: payload.user_id,
      watchlist_item_id: payload.watchlist_item_id,
      event_type: "error",
      details: { error: String(error), stage: "stock_check" },
    });

    return NextResponse.json({ error: "Stock check failed" }, { status: 500 });
  }
}

/**
 * Dispatch an auto-buy job to the external worker service.
 */
async function dispatchAutoBuy(
  payload: MonitorJobPayload,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  // Get user's tier to check concurrent session limits
  const { data: user } = await supabase
    .from("users")
    .select("subscription_tier")
    .eq("id", payload.user_id)
    .single();

  if (!user) return;

  const limits = TIER_LIMITS[user.subscription_tier as keyof typeof TIER_LIMITS];
  const activeSessions = await getActiveSessionCount(payload.user_id);

  if (activeSessions >= limits.max_concurrent_sessions) {
    console.log(`User ${payload.user_id} at max concurrent sessions (${activeSessions}/${limits.max_concurrent_sessions})`);
    return;
  }

  // Get encrypted credentials
  const { data: creds } = await supabase
    .from("retailer_credentials")
    .select("encrypted_username, encrypted_password, encryption_iv")
    .eq("user_id", payload.user_id)
    .eq("retailer", payload.retailer)
    .single();

  if (!creds) {
    console.error(`No credentials found for user ${payload.user_id} retailer ${payload.retailer}`);
    return;
  }

  // Create purchase attempt record
  const { data: purchase } = await supabase
    .from("purchase_attempts")
    .insert({
      user_id: payload.user_id,
      watchlist_item_id: payload.watchlist_item_id,
      status: "detected",
      retailer: payload.retailer,
      product_name: "Purchasing...",
    })
    .select("id")
    .single();

  // Increment active sessions
  await incrementSessionCount(payload.user_id);

  // Send to external worker with encrypted credentials
  await enqueueAutoBuy({
    ...payload,
    encrypted_credentials: {
      encrypted_username: creds.encrypted_username,
      encrypted_password: creds.encrypted_password,
      encryption_iv: creds.encryption_iv,
    },
  });
}

/**
 * Handle results coming back from the external browser worker.
 */
async function handleWorkerResult(payload: WorkerCallbackPayload): Promise<NextResponse> {
  const supabase = createAdminClient();

  // Log the activity
  await supabase.from("activity_log").insert({
    user_id: payload.user_id,
    watchlist_item_id: payload.watchlist_item_id,
    event_type: payload.event_type,
    details: {
      stock_result: payload.stock_result,
      purchase_result: payload.purchase_result,
    },
  });

  // Handle purchase results
  if (payload.purchase_result) {
    const pr = payload.purchase_result;

    // Update purchase attempt
    await supabase
      .from("purchase_attempts")
      .update({
        status: pr.status,
        failure_reason: pr.failure_reason || null,
        screenshot_url: pr.screenshot_url || null,
        total_price: pr.total_price || null,
        order_number: pr.order_number || null,
      })
      .eq("watchlist_item_id", payload.watchlist_item_id)
      .eq("user_id", payload.user_id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Send appropriate notification
    if (pr.status === "success" && pr.order_number) {
      await sendPurchaseConfirmation(
        payload.user_id,
        "Item", // Would get from watchlist item
        pr.order_number,
        pr.total_price || 0
      );

      // Optionally deactivate the watchlist item after successful purchase
      await supabase
        .from("watchlist_items")
        .update({ is_active: false })
        .eq("id", payload.watchlist_item_id);
    } else if (pr.status === "failed") {
      await sendPurchaseFailure(
        payload.user_id,
        "Item",
        pr.failure_reason || "Unknown error"
      );
    }
  }

  return NextResponse.json({ received: true });
}
