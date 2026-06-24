import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailer, DAILY_REPORT_NOTIFY } from "@/lib/email";
import { todayIST, addDays } from "@/lib/ist";

// Daily stats report. Triggered by the Vercel Cron defined in vercel.json at
// 18:30 UTC = 00:00 IST every day (see vercel.json). At that moment the IST day
// that just ended is `todayIST() - 1` — that's the day this report covers.
//
// Each stats RPC returns { today, 7d, all } windowed by the passed d_today, so
// calling them with d_today = the just-completed day yields that day's numbers
// in `today` and cumulative numbers in `all`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AppWindow = { total: number; pending: number; approved: number; rejected: number };
type ApprovalWindow = AppWindow & { creators_uploaded: number };
type AnalyticsWindow = {
  totalCopies: number;
  uniqueCopiers: number;
  totalLogins: number;
  dau: number;
  newAccounts: number;
};

const n = (v: unknown) => Number(v ?? 0);

export async function GET(request: Request) {
  // Gate to Vercel Cron: it sends `Authorization: Bearer $CRON_SECRET`. Reject
  // anything else so the report can't be triggered (or spammed) by the public.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const today = todayIST();
  const reportDay = addDays(today, -1); // the IST day that just ended
  const start7 = addDays(reportDay, -6);

  const admin = createAdminClient();
  const [appRes, apprRes, anRes] = await Promise.all([
    admin.rpc("get_application_stats", { d_today: reportDay, d_start7: start7 }),
    admin.rpc("get_approval_stats", { d_today: reportDay, d_start7: start7 }),
    admin.rpc("get_analytics_windows", { d_today: reportDay, d_start7: start7 }),
  ]);

  const firstErr = appRes.error || apprRes.error || anRes.error;
  if (firstErr) {
    return NextResponse.json({ error: firstErr.message }, { status: 500 });
  }

  const app = (appRes.data ?? {}) as Record<string, AppWindow | null>;
  const appr = (apprRes.data ?? {}) as Record<string, ApprovalWindow | null>;
  const an = (anRes.data ?? {}) as Record<string, AnalyticsWindow | null>;

  const day = {
    copies: n(an.today?.totalCopies),
    uniqueCopiers: n(an.today?.uniqueCopiers),
    logins: n(an.today?.totalLogins),
    dau: n(an.today?.dau),
    newAccounts: n(an.today?.newAccounts),
    applied: n(app.today?.total),
    accepted: n(app.today?.approved),
    rejectedCreators: n(app.today?.rejected),
    designsSubmitted: n(appr.today?.total),
    designsApproved: n(appr.today?.approved),
    designsRejected: n(appr.today?.rejected),
  };
  const all = {
    copies: n(an.all?.totalCopies),
    applied: n(app.all?.total),
    accepted: n(app.all?.approved),
    rejectedCreators: n(app.all?.rejected),
    pendingCreators: n(app.all?.pending),
    designsApproved: n(appr.all?.approved),
    designsRejected: n(appr.all?.rejected),
  };

  const mailer = getMailer();
  if (!mailer) {
    // No email configured — still return the computed report for debugging.
    return NextResponse.json({ ok: true, emailed: false, reportDay, day, all });
  }

  const niceDate = new Date(`${reportDay}T00:00:00+05:30`).toLocaleDateString(
    "en-IN",
    { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  const metric = (label: string, value: number) => `
    <tr>
      <td style="padding:9px 14px;font-size:14px;color:#3f3f46;border-bottom:1px solid #f4f4f5">${label}</td>
      <td style="padding:9px 14px;font-size:14px;font-weight:600;color:#09090b;text-align:right;border-bottom:1px solid #f4f4f5">${value.toLocaleString("en-IN")}</td>
    </tr>`;

  const section = (title: string, rows: string) => `
    <p style="font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#a1a1aa;margin:24px 0 8px">${title}</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden">${rows}</table>`;

  let emailed = false;
  try {
    const { error } = await mailer.resend.emails.send({
      from: mailer.from,
      to: DAILY_REPORT_NOTIFY,
      subject: `Blocks Daily Report — ${niceDate}`,
      html: `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#09090b;line-height:1.5;max-width:560px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:20px;font-weight:600;letter-spacing:-0.02em;margin:0 0 4px">Daily Report</h1>
          <p style="font-size:14px;color:#71717a;margin:0 0 8px">${niceDate} (IST)</p>
          ${section(`On ${niceDate}`, [
            metric("Components copied", day.copies),
            metric("Unique copiers", day.uniqueCopiers),
            metric("Logins", day.logins),
            metric("Active users (DAU)", day.dau),
            metric("New accounts", day.newAccounts),
            metric("Creators applied", day.applied),
            metric("Creators accepted", day.accepted),
            metric("Creators rejected", day.rejectedCreators),
            metric("Designs submitted", day.designsSubmitted),
            metric("Designs approved", day.designsApproved),
            metric("Designs rejected", day.designsRejected),
          ].join(""))}
          ${section("All-time totals", [
            metric("Total components copied", all.copies),
            metric("Total creators applied", all.applied),
            metric("Total accepted creators", all.accepted),
            metric("Total rejected creators", all.rejectedCreators),
            metric("Pending creator applications", all.pendingCreators),
            metric("Total designs approved", all.designsApproved),
            metric("Total designs rejected", all.designsRejected),
          ].join(""))}
          <p style="font-size:12px;color:#a1a1aa;margin:28px 0 0">Automated report — Blocks by Lander Studio</p>
        </div>
      `,
    });
    emailed = !error;
  } catch {
    emailed = false;
  }

  return NextResponse.json({ ok: true, emailed, reportDay });
}
