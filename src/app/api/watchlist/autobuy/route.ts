import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { decryptCredentials } from "@/lib/encryption";
import { executeAutoBuy } from "@/lib/autobuy/browserbase-engine";

export const maxDuration = 120; // Allow up to 2 minutes for the auto-buy flow

// POST /api/watchlist/autobuy - Trigger auto-buy for a watchlist item
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { item_id } = await request.json();
  if (!item_id) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }

  // Validate Browserbase is configured
  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return NextResponse.json(
      { error: "Browserbase not configured. Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to .env.local" },
      { status: 500 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  const supabase = await createServerSupabaseClient();

  // Get the watchlist item
  const { data: item, error: fetchError } = await supabase
    .from("watchlist_items")
    .select("*")
    .eq("id", item_id)
    .eq("user_id", auth.user.id)
    .single();

  if (fetchError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.mode !== "auto_buy") {
    return NextResponse.json(
      { error: "Item is not in auto-buy mode" },
      { status: 400 }
    );
  }

  // Get encrypted credentials — prefer item's assigned credential, fallback to first match
  let credsQuery = supabase
    .from("retailer_credentials")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("retailer", item.retailer);

  if (item.credential_id) {
    credsQuery = credsQuery.eq("id", item.credential_id);
  }

  const { data: credsList, error: credsError } = await credsQuery.limit(1);
  const creds = credsList?.[0];

  if (credsError || !creds) {
    return NextResponse.json(
      { error: `No credentials saved for ${item.retailer}. Add them in Credentials settings.` },
      { status: 400 }
    );
  }

  // Decrypt credentials
  let username: string;
  let password: string;
  let cvv: string | undefined;
  try {
    const decrypted = decryptCredentials(
      creds.encrypted_username,
      creds.encrypted_password,
      creds.encryption_iv,
      auth.user.id,
      creds.encrypted_cvv
    );
    username = decrypted.username;
    password = decrypted.password;
    cvv = decrypted.cvv;
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to decrypt credentials. Try re-saving them." },
      { status: 500 }
    );
  }

  // Create a purchase attempt record
  const { data: attempt, error: attemptError } = await supabase
    .from("purchase_attempts")
    .insert({
      user_id: auth.user.id,
      watchlist_item_id: item_id,
      retailer: item.retailer,
      product_name: item.product_name,
      status: "detected",
    })
    .select()
    .single();

  if (attemptError) {
    return NextResponse.json({ error: attemptError.message }, { status: 500 });
  }

  // Log the attempt
  await supabase.from("activity_log").insert({
    user_id: auth.user.id,
    watchlist_item_id: item_id,
    event_type: "auto_buy_started",
    details: { attempt_id: attempt.id },
  });

  try {
    // Execute the auto-buy flow
    const result = await executeAutoBuy({
      product_url: item.product_url,
      product_name: item.product_name,
      max_price: item.max_price ? parseFloat(item.max_price) : null,
      quantity: item.quantity || 1,
      retailer: item.retailer,
      username,
      password,
      cvv,
      browserbase_context_id: creds.browserbase_context_id || null,
    });

    // Map engine status to DB-valid status
    const dbStatus =
      result.status === "success" ? "success"
        : result.status === "carted" ? "carted"
        : result.status === "out_of_stock" ? "failed"
        : "failed";

    // Update the purchase attempt record
    await supabase
      .from("purchase_attempts")
      .update({
        status: dbStatus,
        order_number: result.order_number || null,
        total_price: result.total_price || null,
        failure_reason: result.failure_reason || null,
      })
      .eq("id", attempt.id);

    // Log the result
    await supabase.from("activity_log").insert({
      user_id: auth.user.id,
      watchlist_item_id: item_id,
      event_type:
        result.status === "success"
          ? "purchase_success"
          : result.status === "out_of_stock"
          ? "stock_check"
          : "purchase_failed",
      details: {
        attempt_id: attempt.id,
        status: result.status,
        order_number: result.order_number,
        total_price: result.total_price,
        failure_reason: result.failure_reason,
        steps: result.steps_completed,
      },
    });

    return NextResponse.json({
      result,
      attempt_id: attempt.id,
    });
  } catch (error: any) {
    // Update attempt as failed
    await supabase
      .from("purchase_attempts")
      .update({
        status: "failed",
        failure_reason: error.message || String(error),
      })
      .eq("id", attempt.id);

    return NextResponse.json(
      { error: error.message || "Auto-buy failed", status: "failed" },
      { status: 500 }
    );
  }
}