import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIST } from "@/lib/ist";
import { cloudflareThumb } from "@/lib/utils";

// Admin-only analytics. Middleware (matcher includes /analytics) already gates
// this route to profiles.role = 'admin', so the page itself just reads. All
// reads use the service-role client, which bypasses RLS to see every user's
// rows — that key is server-only and never reaches the browser.
export const dynamic = "force-dynamic";

const CATEGORIES = [
  "Website",
  "Mobile Apps",
  "Dashboard",
  "Logos",
  "Illustrations",
] as const;

// "date" = a single specific IST day chosen via the date picker.
type Range = "today" | "7d" | "all" | "date";
// Tab options (the date picker is rendered separately, not as a tab).
const TABS = {
  today: "Today",
  "7d": "Last 7 Days",
  all: "All Time",
} as const;

// Shift a "YYYY-MM-DD" string by `delta` days (UTC math on the calendar date).
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; date?: string }>;
}) {
  const sp = await searchParams;

  const today = todayIST();
  // A valid, not-in-the-future YYYY-MM-DD date param wins over the tab.
  const datePick =
    typeof sp.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(sp.date) &&
    sp.date <= today
      ? sp.date
      : null;
  const range: Range = datePick
    ? "date"
    : sp.range === "7d" || sp.range === "all"
      ? sp.range
      : "today";

  const admin = createAdminClient();

  // IST date boundaries (copy_events.date / login_events.date are calendar
  // dates; profiles.created_at is a timestamptz so it uses an IST offset).
  const start7 = addDays(today, -6);
  // The single day a per-day breakdown targets: the picked date, else today.
  const activeDay = range === "date" ? datePick! : today;
  // Human label for the selected range.
  const rangeLabel =
    range === "date" ? datePick! : TABS[range as keyof typeof TABS];

  // Bounds on created_at (timestamptz) as ISO instants at 00:00 IST (+05:30).
  // A specific date is a half-open [day, nextDay) window; ranges are open-ended.
  const createdFrom =
    range === "today"
      ? `${today}T00:00:00+05:30`
      : range === "7d"
        ? `${start7}T00:00:00+05:30`
        : range === "date"
          ? `${datePick}T00:00:00+05:30`
          : null;
  const createdTo =
    range === "date" ? `${addDays(datePick!, 1)}T00:00:00+05:30` : null;
  // For the `date` column: an exact day for today/date, a lower bound for 7d,
  // nothing for all time.
  const eqDate = range === "today" ? today : range === "date" ? datePick! : null;
  const gteDate = range === "7d" ? start7 : null;

  // --- Components: id -> category map + all-time top-copied list. -----------
  const { data: comps } = await admin
    .from("components")
    .select("id, category, copy_count, preview_url");
  const compCategory = new Map<string, string>(
    (comps ?? []).map((c) => [c.id as string, (c.category as string) ?? "—"]),
  );
  const topComponents = [...(comps ?? [])]
    .sort((a, b) => (b.copy_count as number) - (a.copy_count as number))
    .slice(0, 10);

  // --- Copies in range (one fetch → total, unique users, per-category). -----
  let copyQuery = admin.from("copy_events").select("user_id, component_id");
  if (eqDate) copyQuery = copyQuery.eq("date", eqDate);
  else if (gteDate) copyQuery = copyQuery.gte("date", gteDate);
  const { data: copyRows } = await copyQuery.limit(100000);

  const totalCopies = copyRows?.length ?? 0;
  const uniqueCopiers = new Set((copyRows ?? []).map((r) => r.user_id)).size;
  const byCategory: Record<string, number> = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  );
  for (const r of copyRows ?? []) {
    const cat = compCategory.get(r.component_id as string);
    if (cat && cat in byCategory) byCategory[cat] += 1;
  }

  // --- Logins in range. -----------------------------------------------------
  let loginQuery = admin.from("login_events").select("user_id");
  if (eqDate) loginQuery = loginQuery.eq("date", eqDate);
  else if (gteDate) loginQuery = loginQuery.gte("date", gteDate);
  const { data: loginRows } = await loginQuery.limit(100000);

  const totalLogins = loginRows?.length ?? 0;
  const uniqueLogins = new Set((loginRows ?? []).map((r) => r.user_id)).size;

  // --- New accounts in range. -----------------------------------------------
  let acctQuery = admin
    .from("profiles")
    .select("*", { count: "exact", head: true });
  if (createdFrom) acctQuery = acctQuery.gte("created_at", createdFrom);
  if (createdTo) acctQuery = acctQuery.lt("created_at", createdTo);
  const { count: newAccounts } = await acctQuery;

  // --- Per-user activity for the active day (picked date, else today; IST). --
  const { data: todayRows } = await admin
    .from("copy_events")
    .select("user_id, component_id")
    .eq("date", activeDay)
    .limit(100000);

  const perUser = new Map<string, { count: number; components: string[] }>();
  for (const r of todayRows ?? []) {
    const uid = r.user_id as string;
    const entry = perUser.get(uid) ?? { count: 0, components: [] };
    entry.count += 1;
    entry.components.push(r.component_id as string);
    perUser.set(uid, entry);
  }

  // Names from profiles, emails from auth.users (admin API).
  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, full_name");
  const nameMap = new Map<string, string>(
    (profileRows ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "—"]),
  );
  const { data: usersList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const emailMap = new Map<string, string>(
    (usersList?.users ?? []).map((u) => [u.id, u.email ?? "—"]),
  );

  const perUserRows = [...perUser.entries()]
    .map(([uid, v]) => ({
      uid,
      email: emailMap.get(uid) ?? "—",
      name: nameMap.get(uid) ?? "—",
      count: v.count,
      components: v.components,
    }))
    .sort((a, b) => b.count - a.count);

  const overview = [
    { label: "Total copies", value: totalCopies },
    { label: "Unique users who copied", value: uniqueCopiers },
    { label: "New accounts", value: newAccounts ?? 0 },
    { label: "Total logins", value: totalLogins },
    { label: "Unique users who logged in", value: uniqueLogins },
  ];

  return (
    <main className="min-h-screen bg-[#f9fafa] px-6 py-10 text-[#09090b] [letter-spacing:-0.01em]">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8">
        {/* Header + range tabs */}
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">
              Analytics
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {rangeLabel} · all times in IST
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-fit gap-1 rounded-xl border border-[#e7e9ee] bg-white p-1">
              {(Object.keys(TABS) as (keyof typeof TABS)[]).map((r) => (
                <Link
                  key={r}
                  href={`/analytics?range=${r}`}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium tracking-[-0.03em] transition-colors ${
                    range === r
                      ? "bg-[#09090b] text-white"
                      : "text-[#52525b] hover:bg-[#f5f5f5]"
                  }`}
                >
                  {TABS[r]}
                </Link>
              ))}
            </div>

            {/* Specific-date picker — plain GET form, no client JS. */}
            <form
              action="/analytics"
              method="get"
              className={`flex items-center gap-1.5 rounded-xl border bg-white p-1 pl-3 ${
                range === "date" ? "border-[#09090b]" : "border-[#e7e9ee]"
              }`}
            >
              <input
                type="date"
                name="date"
                max={today}
                defaultValue={range === "date" ? datePick! : undefined}
                className="bg-transparent text-sm tracking-[-0.03em] text-[#09090b] outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#09090b] px-3 py-1.5 text-sm font-medium tracking-[-0.03em] text-white transition-opacity hover:opacity-90"
              >
                View
              </button>
            </form>

            {range === "date" && (
              <Link
                href="/analytics?range=today"
                className="text-sm font-medium tracking-[-0.03em] text-[#71717b] underline-offset-2 hover:underline"
              >
                Clear
              </Link>
            )}
          </div>
        </div>

        {/* Overview cards */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {overview.map((c) => (
            <div
              key={c.label}
              className="flex flex-col gap-2 rounded-2xl border border-[#e7e9ee] bg-white p-5"
            >
              <span className="text-[32px] font-semibold leading-none tracking-[-0.04em]">
                {c.value.toLocaleString()}
              </span>
              <span className="text-xs tracking-[-0.03em] text-[#71717b]">
                {c.label}
              </span>
            </div>
          ))}
        </section>

        {/* Copies by category */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-[-0.03em] text-[#52525b]">
            Copies by category · {rangeLabel}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="flex flex-col gap-1.5 rounded-2xl border border-[#e7e9ee] bg-white p-5"
              >
                <span className="text-[24px] font-semibold leading-none tracking-[-0.04em]">
                  {byCategory[cat].toLocaleString()}
                </span>
                <span className="text-xs tracking-[-0.03em] text-[#71717b]">
                  {cat}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Top copied components (all time) */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-[-0.03em] text-[#52525b]">
            Top copied components · All Time
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
            <table className="w-full text-sm tracking-[-0.03em]">
              <thead>
                <tr className="border-b border-[#e7e9ee] text-left text-xs text-[#71717b]">
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Preview</th>
                  <th className="px-5 py-3 font-medium">Component ID</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 text-right font-medium">Copies</th>
                </tr>
              </thead>
              <tbody>
                {topComponents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-6 text-center text-[#71717b]"
                    >
                      No copies yet.
                    </td>
                  </tr>
                ) : (
                  topComponents.map((c, i) => {
                    const id = c.id as string;
                    const preview = c.preview_url as string | null;
                    return (
                      <tr
                        key={id}
                        className="border-b border-[#f0f1f3] last:border-0"
                      >
                        <td className="px-5 py-3 text-[#71717b]">{i + 1}</td>
                        <td className="px-5 py-3">
                          {preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={cloudflareThumb(preview)}
                              alt=""
                              className="h-10 w-16 rounded-md border border-[#e7e9ee] bg-white object-contain"
                            />
                          ) : (
                            <div className="h-10 w-16 rounded-md border border-[#e7e9ee] bg-[#f5f5f5]" />
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">
                          <Link
                            href={`/upload/${id}/edit`}
                            className="text-[#09090b] underline-offset-2 hover:underline"
                          >
                            {id}
                          </Link>
                        </td>
                        <td className="px-5 py-3">{c.category as string}</td>
                        <td className="px-5 py-3 text-right font-medium">
                          {(c.copy_count as number).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Per-user activity today (IST) */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-[-0.03em] text-[#52525b]">
            Per-user activity · {activeDay} (IST)
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
            <table className="w-full text-sm tracking-[-0.03em]">
              <thead>
                <tr className="border-b border-[#e7e9ee] text-left text-xs text-[#71717b]">
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 text-right font-medium">Copies</th>
                  <th className="px-5 py-3 font-medium">Component IDs</th>
                </tr>
              </thead>
              <tbody>
                {perUserRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-6 text-center text-[#71717b]"
                    >
                      No copies on {activeDay}.
                    </td>
                  </tr>
                ) : (
                  perUserRows.map((u) => (
                    <tr
                      key={u.uid}
                      className="border-b border-[#f0f1f3] align-top last:border-0"
                    >
                      <td className="px-5 py-3">{u.email}</td>
                      <td className="px-5 py-3">{u.name}</td>
                      <td className="px-5 py-3 text-right font-medium">
                        {u.count}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.components.map((id, idx) => (
                            <Link
                              key={`${id}-${idx}`}
                              href={`/upload/${id}/edit`}
                              title={`${compCategory.get(id) ?? "—"} · ${id}`}
                              className="rounded-md bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px] text-[#52525b] transition-colors hover:bg-[#e7e9ee]"
                            >
                              {id.slice(0, 8)}
                            </Link>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
