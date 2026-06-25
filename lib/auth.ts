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

// Magic-link sending now lives in the /api/magic-link route so disposable email
// domains are rejected server-side before any email is sent (the client can't be
// trusted to enforce that). See app/api/magic-link/route.ts.
