import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Reject a Creator Program application: mark it rejected (with the admin's
// feedback + a review timestamp that drives the 7-day re-apply cooldown) and
// email the applicant. Admin-only (verified via the session cookie).
export async function POST(request: Request) {
  const { applicationId, reason } = await request
    .json()
    .catch(() => ({}) as { applicationId?: string; reason?: string });
  if (!applicationId) {
    return NextResponse.json({ error: "Missing applicationId" }, { status: 400 });
  }
  const feedback = (reason ?? "").trim();
  if (!feedback) {
    return NextResponse.json({ error: "Missing reason" }, { status: 400 });
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

  // Mark rejected. No role change — rejection never grants/revokes anything.
  const { error: upErr } = await admin
    .from("creator_applications")
    .update({
      status: "rejected",
      rejection_reason: feedback,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Resolve applicant email + name.
  const { data: applicant } = await admin.auth.admin.getUserById(app.user_id);
  const email = applicant?.user?.email ?? "";
  const { data: prof } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", app.user_id)
    .single();
  const name = prof?.full_name ?? "there";

  // Escape the admin feedback before dropping it into the email HTML.
  const safeFeedback = feedback
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  // Send the rejection email (best-effort — the status is already saved).
  let emailed = false;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CREATOR_FROM_EMAIL;
  if (apiKey && from && email) {
    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: email,
        subject: "Your Blocks Creator Program application",
        html: `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#09090b;line-height:1.6;max-width:520px;margin:0 auto;padding:32px 24px">
            <p style="font-size:15px;color:#3f3f46;margin:0 0 14px">Hi ${name},</p>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 14px">
              Thank you for applying to the <strong>Blocks Creator Program</strong>.
            </p>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 16px">
              After reviewing your application, we've decided not to approve it at this time.
            </p>
            <p style="font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#09090b;margin:0 0 6px">Feedback from Our Team</p>
            <div style="font-size:15px;color:#3f3f46;background:#f5f5f5;border-radius:10px;padding:14px 16px;margin:0 0 18px">
              ${safeFeedback}
            </div>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 14px">
              We encourage you to make the suggested improvements and apply again in the future.
            </p>
            <p style="font-size:15px;color:#3f3f46;margin:0 0 20px">
              Thank you for your interest in Blocks.
            </p>
            <p style="font-size:13px;color:#a1a1aa;margin:28px 0 0">— The Blocks Team</p>
          </div>
        `,
      });
      emailed = !error;
    } catch {
      // Email failed — rejection is still saved; admin can retry.
      emailed = false;
    }
  }

  return NextResponse.json({ ok: true, emailed });
}
