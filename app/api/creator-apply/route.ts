import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailer, CREATOR_APPLICATION_NOTIFY, escapeHtml } from "@/lib/email";

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

  // Notify the team — best-effort and DECOUPLED from the response. `after`
  // runs this once the success response has already been sent (on Vercel it's
  // kept alive via waitUntil), so a slow or failing email can never block the
  // applicant or undo the saved application.
  after(async () => {
    const mailer = getMailer();
    if (!mailer) return;
    try {
      // Resolve the applicant's display name (email comes from the session).
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      const name = prof?.full_name?.trim() || "—";
      const email = user.email || "—";
      const submittedAt = new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      });

      const row = (label: string, value: string) => `
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#71717a;white-space:nowrap;vertical-align:top">${label}</td>
          <td style="padding:8px 12px;font-size:14px;color:#09090b">${value}</td>
        </tr>`;

      await mailer.resend.emails.send({
        from: mailer.from,
        to: CREATOR_APPLICATION_NOTIFY,
        subject: `New Creator Application — ${escapeHtml(name)}`,
        html: `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#09090b;line-height:1.6;max-width:560px;margin:0 auto;padding:32px 24px">
            <h1 style="font-size:20px;font-weight:600;letter-spacing:-0.02em;margin:0 0 4px">New Creator Application</h1>
            <p style="font-size:14px;color:#71717a;margin:0 0 20px">A new applicant just submitted the Creator Program form.</p>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden">
              ${row("Name", escapeHtml(name))}
              ${row("Email", escapeHtml(email))}
              ${row("Role", escapeHtml(role))}
              ${row("Social", `<a href="${escapeHtml(social)}" style="color:#2974ff;text-decoration:none">${escapeHtml(social)}</a>`)}
              ${row("Reason", reason ? escapeHtml(reason).replace(/\n/g, "<br/>") : "—")}
              ${row("Submitted", `${escapeHtml(submittedAt)} IST`)}
            </table>
          </div>
        `,
      });
    } catch {
      // Swallow — the application is already saved; this notification is
      // non-critical and must not surface as a request error.
    }
  });

  return NextResponse.json({ ok: true });
}
