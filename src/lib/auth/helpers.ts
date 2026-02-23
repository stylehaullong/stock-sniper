import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { NextResponse } from "next/server";
import type { User, TierLimits } from "@/types";
import { TIER_LIMITS } from "@/types";

/**
 * Get the authenticated user from the current request.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  return profile as User | null;
}

/**
 * Require authentication - returns user or error response.
 */
export async function requireAuth(): Promise<
  { user: User; error?: never } | { user?: never; error: NextResponse }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!user.is_active) {
    return {
      error: NextResponse.json({ error: "Account is deactivated" }, { status: 403 }),
    };
  }

  return { user };
}

/**
 * Get the tier limits for a user.
 */
export function getUserLimits(user: User): TierLimits {
  return TIER_LIMITS[user.subscription_tier];
}
