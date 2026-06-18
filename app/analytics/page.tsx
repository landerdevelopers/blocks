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

  // Stats for a [start, end] IST day window. All aggregation happens in the DB
  // (no raw rows pulled to JS): get_window_stats returns the KPI counts incl.
  // DISTINCT uniques, and get_copies_by_category returns the per-category totals.
  const statsFor = async (start: string, end: string): Promise<Stats> => {
    const [statRes, catRes] = await Promise.all([
      admin.rpc("get_window_stats", { start_date: start, end_date: end }),
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
    const s = (
      statRes.data as
        | {
            total_copies: number;
            unique_copiers: number;
            total_logins: number;
            unique_logins: number;
            new_accounts: number;
          }[]
        | null
    )?.[0];
    return {
      totalCopies: Number(s?.total_copies ?? 0),
      uniqueCopiers: Number(s?.unique_copiers ?? 0),
      totalLogins: Number(s?.total_logins ?? 0),
      uniqueLogins: Number(s?.unique_logins ?? 0),
      newAccounts: Number(s?.new_accounts ?? 0),
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

  // Emails from auth.users — fetched only for the users actually shown in the
  // per-user table (scales with daily-active users, not total accounts).
  const fetchEmailsFor = async (
    uids: string[],
  ): Promise<Record<string, string>> => {
    const map: Record<string, string> = {};
    await Promise.all(
      uids.map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data?.user) map[id] = data.user.email || "";
      }),
    );
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
  ]);

  // Second wave — names/emails/last-login only for the users actually shown in
  // the per-user table (union of today + date views). Scales with active users.
  const allUids = [
    ...new Set([
      ...rawToday.map((r) => r.uid),
      ...(rawDate ?? []).map((r) => r.uid),
    ]),
  ];
  const lastLoginMap: Record<string, string> = {};
  const nameMap = new Map<string, string>();
  let emailMap: Record<string, string> = {};
  if (allUids.length) {
    const [{ data: logins }, { data: names }, emails] = await Promise.all([
      admin
        .from("login_events")
        .select("user_id, logged_in_at")
        .in("user_id", allUids)
        .order("logged_in_at", { ascending: false }),
      admin.from("profiles").select("id, full_name").in("id", allUids),
      fetchEmailsFor(allUids),
    ]);
    for (const l of logins ?? []) {
      const uid = l.user_id as string;
      if (!lastLoginMap[uid]) lastLoginMap[uid] = l.logged_in_at as string;
    }
    for (const p of names ?? []) {
      nameMap.set(p.id as string, (p.full_name as string) ?? "—");
    }
    emailMap = emails;
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
