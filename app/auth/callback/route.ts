import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth + magic-link callback. Supabase redirects here with a `code` query
// param; we exchange it for a session (which sets the auth cookies) and send
// the user home. On any error we still redirect home rather than dead-end.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Fall through to the home redirect below.
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
