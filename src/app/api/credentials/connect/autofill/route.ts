import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { Stagehand } from "@browserbasehq/stagehand";
import { decryptCredentials } from "@/lib/encryption";

export const maxDuration = 60;

/**
 * POST /api/credentials/connect/autofill
 * Auto-fill login credentials on the retailer's login page.
 * Called by the frontend after the live view modal is open.
 * Body: { credential_id: string, session_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { credential_id, session_id } = await req.json();

    if (!credential_id || !session_id) {
      return NextResponse.json({ error: "credential_id and session_id required" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    const { data: cred, error: credError } = await supabase
      .from("retailer_credentials")
      .select("*")
      .eq("id", credential_id)
      .eq("user_id", auth.user.id)
      .single();

    if (credError || !cred) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    const { username, password } = decryptCredentials(
      cred.encrypted_username,
      cred.encrypted_password,
      cred.encryption_iv,
      auth.user.id
    );

    const loginUrls: Record<string, string> = {
      target: "https://www.target.com/login",
      walmart: "https://www.walmart.com/account/login",
      pokemon_center: "https://www.pokemoncenter.com/login",
    };
    const loginUrl = loginUrls[cred.retailer] || loginUrls.target;

    console.log("[AutoFill] Starting for session:", session_id);

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
      browserbaseSessionID: session_id,
    });

    console.log("[AutoFill] Calling stagehand.init()...");
    await stagehand.init();
    console.log("[AutoFill] Stagehand initialized");

    const page = stagehand.context.pages()[0];

    // Set mobile user agent to bypass bot detection
    const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    try {
      const cdpSession = await (stagehand.context as any).newCDPSession(page);
      await cdpSession.send("Network.setUserAgentOverride", { userAgent: MOBILE_UA });
      console.log("[AutoFill] Mobile UA set via CDP");
    } catch (err: any) {
      console.log("[AutoFill] CDP UA override failed:", err.message);
    }

    // Navigate to login page
    console.log("[AutoFill] Navigating to:", loginUrl);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
    await new Promise((r) => setTimeout(r, 3000));
    console.log("[AutoFill] Login page loaded, URL:", page.url());

    // Use Stagehand agent to fill credentials
    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    });

    await agent.execute({
      instruction: `You are on a mobile login page. Fill in the login credentials:
       Email: ${username}
       Password: ${password}
       
       Steps:
       1. Find the email/username field and type the email
       2. If there's a "Continue" or "Next" button, click it
       3. Find the password field and type the password
       4. Click the "Sign In" or "Log In" button
       5. STOP after clicking sign in — do NOT interact with any verification/MFA prompts

Type carefully, one field at a time. Wait between actions.`,
      maxSteps: 15,
    });

    console.log("[AutoFill] Auto-fill complete");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[AutoFill] Error:", error.message);
    // Return success anyway — user can still interact in live view
    return NextResponse.json({ success: false, error: error.message });
  }
}