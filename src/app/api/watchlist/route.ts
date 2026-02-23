import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth, getUserLimits } from "@/lib/auth/helpers";
import { detectAdapter } from "@/lib/adapters";
import { z } from "zod";
import { ensureScheduleExists, removeScheduleIfEmpty } from "@/lib/scheduler";

// Validation schemas
const addItemSchema = z.object({
  product_url: z.string().url(),
  mode: z.enum(["notify_only", "auto_buy"]).default("notify_only"),
  poll_interval_seconds: z.number().min(30).max(3600).optional(),
  max_price: z.number().positive().optional(),
  quantity: z.number().int().min(1).max(10).default(1),
  product_name: z.string().optional(),
});

const updateItemSchema = z.object({
  mode: z.enum(["notify_only", "auto_buy"]).optional(),
  poll_interval_seconds: z.number().min(30).max(3600).optional(),
  max_price: z.number().positive().nullable().optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  is_active: z.boolean().optional(),
});

// GET /api/watchlist - List user's watchlist items
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data });
}

// POST /api/watchlist - Add item to watchlist
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = addItemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { user } = auth;
  const limits = getUserLimits(user);
  const input = parsed.data;

  // Detect retailer from URL
  const adapter = detectAdapter(input.product_url);
  if (!adapter) {
    return NextResponse.json(
      { error: "Unsupported retailer. Currently supported: Target" },
      { status: 400 }
    );
  }

  // Enforce tier limits: watchlist count
  const supabase = await createServerSupabaseClient();
  const { count } = await supabase
    .from("watchlist_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if ((count || 0) >= limits.max_watchlist_items) {
    return NextResponse.json(
      {
        error: `You've reached the maximum of ${limits.max_watchlist_items} active items for your ${user.subscription_tier} plan.`,
        upgrade_required: true,
      },
      { status: 403 }
    );
  }

  // Enforce tier limits: mode
  if (!limits.modes_allowed.includes(input.mode)) {
    return NextResponse.json(
      {
        error: `Auto-buy is not available on the ${user.subscription_tier} plan.`,
        upgrade_required: true,
      },
      { status: 403 }
    );
  }

  // Enforce tier limits: poll interval
  const pollInterval = input.poll_interval_seconds || limits.min_poll_interval_seconds;
  if (pollInterval < limits.min_poll_interval_seconds) {
    return NextResponse.json(
      {
        error: `Minimum poll interval for ${user.subscription_tier} plan is ${limits.min_poll_interval_seconds} seconds.`,
        upgrade_required: true,
      },
      { status: 403 }
    );
  }

  // If auto_buy, check that user has credentials for this retailer
  if (input.mode === "auto_buy") {
    const { data: creds } = await supabase
      .from("retailer_credentials")
      .select("id")
      .eq("user_id", user.id)
      .eq("retailer", adapter.retailer)
      .single();

    if (!creds) {
      return NextResponse.json(
        {
          error: `Please add your ${adapter.displayName} login credentials before enabling auto-buy.`,
          needs_credentials: true,
        },
        { status: 400 }
      );
    }
  }

  // Extract product SKU from URL
  const productSku = adapter.extractProductId(input.product_url);

  // Try to fetch product name from Target's API
  let productName = input.product_name || "Unknown Product";
  let productImageUrl: string | null = null;
  if (productSku && adapter.retailer === "target") {
    try {
      const apiKey = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
      const res = await fetch(
        `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?key=${apiKey}&tcins=${productSku}&store_id=3991&zip=90045&state=CA&latitude=33.98&longitude=-118.47&has_required_store_id=true&channel=WEB&page=%2Fp%2FA-${productSku}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json",
            Referer: "https://www.target.com/",
            Origin: "https://www.target.com",
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        // product_summary_with_fulfillment returns array
        const summaries = data?.data?.product_summaries;
        if (summaries?.[0]?.item?.product_description?.title) {
          productName = summaries[0].item.product_description.title;
        }
        if (summaries?.[0]?.item?.enrichment?.images?.primary_image_url) {
          productImageUrl = summaries[0].item.enrichment.images.primary_image_url;
        }
        // Also try nested product format
        if (productName === "Unknown Product") {
          const product = data?.data?.product;
          if (product?.item?.product_description?.title) {
            productName = product.item.product_description.title;
          }
          if (product?.item?.enrichment?.images?.primary_image_url) {
            productImageUrl = product.item.enrichment.images.primary_image_url;
          }
        }
      }
    } catch {
      // Non-critical — just use defaults
    }
  }

  // Insert watchlist item
  const { data: item, error } = await supabase
    .from("watchlist_items")
    .insert({
      user_id: user.id,
      retailer: adapter.retailer,
      product_url: input.product_url,
      product_sku: productSku,
      product_name: productName,
      product_image_url: productImageUrl,
      mode: input.mode,
      poll_interval_seconds: pollInterval,
      max_price: input.max_price || null,
      quantity: input.quantity,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activity_log").insert({
    user_id: user.id,
    watchlist_item_id: item.id,
    event_type: "stock_check",
    details: { action: "item_added", product_url: input.product_url },
  });

  // Ensure the QStash cron schedule is running
  await ensureScheduleExists();

  return NextResponse.json({ item }, { status: 201 });
}

// PATCH /api/watchlist - Update watchlist item
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("id");

  if (!itemId) {
    return NextResponse.json({ error: "Item ID required" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = updateItemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const limits = getUserLimits(auth.user);
  const updates = parsed.data;

  // Enforce tier limits on mode change
  if (updates.mode && !limits.modes_allowed.includes(updates.mode)) {
    return NextResponse.json(
      { error: `Auto-buy requires a Pro or Premium plan.`, upgrade_required: true },
      { status: 403 }
    );
  }

  // Enforce poll interval
  if (updates.poll_interval_seconds && updates.poll_interval_seconds < limits.min_poll_interval_seconds) {
    return NextResponse.json(
      { error: `Minimum poll interval is ${limits.min_poll_interval_seconds}s for your plan.` },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("watchlist_items")
    .update(updates)
    .eq("id", itemId)
    .eq("user_id", auth.user.id) // RLS + explicit check
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

// DELETE /api/watchlist - Remove item from watchlist
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("id");

  if (!itemId) {
    return NextResponse.json({ error: "Item ID required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("watchlist_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Check if any active items remain — if not, remove the cron schedule
  const { count } = await supabase
    .from("watchlist_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  await removeScheduleIfEmpty(count || 0);

  return NextResponse.json({ success: true });
}
