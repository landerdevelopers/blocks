// India Standard Time helpers (UTC+5:30, no DST). All comparisons here are in
// IST regardless of the user's local timezone.

const pad = (n: number) => String(n).padStart(2, "0");

// A Date whose local getters (getHours, getDate, …) read as IST wall-clock time.
function istNow(): Date {
  const ms =
    Date.now() + new Date().getTimezoneOffset() * 60000 + 5.5 * 3600000;
  return new Date(ms);
}

// "YYYY-MM-DD" for today in IST.
export function todayIST(): string {
  const d = istNow();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Shift a "YYYY-MM-DD" string by `delta` days (UTC calendar math).
export function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// Time left until the next 00:00 IST, as whole hours + minutes.
export function timeUntilMidnightIST(): { h: number; m: number } {
  const d = istNow();
  const secsIntoDay =
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const remaining = 24 * 3600 - secsIntoDay; // seconds until midnight
  let h = Math.floor(remaining / 3600);
  let m = Math.floor((remaining % 3600) / 60);
  // At exactly 00:00 IST remaining is a full day → show 23h 59m for the new day.
  if (h >= 24) {
    h = 23;
    m = 59;
  }
  return { h, m };
}
