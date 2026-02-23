import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import Stripe from "stripe";

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia" as any,
  });
}

const TIER_MAP: Record<string, string> = {
  // Map Stripe price IDs to tier names
  // Configure these in your Stripe dashboard
  price_pro_monthly: "pro",
  price_premium_monthly: "premium",
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      // Get subscription details to determine tier
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const tier = TIER_MAP[priceId] || "pro";

      // Update user
      await supabase
        .from("users")
        .update({
          subscription_tier: tier,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        })
        .eq("email", session.customer_email!);

      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const priceId = subscription.items.data[0]?.price.id;
      const tier = TIER_MAP[priceId] || "free";
      const customerId = subscription.customer as string;

      await supabase
        .from("users")
        .update({ subscription_tier: tier })
        .eq("stripe_customer_id", customerId);

      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Downgrade to free
      await supabase
        .from("users")
        .update({
          subscription_tier: "free",
          stripe_subscription_id: null,
        })
        .eq("stripe_customer_id", customerId);

      // Deactivate auto-buy items (not allowed on free tier)
      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();

      if (user) {
        await supabase
          .from("watchlist_items")
          .update({ mode: "notify_only" })
          .eq("user_id", user.id)
          .eq("mode", "auto_buy");
      }

      break;
    }
  }

  return NextResponse.json({ received: true });
}