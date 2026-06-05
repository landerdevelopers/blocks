import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// OAuth + magic-link callback. Supabase may return either:
//   - ?code=…                        (PKCE flow)  → exchangeCodeForSession
//   - ?token_hash=…&type=…           (OTP verify) → verifyOtp
// Either way we establish the session (sets cookies) and send the user home.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error("[auth/callback] exchangeCodeForSession:", error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) console.error("[auth/callback] verifyOtp:", error.message);
  } else {
    console.error("[auth/callback] no code or token_hash in callback URL");
  }

  // First login (no full_name yet, or row missing) → signal the homepage to
  // open onboarding instantly via ?onboarding=true.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    if (!profile || !profile.full_name) {
      return NextResponse.redirect(`${origin}/?onboarding=true`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
