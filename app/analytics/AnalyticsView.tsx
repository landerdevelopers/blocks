"use client";

import Link from "next/link";
import { Suspense, use, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cloudflareThumb } from "@/lib/utils";
import PerUserActivity from "./PerUserActivity";
import { refreshAnalytics } from "./actions";

export const CATEGORIES = [
  "Website",
  "Mobile Apps",
  "Dashboard",
  "Logos",
  "Illustrations",
] as const;

export type Stats = {
  totalCopies: number;
  uniqueCopiers: number;
  totalLogins: number;
  // Average daily active users (distinct logged-in-or-copied users per day,
  // averaged over the window's days; today/date = that single day's count).
  dau: number;
  newAccounts: number;
  byCategory: Record<string, number>;
};

export type PerUserRow = {
  uid: string;
  email: string;
  name: string;
  count: number;
  components: string[];
  lastCopy: string | null;
};

export type TopComponent = {
  id: string;
  category: string;
  copy_count: number;
  preview_url: string | null;
};

// Everything the page streams in after the shell paints. Passed as a promise so
// the chrome (title/tabs/date picker) renders instantly and the heavy reads show
// skeletons until they resolve.
export type AnalyticsData = {
  stats: { today: Stats; "7d": Stats; all: Stats; date: Stats | null };
  topComponents: TopComponent[];
  // Lander Studio visits windowed like the KPIs (date is null unless a day picked).
  landerVisits: { today: number; "7d": number; all: number; date: number | null };
  perUser: { tabs: PerUserRow[]; date: PerUserRow[] | null };
  categoryById: Record<string, string>;
};

type View = "today" | "7d" | "all" | "date";
const TABS = { today: "Today", "7d": "Last 7 Days", all: "All Time" } as const;

const card =
  "rounded-2xl border border-[#e7e9ee] bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.04)]";

const skel = "animate-pulse rounded-md bg-[#ebebef]";

export default function AnalyticsView({
  today,
  initialDate,
  dataPromise,
}: {
  today: string;
  initialDate: string | null;
  dataPromise: Promise<AnalyticsData>;
}) {
  // Tabs switch instantly client-side (data for all three is already loaded).
  // The date view comes from the server (?date=…) and can't be prefetched.
  const [view, setView] = useState<View>(initialDate ? "date" : "today");
  const router = useRouter();
  // Manual refresh: bust the cached overview server-side, then re-render. The
  // transition keeps the CURRENT numbers on screen (no skeleton flash) until the
  // fresh data lands — so it "shows the previous one" while fetching.
  const [refreshing, startRefresh] = useTransition();
  const onRefresh = () =>
    startRefresh(async () => {
      await refreshAnalytics();
      router.refresh();
    });

  const rangeLabel = view === "date" ? (initialDate ?? "") : TABS[view];

  // Switching to a tab clears any ?date in the URL so a refresh stays put.
  const selectTab = (v: "today" | "7d" | "all") => {
    setView(v);
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", "/analytics");
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-275 flex-col gap-6">
        {/* Toolbar: title + range controls — renders instantly. */}
        <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Analytics
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              Showing{" "}
              <span className="font-medium text-[#09090b]">{rangeLabel}</span> ·
              all times in IST
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh data"
              title="Refresh data"
              className="flex size-9 cursor-pointer items-center justify-center rounded-xl border border-[#e7e9ee] bg-white text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#f5f5f5] hover:text-[#09090b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                size={16}
                strokeWidth={2}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>

            <div className="flex gap-1 rounded-xl border border-[#e7e9ee] bg-white p-1 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
              {(Object.keys(TABS) as (keyof typeof TABS)[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => selectTab(r)}
                  className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium tracking-[-0.03em] transition-colors ${
                    view === r
                      ? "bg-[#09090b] text-white"
                      : "text-[#52525b] hover:bg-[#f5f5f5]"
                  }`}
                >
                  {TABS[r]}
                </button>
              ))}
            </div>

            {/* Specific-date picker — server fetch via GET (?date=…). */}
            <form
              action="/analytics"
              method="get"
              className={`flex items-center gap-1.5 rounded-xl border bg-white p-1 pl-3 shadow-[0px_1px_2px_rgba(0,0,0,0.04)] ${
                view === "date" ? "border-[#09090b]" : "border-[#e7e9ee]"
              }`}
            >
              <input
                type="date"
                name="date"
                max={today}
                defaultValue={view === "date" ? (initialDate ?? undefined) : undefined}
                className="bg-transparent text-sm tracking-[-0.03em] text-[#09090b] outline-none"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-lg bg-[#09090b] px-3 py-1.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1a1a1a]"
              >
                View
              </button>
            </form>

            {view === "date" && (
              <button
                type="button"
                onClick={() => selectTab("today")}
                className="cursor-pointer text-sm font-medium tracking-[-0.03em] text-[#71717b] underline-offset-2 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </header>

        {/* Everything data-dependent streams in; skeletons show until ready. */}
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsContent
            dataPromise={dataPromise}
            view={view}
            today={today}
            initialDate={initialDate}
          />
        </Suspense>
      </div>
    </main>
  );
}

function AnalyticsContent({
  dataPromise,
  view,
  today,
  initialDate,
}: {
  dataPromise: Promise<AnalyticsData>;
  view: View;
  today: string;
  initialDate: string | null;
}) {
  const { stats, topComponents, landerVisits, perUser, categoryById } =
    use(dataPromise);

  const current: Stats =
    view === "date" ? (stats.date ?? stats.today) : stats[view];
  const activeDay = view === "date" ? (initialDate ?? today) : today;

  // Lander visits follow the active window/date, same as the KPIs.
  const landerNow =
    view === "date" ? (landerVisits.date ?? landerVisits.today) : landerVisits[view];
  const perUserRows = view === "date" ? (perUser.date ?? []) : perUser.tabs;

  const kpis = [
    { label: "Total copies", value: current.totalCopies },
    { label: "Unique copiers", value: current.uniqueCopiers },
    { label: "New accounts", value: current.newAccounts },
    { label: "Total logins", value: current.totalLogins },
    { label: "DAU", value: current.dau },
  ];

  const catTotal = CATEGORIES.reduce(
    (s, c) => s + (current.byCategory[c] ?? 0),
    0,
  );

  return (
    <>
      {/* KPI grid — five range metrics, equal weight. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className={`${card} flex flex-col gap-2.5 p-5`}>
            <span className="text-[13px] tracking-[-0.03em] text-[#71717b]">
              {k.label}
            </span>
            <span className="text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
              {(k.value ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </section>

      {/* Lander visits + Copies by category, same row. */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        {/* Lander Studio visits — black card. */}
        <div className="flex flex-col justify-center gap-1 rounded-2xl bg-[#09090b] px-7 py-4 text-white lg:min-w-60">
          <span className="text-xs tracking-[-0.03em] text-white/55">
            Lander Studio visits
          </span>
          <span className="text-[28px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {landerNow.toLocaleString()}
          </span>
        </div>

        {/* Copies by category — fills the row; pills span the full card width. */}
        <div className={`${card} flex flex-col gap-3.5 p-5`}>
          <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#09090b]">
            Copies by category
          </h2>
          <div className="flex flex-wrap gap-2">
            {/* Total — black pill. */}
            <span className="flex items-center gap-2 rounded-full bg-[#09090b] px-3 py-1.5 text-white">
              <span className="text-[13px] tracking-[-0.03em]">Total</span>
              <span className="rounded-full bg-white/15 px-1.5 text-xs font-semibold tabular-nums">
                {catTotal.toLocaleString()}
              </span>
            </span>
            {CATEGORIES.map((cat) => {
              const v = current.byCategory[cat] ?? 0;
              return (
                <span
                  key={cat}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
                    v > 0
                      ? "border-[#e4e4e7] bg-white"
                      : "border-[#eef0f2] bg-white opacity-55"
                  }`}
                >
                  <span className="text-[13px] tracking-[-0.03em] text-[#52525b]">
                    {cat}
                  </span>
                  <span
                    className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                      v > 0
                        ? "bg-[#deeaff] text-[#2974ff]"
                        : "bg-[#f5f5f5] text-[#71717b]"
                    }`}
                  >
                    {v.toLocaleString()}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Top copied components — ranked list (all time). */}
      <section className={`${card} flex flex-col overflow-hidden`}>
        <div className="flex items-baseline justify-between border-b border-[#f0f1f3] px-6 py-4">
          <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#09090b]">
            Top copied components
          </h2>
          <span className="text-xs tracking-[-0.03em] text-[#71717b]">
            All time
          </span>
        </div>
        {topComponents.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#71717b]">
            No copies yet.
          </div>
        ) : (
          <ul className="divide-y divide-[#f0f1f3]">
            {topComponents.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-3.5 px-6 py-2.5 transition-colors hover:bg-[#fafafa]"
              >
                <span className="w-4 shrink-0 text-center text-[13px] font-medium tabular-nums text-[#a1a1aa]">
                  {i + 1}
                </span>
                {c.preview_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cloudflareThumb(c.preview_url)}
                    alt=""
                    className="h-9 w-14 shrink-0 rounded-md border border-[#e7e9ee] bg-white object-contain"
                  />
                ) : (
                  <div className="h-9 w-14 shrink-0 rounded-md border border-[#e7e9ee] bg-[#f5f5f5]" />
                )}
                <Link
                  href={`/upload/${c.id}/edit`}
                  title={c.id}
                  className="min-w-0 flex-1 truncate font-mono text-xs text-[#52525b] underline-offset-2 hover:text-[#2974ff] hover:underline"
                >
                  {c.id}
                </Link>
                <span className="shrink-0 rounded-md border border-[#e7e9ee] bg-[#f5f5f5] px-2 py-0.5 text-[11px] tracking-[-0.03em] text-[#52525b]">
                  {c.category}
                </span>
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {c.copy_count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-user activity — top 50 with a "Show all" toggle + sort. */}
      <PerUserActivity
        rows={perUserRows}
        day={activeDay}
        categoryById={categoryById}
      />
    </>
  );
}

// Skeleton placeholders for the streamed sections — same frames/sizes as the
// real content so the layout doesn't shift when data lands.
function AnalyticsSkeleton() {
  return (
    <>
      {/* KPI grid */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${card} flex flex-col gap-2.5 p-5`}>
            <div className={`${skel} h-3 w-20`} />
            <div className={`${skel} h-7 w-16`} />
          </div>
        ))}
      </section>

      {/* Lander + category */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-col justify-center gap-2 rounded-2xl bg-[#09090b] px-5 py-4">
          <div className="h-3 w-32 animate-pulse rounded-md bg-white/20" />
          <div className="h-6 w-20 animate-pulse rounded-md bg-white/20" />
        </div>
        <div className={`${card} flex flex-col gap-3.5 p-5`}>
          <div className={`${skel} h-4 w-36`} />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`${skel} h-8 w-28 rounded-full`} />
            ))}
          </div>
        </div>
      </section>

      {/* Top components */}
      <section className={`${card} flex flex-col overflow-hidden`}>
        <div className="flex items-baseline justify-between border-b border-[#f0f1f3] px-6 py-4">
          <div className={`${skel} h-4 w-40`} />
          <div className={`${skel} h-3 w-14`} />
        </div>
        <ul className="divide-y divide-[#f0f1f3]">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3.5 px-6 py-2.5">
              <div className={`${skel} h-3 w-4`} />
              <div className={`${skel} h-9 w-14`} />
              <div className={`${skel} h-3 flex-1`} />
              <div className={`${skel} h-5 w-16 rounded-md`} />
              <div className={`${skel} h-4 w-10`} />
            </li>
          ))}
        </ul>
      </section>

      {/* Per-user activity table */}
      <section className="flex flex-col gap-3">
        <div className={`${skel} h-4 w-56`} />
        <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white">
          <div className="border-b border-[#e7e9ee] bg-[#fafafa] px-5 py-3">
            <div className={`${skel} h-3 w-full max-w-md`} />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-b border-[#f0f1f3] px-5 py-3 last:border-0">
              <div className={`${skel} h-3.5 w-full`} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
