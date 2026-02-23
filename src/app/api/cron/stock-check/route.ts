import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { createAdminClient } from "@/lib/db/supabase-server";
import { Redis } from "@upstash/redis";

const API_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.target.com/",
  Origin: "https://www.target.com",
};

// Max items to check per cron invocation (prevents timeout)
const MAX_ITEMS_PER_RUN = 50;

export const maxDuration = 60;

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

export async function POST(request: NextRequest) {
  // Verify QStash signature in production
  if (process.env.NODE_ENV === "production") {
    const signature = request.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    try {
      const receiver = new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
      });
      const body = await request.clone().text();
      const isValid = await receiver.verify({ signature, body });
      if (!isValid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    } catch (err) {
      console.error("QStash verification failed:", err);
      return NextResponse.json({ error: "Verification failed" }, { status: 401 });
    }
  }

  // Distributed lock: prevent overlapping cron runs
  const r = getRedis();
  if (r) {
    const lockAcquired = await r.set("cron:stock-check:lock", "running", { nx: true, ex: 55 });
    if (!lockAcquired) {
      return NextResponse.json({ skipped: true, message: "Previous cron still running" });
    }
  }

  const supabase = createAdminClient();

  try {
    // Fetch all active items with their user's tier info
    const { data: items, error } = await supabase
      .from("watchlist_items")
      .select("*, users!inner(id, subscription_tier, is_active)")
      .eq("is_active", true)
      .eq("users.is_active", true);

    if (error || !items || items.length === 0) {
      return NextResponse.json({ checked: 0, message: error?.message || "No active items" });
    }

    // Filter to items that are due for a check
    const now = Date.now();
    const dueItems = items.filter((item) => {
      if (!item.last_checked_at) return true;
      const lastCheck = new Date(item.last_checked_at).getTime();
      const intervalMs = (item.poll_interval_seconds || 300) * 1000;
      return now - lastCheck >= intervalMs;
    });

    if (dueItems.length === 0) {
      return NextResponse.json({ checked: 0, message: "No items due" });
    }

    // Fair scheduling: round-robin across users so no single user dominates
    const byUser = new Map<string, typeof dueItems>();
    for (const item of dueItems) {
      const uid = item.user_id;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(item);
    }

    const fairOrder: typeof dueItems = [];
    const userQueues = Array.from(byUser.values());
    let idx = 0;
    while (fairOrder.length < Math.min(dueItems.length, MAX_ITEMS_PER_RUN)) {
      let added = false;
      for (const queue of userQueues) {
        if (idx < queue.length) {
          fairOrder.push(queue[idx]);
          added = true;
          if (fairOrder.length >= MAX_ITEMS_PER_RUN) break;
        }
      }
      if (!added) break;
      idx++;
    }

    console.log(`[Cron] ${dueItems.length} due, checking ${fairOrder.length} (${byUser.size} users)`);

    let checked = 0;
    let stockFound = 0;
    let autoBuyTriggered = 0;
    const errors: string[] = [];

    // Deduplicate: track TCINs already checked this run (same product across users)
    const checkedTcins = new Map<string, { in_stock: boolean; price: number | null; product_name: string; product_image_url: string | null; raw_status: string }>();

    for (const item of fairOrder) {
      try {
        const tcin = extractTcin(item.product_url);
        if (!tcin) continue;

        // Per-item lock: skip if another cron already processing this item
        if (r) {
          const itemLock = await r.set(`cron:item:${item.id}`, "1", { nx: true, ex: 30 });
          if (!itemLock) continue; // Skip, being processed
        }

        // Reuse result if same TCIN already checked in this run
        let result = checkedTcins.get(tcin);
        if (!result) {
          result = await checkTargetStock(tcin);
          checkedTcins.set(tcin, result);
        }

        const newStatus = result.in_stock ? "in_stock" : "out_of_stock";

        // Update item
        await supabase
          .from("watchlist_items")
          .update({
            last_checked_at: new Date().toISOString(),
            last_status: newStatus,
            last_price: result.price,
            product_name: result.product_name || item.product_name,
            product_image_url: result.product_image_url || item.product_image_url,
          })
          .eq("id", item.id);

        // Log (batch-friendly: skip logging every out_of_stock to reduce noise)
        if (result.in_stock || !item.last_checked_at) {
          await supabase.from("activity_log").insert({
            user_id: item.user_id,
            watchlist_item_id: item.id,
            event_type: result.in_stock ? "stock_found" : "stock_check",
            details: {
              in_stock: result.in_stock,
              price: result.price,
              raw_status: result.raw_status,
              source: "cron",
            },
          });
        }

        checked++;

        if (result.in_stock && item.mode === "auto_buy") {
          stockFound++;

          // Auto-buy lock: one purchase attempt per item at a time
          if (r) {
            const buyLock = await r.set(`autobuy:${item.id}`, "1", { nx: true, ex: 180 });
            if (!buyLock) {
              console.log(`[Cron] Auto-buy already in progress for ${item.id}`);
              continue;
            }
          }

          try {
            await triggerAutoBuy(item, supabase);
            autoBuyTriggered++;
          } catch (buyErr: any) {
            errors.push(`autobuy ${item.id}: ${buyErr.message}`);
            // Release auto-buy lock on failure
            if (r) await r.del(`autobuy:${item.id}`);
          }
        }

        // Small delay between API calls
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (err: any) {
        errors.push(`${item.id}: ${err.message}`);
      }
    }

    console.log(`[Cron] Done: ${checked} checked, ${stockFound} stock found, ${autoBuyTriggered} auto-buys, ${errors.length} errors`);

    return NextResponse.json({
      checked,
      total_due: dueItems.length,
      users: byUser.size,
      stock_found: stockFound,
      auto_buy_triggered: autoBuyTriggered,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[Cron] Fatal:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    // Release cron lock
    if (r) await r.del("cron:stock-check:lock");
  }
}

// -- Auto-buy trigger --

async function triggerAutoBuy(item: any, supabase: any) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data: creds } = await supabase
    .from("retailer_credentials")
    .select("id")
    .eq("user_id", item.user_id)
    .eq("retailer", item.retailer)
    .single();

  if (!creds) {
    console.warn(`[Cron] No credentials for user ${item.user_id}`);
    return;
  }

  const { data: attempt } = await supabase
    .from("purchase_attempts")
    .insert({
      user_id: item.user_id,
      watchlist_item_id: item.id,
      retailer: item.retailer,
      product_name: item.product_name,
      status: "detected",
    })
    .select()
    .single();

  const { Client } = await import("@upstash/qstash");
  const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

  await qstash.publishJSON({
    url: `${appUrl}/api/cron/autobuy-worker`,
    body: {
      item_id: item.id,
      user_id: item.user_id,
      attempt_id: attempt?.id,
    },
    retries: 1,
    deduplicationId: `autobuy-${item.id}-${Math.floor(Date.now() / 60000)}`, // Dedup within same minute
  });
}

// -- Target Stock Check --

function extractTcin(url: string): string | null {
  const m = url.match(/A-(\d+)/);
  if (m) return m[1];
  const p = url.match(/preselect=(\d+)/);
  if (p) return p[1];
  return null;
}

async function tryFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function checkTargetStock(tcin: string) {
  const summaryUrl =
    `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1` +
    `?key=${API_KEY}&tcins=${tcin}&store_id=3991&zip=90045&state=CA&latitude=33.98&longitude=-118.47` +
    `&has_required_store_id=true&channel=WEB&page=%2Fp%2FA-${tcin}`;

  let data = await tryFetch(summaryUrl);
  if (data) {
    const parsed = parseSummary(data, tcin);
    if (parsed) return parsed;
  }

  const fulfillUrl =
    `https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1` +
    `?key=${API_KEY}&tcin=${tcin}&store_id=3991&store_positions_store_id=3991` +
    `&has_store_positions_store_id=true&zip=90045&state=CA&latitude=33.98&longitude=-118.47` +
    `&pricing_store_id=3991&has_pricing_store_id=true&is_bot=false`;

  data = await tryFetch(fulfillUrl);
  if (data) {
    const parsed = parseFulfillment(data, tcin);
    if (parsed) return parsed;
  }

  throw new Error(`All Target API endpoints failed for TCIN ${tcin}`);
}

function parseSummary(data: any, tcin: string) {
  const summaries = data?.data?.product_summaries;
  if (!summaries?.[0]) {
    if (data?.data?.product) return parseFulfillment(data, tcin);
    return null;
  }
  const p = summaries[0];
  const name = p?.item?.product_description?.title || `Target Product ${tcin}`;
  const img = p?.item?.enrichment?.images?.primary_image_url || null;
  const price = p?.price?.current_retail || p?.price?.reg_retail || null;
  const ship = p?.fulfillment?.shipping_options?.availability_status;
  const pickup = p?.fulfillment?.store_options?.[0]?.order_pickup?.availability_status;
  const inStock = isAvailable(ship) || isAvailable(pickup);
  return { in_stock: inStock, price, product_name: name, product_image_url: img, raw_status: fmtStatus(ship, pickup) };
}

function parseFulfillment(data: any, tcin: string) {
  const product = data?.data?.product;
  if (!product) return null;
  const name = product?.item?.product_description?.title || `Target Product ${tcin}`;
  const img = product?.item?.enrichment?.images?.primary_image_url || null;
  const price = product?.price?.current_retail || product?.price?.reg_retail || null;
  const ship = product?.fulfillment?.shipping_options?.availability_status;
  const pickups = product?.fulfillment?.store_options?.map((s: any) => s?.order_pickup?.availability_status) || [];
  const inStock = isAvailable(ship) || pickups.some(isAvailable);
  return { in_stock: inStock, price, product_name: name, product_image_url: img, raw_status: fmtStatus(ship, pickups[0]) };
}

function isAvailable(status: string | undefined): boolean {
  return status === "IN_STOCK" || status === "LIMITED_STOCK";
}

function fmtStatus(ship?: string, pickup?: string): string {
  const parts: string[] = [];
  if (ship) parts.push(`Ship: ${ship}`);
  if (pickup) parts.push(`Pickup: ${pickup}`);
  return parts.join(" | ") || "Unknown";
}
