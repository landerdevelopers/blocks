import { createClient } from "@/lib/supabase/client";

const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

// Google OAuth — redirects to the provider, then back through /auth/callback.
export async function signInWithGoogle() {
  const supabase = createClient();
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

// Magic link — emails a one-time sign-in link that returns via /auth/callback.
export async function signInWithMagicLink(email: string) {
  const supabase = createClient();
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
}
