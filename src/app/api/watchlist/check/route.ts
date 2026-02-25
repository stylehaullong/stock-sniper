import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { checkTargetStock, extractTcin } from "@/lib/target/stock-check";

// POST /api/watchlist/check
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { item_id } = await request.json();
  if (!item_id) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: item, error: fetchError } = await supabase
    .from("watchlist_items")
    .select("*")
    .eq("id", item_id)
    .eq("user_id", auth.user.id)
    .single();

  if (fetchError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    const tcin = extractTcin(item.product_url);
    if (!tcin) {
      return NextResponse.json(
        { error: "Could not extract Target product ID (TCIN) from URL" },
        { status: 400 }
      );
    }

    const result = await checkTargetStock(tcin, item.product_url);
    const newStatus = result.in_stock ? "in_stock" : "out_of_stock";

    await supabase
      .from("watchlist_items")
      .update({
        last_checked_at: new Date().toISOString(),
        last_status: newStatus,
        last_price: result.price,
        product_name: result.product_name,
        product_image_url: result.product_image_url,
      })
      .eq("id", item_id);

    await supabase.from("activity_log").insert({
      user_id: auth.user.id,
      watchlist_item_id: item_id,
      event_type: result.in_stock ? "stock_found" : "stock_check",
      details: {
        in_stock: result.in_stock,
        price: result.price,
        raw_status: result.raw_status,
        product_name: result.product_name,
        tcin,
      },
    });

    return NextResponse.json({
      result: {
        ...result,
        checked_at: new Date().toISOString(),
      },
      status: newStatus,
      auto_buy_eligible: result.in_stock && item.mode === "auto_buy",
    });
  } catch (error: any) {
    console.error(`Stock check failed for ${item_id}:`, error);

    await supabase.from("activity_log").insert({
      user_id: auth.user.id,
      watchlist_item_id: item_id,
      event_type: "error",
      details: { error: error.message, stage: "stock_check" },
    });

    return NextResponse.json(
      { error: error.message || "Stock check failed", status: "error" },
      { status: 500 }
    );
  }
}