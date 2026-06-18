import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Re-validate https on the server (matches isHttps below).
function isHttps(s: string): boolean {
  try {
    return new URL(s.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

// Submit a Creator Program application. This route is the ONLY insert path
// (direct client inserts are revoked): it verifies the session, validates the
// https social link, rejects duplicate pending applications, then inserts via
// the service-role client.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const social = typeof body.social === "string" ? body.social.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!role) {
    return NextResponse.json({ error: "Role is required." }, { status: 400 });
  }
  if (!isHttps(social)) {
    return NextResponse.json(
      { error: "Social profile must be a valid https link." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to apply." }, { status: 401 });
  }

  const admin = createAdminClient();

  // One pending application at a time.
  const { data: existing } = await admin
    .from("creator_applications")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .limit(1);
  if (existing?.length) {
    return NextResponse.json(
      { error: "You already have a pending application." },
      { status: 409 },
    );
  }

  const { error } = await admin.from("creator_applications").insert({
    user_id: user.id,
    role,
    social_url: social,
    reason: reason || null,
  });
  if (error) {
    // Unique partial index race → another pending app slipped in.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You already have a pending application." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
