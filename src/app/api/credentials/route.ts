import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { requireAuth } from "@/lib/auth/helpers";
import { encryptCredentials } from "@/lib/encryption";
import { z } from "zod";

const saveCredentialSchema = z.object({
  retailer: z.enum(["target", "walmart", "pokemon_center"]),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// GET /api/credentials - List user's saved credentials (metadata only, never the actual creds)
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("retailer_credentials")
    .select("id, retailer, last_validated_at, is_valid, created_at, updated_at")
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ credentials: data });
}

// POST /api/credentials - Save or update retailer credentials
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json();
  const parsed = saveCredentialSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { retailer, username, password } = parsed.data;

  // Encrypt credentials with user-specific key
  const encrypted = encryptCredentials(username, password, auth.user.id);

  const supabase = await createServerSupabaseClient();

  // Upsert: update if exists for this retailer, insert otherwise
  const { data, error } = await supabase
    .from("retailer_credentials")
    .upsert(
      {
        user_id: auth.user.id,
        retailer,
        encrypted_username: encrypted.encrypted_username,
        encrypted_password: encrypted.encrypted_password,
        encryption_iv: encrypted.encryption_iv,
        is_valid: true, // Assume valid until a login attempt fails
        last_validated_at: null,
      },
      {
        onConflict: "user_id,retailer",
      }
    )
    .select("id, retailer, is_valid, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    credential: data,
    message: `${retailer} credentials saved securely.`,
  });
}

// DELETE /api/credentials - Remove saved credentials
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const retailer = searchParams.get("retailer");

  if (!retailer) {
    return NextResponse.json({ error: "Retailer parameter required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Also deactivate any auto-buy watchlist items for this retailer
  await supabase
    .from("watchlist_items")
    .update({ mode: "notify_only" })
    .eq("user_id", auth.user.id)
    .eq("retailer", retailer)
    .eq("mode", "auto_buy");

  const { error } = await supabase
    .from("retailer_credentials")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("retailer", retailer);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: "Credentials removed. Any auto-buy items switched to notify-only.",
  });
}
