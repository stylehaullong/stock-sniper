import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { createContext, createSessionWithContext } from "@/lib/browserbase/context-manager";
import { decryptCredentials } from "@/lib/encryption";

export const maxDuration = 60; // Allow up to 60s for auto-fill + navigation

/**
 * POST /api/credentials/connect
 * Start a browser session for the user to complete login + MFA.
 * Body: { credential_id: string }
 * Returns: { session_id, live_view_url, context_id }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    const { user } = auth;
    const { credential_id } = await req.json();

    if (!credential_id) {
      return NextResponse.json({ error: "credential_id is required" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    // Fetch the credential
    const { data: cred, error: credError } = await supabase
      .from("retailer_credentials")
      .select("*")
      .eq("id", credential_id)
      .eq("user_id", user.id)
      .single();

    if (credError || !cred) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    // Decrypt credentials
    const { username, password } = decryptCredentials(
      cred.encrypted_username,
      cred.encrypted_password,
      cred.encryption_iv,
      user.id
    );

    // Create a new Browserbase context (or reuse existing)
    let contextId = cred.browserbase_context_id;
    if (!contextId) {
      contextId = await createContext();
    }

    // Create session with persistent context
    const { sessionId, liveViewUrl, connectUrl } = await createSessionWithContext(contextId);

    // Save context ID to credential immediately
    await supabase
      .from("retailer_credentials")
      .update({
        browserbase_context_id: contextId,
        connection_status: "connecting",
      })
      .eq("id", credential_id);

    // Return live view URL immediately so user sees the browser
    // Auto-fill will be triggered by a separate API call from the frontend
    return NextResponse.json({
      session_id: sessionId,
      live_view_url: liveViewUrl,
      context_id: contextId,
      // Pass credential info so frontend can trigger auto-fill
      retailer: cred.retailer,
      credential_id: cred.id,
    });
  } catch (error: any) {
    console.error("[Connect] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}