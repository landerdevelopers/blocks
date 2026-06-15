import { createAdminClient } from "@/lib/supabase/admin";
import { todayIST } from "@/lib/ist";
import AnalyticsView, {
  type Stats,
  type PerUserRow,
  type TopComponent,
} from "./AnalyticsView";

// Must be a server-side value: importing a runtime value from the "use client"
// AnalyticsView module would yield a client-reference proxy, not the array.
const CATEGORIES = [
  "Website",
  "Mobile Apps",
  "Dashboard",
  "Logos",
  "Illustrations",
] as const;

// Admin-only analytics. Middleware (matcher includes /analytics) already gates
// this route to profiles.role = 'admin', so the page itself just reads. All
// reads use the service-role client, which bypasses RLS to see every user's
// rows — that key is server-only and never reaches the browser.
export const dynamic = "force-dynamic";

const EPOCH = "1970-01-01";

// Shift a "YYYY-MM-DD" string by `delta` days (UTC math on the calendar date).
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

type RawPerUser = { uid: string; count: number; components: string[] };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const today = todayIST();
  const start7 = addDays(today, -6);
  // A valid, not-in-the-future YYYY-MM-DD date param → the date view.
  const datePick =
    typeof sp.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(sp.date) &&
    sp.date <= today
      ? sp.date
      : null;

  const admin = createAdminClient();

  // Stats for a [start, end] IST day window. Four parallel queries: copies
  // (count + user_ids for unique), logins (same), new accounts (count), and
  // copies-by-category (DB aggregation RPC — no raw rows pulled to JS).
  const statsFor = async (start: string, end: string): Promise<Stats> => {
    const createdFrom = `${start}T00:00:00+05:30`;
    const createdTo = `${addDays(end, 1)}T00:00:00+05:30`;
    const [copyRes, loginRes, acctRes, catRes] = await Promise.all([
      admin
        .from("copy_events")
        .select("user_id", { count: "exact" })
        .gte("date", start)
        .lte("date", end)
        .limit(100000),
      admin
        .from("login_events")
        .select("user_id", { count: "exact" })
        .gte("date", start)
        .lte("date", end)
        .limit(100000),
      admin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("created_at", createdFrom)
        .lt("created_at", createdTo),
      admin.rpc("get_copies_by_category", {
        start_date: start,
        end_date: end,
      }),
    ]);
    const byCategory: Record<string, number> = Object.fromEntries(
      CATEGORIES.map((c) => [c, 0]),
    );
    for (const r of (catRes.data as
      | { category: string; copies_count: number }[]
      | null) ?? []) {
      if (r.category in byCategory) byCategory[r.category] = Number(r.copies_count);
    }
    return {
      totalCopies: copyRes.count ?? 0,
      uniqueCopiers: new Set((copyRes.data ?? []).map((r) => r.user_id)).size,
      totalLogins: loginRes.count ?? 0,
      uniqueLogins: new Set((loginRes.data ?? []).map((r) => r.user_id)).size,
      newAccounts: acctRes.count ?? 0,
      byCategory,
    };
  };

  // Per-user activity for one day, pre-aggregated by the RPC (no raw rows).
  const perUserFor = async (day: string): Promise<RawPerUser[]> => {
    const { data } = await admin.rpc("get_per_user_activity", {
      activity_date: day,
    });
    return ((data as
      | { user_id: string; copies_count: number; component_ids: string[] | null }[]
      | null) ?? []).map((r) => ({
      uid: r.user_id,
      count: Number(r.copies_count),
      components: r.component_ids ?? [],
    }));
  };

  // Emails from auth.users — paginate so >1000 accounts are fully covered.
  const fetchAllEmails = async (): Promise<Record<string, string>> => {
    const map: Record<string, string> = {};
    let page = 1;
    for (;;) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (!data?.users?.length) break;
      data.users.forEach((u) => {
        map[u.id] = u.email || "";
      });
      if (data.users.length < 1000) break;
      page++;
    }
    return map;
  };

  // Everything that doesn't depend on another query — fired in one wave.
  const [
    statToday,
    stat7d,
    statAll,
    statDate,
    top10Res,
    compCatRes,
    landerRes,
    rawToday,
    rawDate,
    namesRes,
    emailMap,
  ] = await Promise.all([
    statsFor(today, today),
    statsFor(start7, today),
    statsFor(EPOCH, today),
    datePick ? statsFor(datePick, datePick) : Promise.resolve(null),
    admin
      .from("components")
      .select("id, category, copy_count, preview_url")
      .order("copy_count", { ascending: false })
      .limit(10),
    admin.from("components").select("id, category").limit(100000),
    admin.from("lander_clicks").select("*", { count: "exact", head: true }),
    perUserFor(today),
    datePick ? perUserFor(datePick) : Promise.resolve(null),
    admin.from("profiles").select("id, full_name").limit(10000),
    fetchAllEmails(),
  ]);

  const nameMap = new Map<string, string>(
    (namesRes.data ?? []).map((p) => [
      p.id as string,
      (p.full_name as string) ?? "—",
    ]),
  );

  // Latest login per active user (union of today + date views) — second wave,
  // since it depends on which user ids the per-user RPCs returned.
  const allUids = [
    ...new Set([
      ...rawToday.map((r) => r.uid),
      ...(rawDate ?? []).map((r) => r.uid),
    ]),
  ];
  const lastLoginMap: Record<string, string> = {};
  if (allUids.length) {
    const { data: logins } = await admin
      .from("login_events")
      .select("user_id, logged_in_at")
      .in("user_id", allUids)
      .order("logged_in_at", { ascending: false });
    for (const l of logins ?? []) {
      const uid = l.user_id as string;
      if (!lastLoginMap[uid]) lastLoginMap[uid] = l.logged_in_at as string;
    }
  }

  const enrich = (rows: RawPerUser[]): PerUserRow[] =>
    rows.map((r) => ({
      uid: r.uid,
      email: emailMap[r.uid] || "—",
      name: nameMap.get(r.uid) ?? "—",
      count: r.count,
      components: r.components,
      lastLogin: lastLoginMap[r.uid] ?? null,
    }));

  const topComponents: TopComponent[] = (top10Res.data ?? []).map((c) => ({
    id: c.id as string,
    category: (c.category as string) ?? "—",
    copy_count: (c.copy_count as number) ?? 0,
    preview_url: (c.preview_url as string) ?? null,
  }));
  const categoryById: Record<string, string> = Object.fromEntries(
    (compCatRes.data ?? []).map((c) => [
      c.id as string,
      (c.category as string) ?? "—",
    ]),
  );

  return (
    <AnalyticsView
      today={today}
      initialDate={datePick}
      stats={{ today: statToday, "7d": stat7d, all: statAll, date: statDate }}
      topComponents={topComponents}
      landerClicks={landerRes.count ?? 0}
      perUser={{ tabs: enrich(rawToday), date: rawDate ? enrich(rawDate) : null }}
      categoryById={categoryById}
    />
  );
}
