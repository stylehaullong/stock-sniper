import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";

// GET /api/settings - Get current user settings
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServerSupabaseClient();

  const { data: user, error } = await supabase
    .from("users")
    .select("full_name, email, phone, subscription_tier, created_at")
    .eq("id", auth.user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get watchlist count for usage display
  const { count: watchlistCount } = await supabase
    .from("watchlist_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  const tierLimits: Record<string, { max_items: number; min_poll: string; auto_buy: boolean }> = {
    free: { max_items: 3, min_poll: "5 min", auto_buy: false },
    pro: { max_items: 15, min_poll: "1 min", auto_buy: true },
    premium: { max_items: 50, min_poll: "30 sec", auto_buy: true },
  };

  const tier = user.subscription_tier || "free";
  const limits = tierLimits[tier] || tierLimits.free;

  return NextResponse.json({
    user,
    usage: {
      watchlist_count: watchlistCount || 0,
      ...limits,
    },
  });
}

// PATCH /api/settings - Update user settings
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const supabase = await createServerSupabaseClient();

  const updates: Record<string, any> = {};

  if (body.full_name !== undefined) {
    updates.full_name = body.full_name;
  }
  if (body.phone !== undefined) {
    // Basic E.164 validation
    if (body.phone && !/^\+?[1-9]\d{1,14}$/.test(body.phone)) {
      return NextResponse.json({ error: "Invalid phone format (use E.164: +1234567890)" }, { status: 400 });
    }
    updates.phone = body.phone || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
