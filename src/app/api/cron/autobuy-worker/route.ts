import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { createAdminClient } from "@/lib/db/supabase-server";
import { decryptCredentials } from "@/lib/encryption";
import { executeAutoBuy } from "@/lib/autobuy/browserbase-engine";

export const maxDuration = 120; // 2 minutes for auto-buy

/**
 * POST /api/cron/autobuy-worker
 * Called by QStash when stock is found for an auto-buy item.
 * Decrypts credentials and runs the Browserbase auto-buy engine.
 */
export async function POST(request: NextRequest) {
  // Verify QStash signature in production
  const body = await request.text();

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

      const isValid = await receiver.verify({ signature, body });
      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } catch (err) {
      console.error("QStash verification failed:", err);
      return NextResponse.json({ error: "Verification failed" }, { status: 401 });
    }
  }

  const { item_id, user_id, attempt_id } = JSON.parse(body);

  if (!item_id || !user_id) {
    return NextResponse.json({ error: "item_id and user_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    // Get watchlist item — scoped to user_id to prevent cross-tenant access
    const { data: item } = await supabase
      .from("watchlist_items")
      .select("*")
      .eq("id", item_id)
      .eq("user_id", user_id)
      .single();

    if (!item) {
      return NextResponse.json({ error: "Item not found or user mismatch" }, { status: 404 });
    }

    // Safety: verify item.user_id matches the job's user_id
    if (item.user_id !== user_id) {
      console.error(`[AutoBuy Worker] TENANT MISMATCH: item ${item_id} belongs to ${item.user_id}, job says ${user_id}`);
      return NextResponse.json({ error: "Tenant mismatch" }, { status: 403 });
    }

    // Get credentials — prefer item's assigned credential, fallback to first for retailer
    let credsQuery = supabase
      .from("retailer_credentials")
      .select("*")
      .eq("user_id", user_id)
      .eq("retailer", item.retailer);

    if (item.credential_id) {
      credsQuery = credsQuery.eq("id", item.credential_id);
    }

    const { data: credsList } = await credsQuery.limit(1);
    const creds = credsList?.[0];

    if (!creds) {
      await updateAttempt(supabase, attempt_id, "failed", "No credentials saved");
      return NextResponse.json({ error: "No credentials" }, { status: 400 });
    }

    // Decrypt credentials
    let username: string, password: string, cvv: string | undefined;
    try {
      const decrypted = decryptCredentials(
        creds.encrypted_username,
        creds.encrypted_password,
        creds.encryption_iv,
        user_id,
        creds.encrypted_cvv
      );
      username = decrypted.username;
      password = decrypted.password;
      cvv = decrypted.cvv;
    } catch {
      await updateAttempt(supabase, attempt_id, "failed", "Failed to decrypt credentials");
      return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
    }

    // Run auto-buy
    console.log(`[AutoBuy Worker] Starting for item ${item_id}`);

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

    // Map to valid DB status
    const dbStatus =
      result.status === "success" ? "success"
        : result.status === "carted" ? "carted"
        : "failed";

    await updateAttempt(supabase, attempt_id, dbStatus, result.failure_reason, result.order_number, result.total_price);

    // Log result
    await supabase.from("activity_log").insert({
      user_id,
      watchlist_item_id: item_id,
      event_type: result.status === "success" ? "purchase_success" : "purchase_failed",
      details: {
        attempt_id,
        status: result.status,
        order_number: result.order_number,
        steps: result.steps_completed,
        failure_reason: result.failure_reason,
        source: "cron_autobuy",
      },
    });

    console.log(`[AutoBuy Worker] Done for ${item_id}: ${result.status}`);

    return NextResponse.json({ result });
  } catch (err: any) {
    console.error(`[AutoBuy Worker] Fatal error for ${item_id}:`, err);
    await updateAttempt(supabase, attempt_id, "failed", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function updateAttempt(
  supabase: any,
  attemptId: string | undefined,
  status: string,
  failureReason?: string,
  orderNumber?: string,
  totalPrice?: number
) {
  if (!attemptId) return;
  await supabase
    .from("purchase_attempts")
    .update({
      status,
      failure_reason: failureReason || null,
      order_number: orderNumber || null,
      total_price: totalPrice || null,
    })
    .eq("id", attemptId);
}