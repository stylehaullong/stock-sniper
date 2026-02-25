import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { createContext, createSessionWithContext } from "@/lib/browserbase/context-manager";
import { Stagehand } from "@browserbasehq/stagehand";
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

    // Navigate to login page before returning response
    // (Vercel kills background tasks after response is sent)
    let autoFillError: string | null = null;
    try {
      await autoFillLogin(sessionId, cred.retailer, username, password);
    } catch (err: any) {
      console.error("[Connect] Auto-fill error:", err.message);
      autoFillError = err.message;
      // Don't fail — user can still interact in live view
    }

    return NextResponse.json({
      session_id: sessionId,
      live_view_url: liveViewUrl,
      context_id: contextId,
      auto_fill_error: autoFillError,
    });
  } catch (error: any) {
    console.error("[Connect] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Auto-fill login credentials on Target mobile site using Stagehand.
 * Mobile user agent bypasses Target's bot detection.
 * User handles MFA in the live view if prompted.
 */
async function autoFillLogin(
  sessionId: string,
  retailer: string,
  username: string,
  password: string,
) {
  const loginUrls: Record<string, string> = {
    target: "https://www.target.com/login",
    walmart: "https://www.walmart.com/account/login",
    pokemon_center: "https://www.pokemoncenter.com/login",
  };

  const loginUrl = loginUrls[retailer] || loginUrls.target;

  try {
    console.log("[Connect] Starting auto-fill for session:", sessionId);
    
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      verbose: 0,
      logger: () => {},
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
      browserbaseSessionID: sessionId,
    });

    console.log("[Connect] Calling stagehand.init()...");
    await stagehand.init();
    console.log("[Connect] Stagehand initialized");
    
    const page = stagehand.context.pages()[0];
    console.log("[Connect] Got page, current URL:", page.url());

    // Navigate to login page — mobile UA set at session level
    console.log("[Connect] Navigating to:", loginUrl);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
    await new Promise((r) => setTimeout(r, 3000));
    console.log("[Connect] Login page loaded, URL:", page.url());

    // Use Stagehand agent to fill credentials
    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    });

    await agent.execute({
      instruction: `You are on Target's mobile login page. Fill in the login form:

1. Find the email/username input field and type: ${username}
2. If there's a "Continue" or "Next" button, click it and wait 2 seconds
3. Find the password input field and type: ${password}
4. Click the "Sign in" or "Log in" button
5. STOP after clicking sign in — do NOT interact with verification/MFA prompts

Type carefully, one field at a time. Wait between actions.`,
      maxSteps: 15,
    });

    console.log("[Connect] Auto-fill complete — user handles MFA if needed");

  } catch (error: any) {
    console.error("[Connect] Auto-fill failed:", error.message);
    // Don't close session — user can still interact in live view
  }
}