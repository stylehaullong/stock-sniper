import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { endSession } from "@/lib/browserbase/context-manager";

/**
 * POST /api/credentials/connect/complete
 * Called when user confirms they've completed login + MFA.
 * Closes the session (saving context) and marks credential as connected.
 * Body: { credential_id: string, session_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;
    const { credential_id, session_id } = await req.json();

    if (!credential_id || !session_id) {
      return NextResponse.json(
        { error: "credential_id and session_id are required" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();

    // Verify ownership
    const { data: cred, error } = await supabase
      .from("retailer_credentials")
      .select("id, browserbase_context_id")
      .eq("id", credential_id)
      .eq("user_id", user.id)
      .single();

    if (error || !cred) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    // End the session — this saves the context (cookies, session storage)
    try {
      await endSession(session_id);
      // Give Browserbase a few seconds to persist the context
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err: any) {
      console.error("[Connect Complete] Error ending session:", err.message);
    }

    // Mark credential as connected
    await supabase
      .from("retailer_credentials")
      .update({
        connection_status: "connected",
        connected_at: new Date().toISOString(),
      })
      .eq("id", credential_id);

    return NextResponse.json({ success: true, status: "connected" });
  } catch (error: any) {
    console.error("[Connect Complete] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}