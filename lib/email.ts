import "server-only";
import { Resend } from "resend";

// Shared Resend setup. Returns null when the API key / from address aren't
// configured so callers can no-op gracefully (email is always best-effort —
// it must never block or fail the primary action).
export function getMailer(): { resend: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CREATOR_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return { resend: new Resend(apiKey), from };
}

// Internal notification recipients for new Creator Program applications.
export const CREATOR_APPLICATION_NOTIFY = [
  "sridharraj.uiux@gmail.com",
  "pragadesh37v@gmail.com",
];

// Recipient(s) of the automated daily stats report.
export const DAILY_REPORT_NOTIFY = ["pragadesh37v@gmail.com"];

// Escape user-supplied text before embedding it in an HTML email body.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
