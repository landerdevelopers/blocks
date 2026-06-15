import { createAdminClient } from "@/lib/supabase/admin";

// Records one click on the sidebar "Lander Studio" link. Called via
// navigator.sendBeacon from any visitor (incl. logged-out), so it uses the
// service-role client to insert past RLS. Fire-and-forget — always 204.
export async function POST() {
  try {
    await createAdminClient().from("lander_clicks").insert({});
  } catch {
    // Tracking must never surface an error to the visitor.
  }
  return new Response(null, { status: 204 });
}
