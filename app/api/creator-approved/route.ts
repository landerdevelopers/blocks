import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Approve a Creator Program application: mark it approved and email the
// applicant a congratulations. Admin-only (verified via the session cookie).
export async function POST(request: Request) {
  const { applicationId } = await request.json().catch(() => ({}));
  if (!applicationId) {
    return NextResponse.json({ error: "Missing applicationId" }, { status: 400 });
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

  // Load the application + applicant.
  const { data: app } = await admin
    .from("creator_applications")
    .select("id, user_id")
    .eq("id", applicationId)
    .single();
  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mark approved.
  const { error: upErr } = await admin
    .from("creator_applications")
    .update({ status: "approved" })
    .eq("id", applicationId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Grant the creator role (don't demote an admin).
  await admin
    .from("profiles")
    .update({ role: "creator" })
    .eq("id", app.user_id)
    .neq("role", "admin");

  // Resolve applicant email + name.
  const { data: applicant } = await admin.auth.admin.getUserById(app.user_id);
  const email = applicant?.user?.email ?? "";
  const { data: prof } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", app.user_id)
    .single();
  const name = prof?.full_name ?? "there";

  // Send the congratulations email (best-effort — approval already saved).
  let emailed = false;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CREATOR_FROM_EMAIL;
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  if (apiKey && from && email) {
    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: email,
        subject: "You're in — welcome to the Blocks Creator Program 🎉",
        html: `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#09090b;line-height:1.6;max-width:520px;margin:0 auto;padding:32px 24px">
            <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.02em;margin:0 0 16px">Welcome aboard, ${name}! 🎉</h1>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 14px">
              Great news — your application to the <strong>Blocks Creator Program</strong> has been approved. You're officially a creator.
            </p>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 8px">Here's what you can do now:</p>
            <ul style="font-size:15px;color:#3f3f46;margin:0 0 18px;padding-left:20px">
              <li style="margin:0 0 6px">Publish your own designs to thousands of designers</li>
              <li style="margin:0 0 6px">Get a public creator page at <strong>${siteUrl}/creators/your-handle</strong></li>
              <li style="margin:0 0 6px">Unlock creator-only perks, including a higher daily copy limit</li>
            </ul>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 20px">
              When you open Blocks, we'll ask you to pick a unique username — that's the last step before you start publishing.
            </p>
            <a href="${siteUrl}" style="display:inline-block;background:#2974ff;color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;padding:12px 22px;border-radius:10px;letter-spacing:-0.01em">
              Open Blocks
            </a>
            <p style="font-size:13px;color:#a1a1aa;margin:28px 0 0">Blocks by Lander Studio</p>
          </div>
        `,
      });
      emailed = !error;
    } catch {
      // Email failed — approval is still saved; admin can retry.
      emailed = false;
    }
  }

  return NextResponse.json({ ok: true, emailed });
}
