import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — BYPASSES Row Level Security. SERVER-ONLY.
// `import "server-only"` makes the build fail if this is ever pulled into a
// Client Component, so SUPABASE_SERVICE_ROLE_KEY can never reach the browser.
// Used by admin-only reads (the analytics page) that need to see every user's
// rows, which the per-user RLS policies would otherwise hide.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
