import { createClient } from "@/lib/supabase/client";

// Build-time env can be wrong/stale (it's baked into the bundle). OAuth and
// magic-link both fire client-side, so prefer the real runtime origin and fall
// back to the env only during SSR where window is absent.
function getRedirectTo() {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL;
  return `${origin}/auth/callback`;
}

// Google OAuth — redirects to the provider, then back through /auth/callback.
export async function signInWithGoogle() {
  const supabase = createClient();
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getRedirectTo() },
  });
}

// Magic link — emails a one-time sign-in link that returns via /auth/callback.
export async function signInWithMagicLink(email: string) {
  const supabase = createClient();
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: getRedirectTo() },
  });
}
