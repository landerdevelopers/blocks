import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin-only. Grant or revoke a user's creator access.
//   revoke → role back to 'user' + unpublish their approved designs (drops them
//            from the gallery, the All-Creators list, and the sidebar counts;
//            middleware then blocks them from /creators and /upload).
//   grant  → role 'creator' + re-publish their approved designs.
// The role write goes through the service-role client: the prevent_role_self_change
// trigger blocks role changes from any authenticated session (admins included).
export async function POST(request: Request) {
  const { userId, action } = await request.json().catch(() => ({}));
  if (!userId || (action !== "grant" && action !== "revoke")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Caller must be a logged-in admin.
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

  // Never demote another admin through this endpoint.
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === "admin") {
    return NextResponse.json(
      { error: "Cannot change an admin's access" },
      { status: 400 },
    );
  }

  const grant = action === "grant";

  const { error: roleErr } = await admin
    .from("profiles")
    .update({ role: grant ? "creator" : "user" })
    .eq("id", userId);
  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  // Hide / restore their approved designs in the gallery. Pending/rejected stay
  // unpublished; private approved ones stay hidden via the is_private filter.
  await admin
    .from("components")
    .update({ is_published: grant })
    .eq("uploaded_by", userId)
    .eq("status", "approved");

  // Gallery counts are cached — refresh them.
  revalidateTag("sidebar_counts", "max");

  return NextResponse.json({ ok: true });
}
