import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";

// GET /api/dashboard/stats
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServerSupabaseClient();
  const userId = auth.user.id;

  // Run all queries in parallel
  const [
    watchlistRes,
    inStockRes,
    purchasesRes,
    alertsRes,
    activityRes,
    userRes,
  ] = await Promise.all([
    // Active monitoring items
    supabase
      .from("watchlist_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true),

    // Currently in-stock items
    supabase
      .from("watchlist_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("last_status", "in_stock"),

    // Successful purchases (all time)
    supabase
      .from("purchase_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "success"),

    // Stock alerts this week
    supabase
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_type", "stock_found")
      .gte("created_at", getWeekStart()),

    // Recent activity (last 20 entries)
    supabase
      .from("activity_log")
      .select("id, event_type, created_at, watchlist_item_id, details")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),

    // User info for tier
    supabase
      .from("users")
      .select("subscription_tier, phone, full_name, email")
      .eq("id", userId)
      .single(),
  ]);

  // Get watchlist items for name lookup
  const { data: watchlistItems } = await supabase
    .from("watchlist_items")
    .select("id, product_name, retailer")
    .eq("user_id", userId);

  const itemMap = new Map(
    (watchlistItems || []).map((i) => [i.id, { name: i.product_name, retailer: i.retailer }])
  );

  // Enrich activity with product names
  const activity = (activityRes.data || []).map((a) => {
    const item = itemMap.get(a.watchlist_item_id);
    return {
      id: a.id,
      event_type: a.event_type,
      created_at: a.created_at,
      product_name: item?.name || a.details?.product_name || "Unknown",
      retailer: item?.retailer || a.details?.retailer || "unknown",
      details: a.details,
    };
  });

  return NextResponse.json({
    stats: {
      monitoring: watchlistRes.count || 0,
      in_stock: inStockRes.count || 0,
      purchased: purchasesRes.count || 0,
      alerts_this_week: alertsRes.count || 0,
    },
    activity,
    user: userRes.data || null,
  });
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek;
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString();
}
