import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIST } from "@/lib/ist";
import AnalyticsView, {
  type Stats,
  type PerUserRow,
  type TopComponent,
  type AnalyticsData,
} from "./AnalyticsView";

// Render on the server for EVERY request and send the document with no-store —
// a normal browser refresh must reflect the latest copies, not replay a cached
// payload (which previously only a hard refresh / ctrl+shift+R would bust). The
// heavy all-time aggregates stay behind unstable_cache (60s) for cost; the page
// itself is never HTTP/route-cached.
export const dynamic = "force-dynamic";

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
//
// Not force-dynamic: the heavy window aggregates are wrapped in unstable_cache
// (60s) so repeat loads skip the all-time scans. The ?date view and per-user
// table are computed live each request.

// Shift a "YYYY-MM-DD" string by `delta` days (UTC math on the calendar date).
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

type RawPerUser = {
  uid: string;
  count: number;
  components: string[];
  lastCopy: string | null;
};

// One window object as returned by the get_analytics_windows RPC.
type RawWindow = {
  totalCopies: number;
  uniqueCopiers: number;
  totalLogins: number;
  dau: number;
  newAccounts: number;
  byCategory: Record<string, number> | null;
};

// Normalize an RPC window into the Stats shape, filling every category with 0
// so the view always has all five keys. Counts arrive as JSON numbers.
function toStats(w: RawWindow | null | undefined): Stats {
  const byCategory: Record<string, number> = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  );
  for (const [k, v] of Object.entries(w?.byCategory ?? {})) {
    if (k in byCategory) byCategory[k] = Number(v);
  }
  return {
    totalCopies: Number(w?.totalCopies ?? 0),
    uniqueCopiers: Number(w?.uniqueCopiers ?? 0),
    totalLogins: Number(w?.totalLogins ?? 0),
    dau: Number(w?.dau ?? 0),
    newAccounts: Number(w?.newAccounts ?? 0),
    byCategory,
  };
}

// Tab stats (today / 7d / all), top components, and lander count don't depend on
// the ?date param, so they're cached together for 60s — one RPC + two cheap
// reads, shared across loads. Keyed by `today` so the cache rolls over at the
// IST date boundary.
const getCachedOverview = unstable_cache(
  async (today: string, start7: string) => {
    const admin = createAdminClient();
    const [windowsRes, top10Res, landerRes] = await Promise.all([
      admin.rpc("get_analytics_windows", {
        d_today: today,
        d_start7: start7,
      }),
      admin
        .from("components")
        .select("id, category, copy_count, preview_url")
        .order("copy_count", { ascending: false })
        .limit(10),
      admin.from("lander_clicks").select("*", { count: "exact", head: true }),
    ]);
    const w = (windowsRes.data ?? {}) as Record<string, RawWindow | null>;
    const topComponents: TopComponent[] = (top10Res.data ?? []).map((c) => ({
      id: c.id as string,
      category: (c.category as string) ?? "—",
      copy_count: (c.copy_count as number) ?? 0,
      preview_url: (c.preview_url as string) ?? null,
    }));
    return {
      stats: {
        today: toStats(w.today),
        "7d": toStats(w["7d"]),
        all: toStats(w.all),
      },
      topComponents,
      landerClicks: landerRes.count ?? 0,
    };
  },
  // Bump the version suffix whenever the cached shape changes (e.g. dau added) so
  // stale entries from a prior deploy don't surface fields the new code expects.
  ["analytics-overview-v2"],
  // Tagged so the in-page Refresh button can bust it on demand (revalidateTag).
  // The 5-min window is just a safety net behind that manual refresh; the cache
  // key already includes `today`, so it rolls over on its own at the IST date
  // boundary. Heavy all-time scans stay cheap between refreshes.
  { revalidate: 300, tags: ["analytics"] },
);

// Fetch everything the view streams in. Kicked off (not awaited) by the page so
// the shell paints instantly and these reads resolve behind a Suspense skeleton.
async function loadAnalytics(
  today: string,
  start7: string,
  datePick: string | null,
): Promise<AnalyticsData> {
  const admin = createAdminClient();

  // Per-user activity for one day, pre-aggregated by the RPC (no raw rows).
  const perUserFor = async (day: string): Promise<RawPerUser[]> => {
    const { data } = await admin.rpc("get_per_user_activity", {
      activity_date: day,
    });
    return ((data as
      | {
          user_id: string;
          copies_count: number;
          component_ids: string[] | null;
          last_copy: string | null;
        }[]
      | null) ?? []).map((r) => ({
      uid: r.user_id,
      count: Number(r.copies_count),
      components: r.component_ids ?? [],
      lastCopy: r.last_copy ?? null,
    }));
  };

  // First wave: cached tab overview + (live) date-window stats + per-user rows.
  // The date view is uncached since it's an arbitrary, rarely repeated param.
  const [overview, dateRes, rawToday, rawDate] = await Promise.all([
    getCachedOverview(today, start7),
    datePick
      ? admin.rpc("get_analytics_windows", {
          d_today: today,
          d_start7: start7,
          d_date: datePick,
        })
      : Promise.resolve(null),
    perUserFor(today),
    datePick ? perUserFor(datePick) : Promise.resolve(null),
  ]);

  const statDate = dateRes
    ? toStats((dateRes.data as Record<string, RawWindow | null>)?.date)
    : null;

  // Second wave: only the names/emails/categories for the users and components
  // actually shown in the per-user table — scoped by id, not full table scans.
  // Depends on which uids/components the per-user RPCs returned. (Last copy comes
  // straight from get_per_user_activity, so no login_events lookup is needed.)
  const allUids = [
    ...new Set([
      ...rawToday.map((r) => r.uid),
      ...(rawDate ?? []).map((r) => r.uid),
    ]),
  ];
  const shownCompIds = [
    ...new Set([
      ...rawToday.flatMap((r) => r.components),
      ...(rawDate ?? []).flatMap((r) => r.components),
    ]),
  ];

  const [profRes, compRes] = await Promise.all([
    allUids.length
      ? admin.from("profiles").select("id, full_name, email").in("id", allUids)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    shownCompIds.length
      ? admin.from("components").select("id, category").in("id", shownCompIds)
      : Promise.resolve({ data: [] as { id: string; category: string | null }[] }),
  ]);

  const nameMap = new Map<string, string>();
  const emailMap: Record<string, string> = {};
  for (const p of profRes.data ?? []) {
    nameMap.set(p.id as string, (p.full_name as string) ?? "—");
    emailMap[p.id as string] = (p.email as string) || "";
  }

  const categoryById: Record<string, string> = Object.fromEntries(
    (compRes.data ?? []).map((c) => [
      c.id as string,
      (c.category as string) ?? "—",
    ]),
  );

  const enrich = (rows: RawPerUser[]): PerUserRow[] =>
    rows.map((r) => ({
      uid: r.uid,
      email: emailMap[r.uid] || "—",
      name: nameMap.get(r.uid) ?? "—",
      count: r.count,
      components: r.components,
      lastCopy: r.lastCopy,
    }));

  return {
    stats: {
      today: overview.stats.today,
      "7d": overview.stats["7d"],
      all: overview.stats.all,
      date: statDate,
    },
    topComponents: overview.topComponents,
    landerClicks: overview.landerClicks,
    perUser: { tabs: enrich(rawToday), date: rawDate ? enrich(rawDate) : null },
    categoryById,
  };
}

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

  // Pass the data fetch as a promise (NOT awaited) so the chrome paints instantly
  // and the heavy reads stream in behind the Suspense skeleton in AnalyticsView.
  const dataPromise = loadAnalytics(today, start7, datePick);

  return (
    <AnalyticsView
      today={today}
      initialDate={datePick}
      dataPromise={dataPromise}
    />
  );
}
