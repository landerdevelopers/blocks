import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Approve or reject a creator's pending design. Admin-only (verified via the
// session cookie). Approve → published + approved (shows in the gallery);
// reject → unpublished + rejected (stays on the creator's portal as rejected).
export async function POST(request: Request) {
  const { componentId, action } = await request.json().catch(() => ({}));
  if (!componentId || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Verify the caller is a logged-in admin.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  // On approve, also clear featured/featured_at: a creator can set featured=true
  // on their own pending design (owner-update RLS doesn't restrict that column),
  // and it would otherwise survive approval and pin them to the top of the home
  // gallery. Featuring is an admin-only action done later via the gallery pin.
  const patch =
    action === "approve"
      ? {
          status: "approved",
          is_published: true,
          featured: false,
          featured_at: null,
        }
      : { status: "rejected", is_published: false };
  const { error } = await admin
    .from("components")
    .update(patch)
    .eq("id", componentId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
