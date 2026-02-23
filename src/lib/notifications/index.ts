import twilio from "twilio";
import { createAdminClient } from "@/lib/db/supabase-server";
import type { WatchlistItem, StockCheckResult } from "@/types";

let twilioClient: twilio.Twilio | null = null;

function getTwilioClient(): twilio.Twilio {
  if (!twilioClient) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }
  return twilioClient;
}

/**
 * Send an SMS stock alert to a user.
 */
export async function sendStockAlert(
  userId: string,
  item: WatchlistItem,
  stockResult: StockCheckResult
): Promise<void> {
  const supabase = createAdminClient();

  // Get user's phone number
  const { data: user } = await supabase
    .from("users")
    .select("phone, full_name")
    .eq("id", userId)
    .single();

  if (!user?.phone) {
    console.warn(`User ${userId} has no phone number, skipping SMS`);
    return;
  }

  const priceStr = stockResult.price ? `$${stockResult.price.toFixed(2)}` : "Price unknown";
  const message = `🎯 Stock Alert!\n\n${stockResult.product_name}\n${priceStr}\n\n${item.mode === "auto_buy" ? "Auto-buy is attempting purchase..." : "Go grab it!"}\n\n${item.product_url}`;

  try {
    const client = getTwilioClient();
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: user.phone,
    });

    // Log the notification
    await supabase.from("notifications").insert({
      user_id: userId,
      watchlist_item_id: item.id,
      type: "sms",
      message,
      delivered: true,
    });
  } catch (error) {
    console.error(`Failed to send SMS to user ${userId}:`, error);

    // Log failed notification
    await supabase.from("notifications").insert({
      user_id: userId,
      watchlist_item_id: item.id,
      type: "sms",
      message,
      delivered: false,
    });
  }
}

/**
 * Send a purchase confirmation SMS.
 */
export async function sendPurchaseConfirmation(
  userId: string,
  productName: string,
  orderNumber: string,
  totalPrice: number
): Promise<void> {
  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("phone")
    .eq("id", userId)
    .single();

  if (!user?.phone) return;

  const message = `✅ Purchase Successful!\n\n${productName}\nOrder #${orderNumber}\nTotal: $${totalPrice.toFixed(2)}\n\nCheck your retailer account for details.`;

  try {
    const client = getTwilioClient();
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: user.phone,
    });
  } catch (error) {
    console.error(`Failed to send purchase confirmation to user ${userId}:`, error);
  }
}

/**
 * Send a purchase failure alert.
 */
export async function sendPurchaseFailure(
  userId: string,
  productName: string,
  reason: string
): Promise<void> {
  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("phone")
    .eq("id", userId)
    .single();

  if (!user?.phone) return;

  const message = `❌ Auto-buy Failed\n\n${productName}\nReason: ${reason}\n\nThe item may still be in stock — try buying manually!`;

  try {
    const client = getTwilioClient();
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: user.phone,
    });
  } catch (error) {
    console.error(`Failed to send failure alert to user ${userId}:`, error);
  }
}
