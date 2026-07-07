"use client";

import Link from "next/link";
import {
  Suspense,
  use,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from "react";
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

// One IST calendar day of trend data — powers the charts above the top-copied
// list. Oldest→newest, gap-filled with zeros by the get_analytics_daily RPC.
export type DailyPoint = {
  date: string; // YYYY-MM-DD (IST)
  newSignups: number;
  activeUsers: number;
  copies: number;
  uniqueCopiers: number;
  uniqueIps: number;
};

// Everything the page streams in after the shell paints. Passed as a promise so
// the chrome (title/tabs/date picker) renders instantly and the heavy reads show
// skeletons until they resolve.
export type AnalyticsData = {
  stats: { today: Stats; "7d": Stats; all: Stats; date: Stats | null };
  topComponents: TopComponent[];
  // Full per-day trend series (charts slice it per tab); `date` = YYYY-MM-DD.
  daily: DailyPoint[];
  // Hourly buckets for today (charts use it for the Today tab); `date` = "00".."23".
  hourly: DailyPoint[];
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
  const { stats, topComponents, daily, hourly, landerVisits, perUser, categoryById } =
    use(dataPromise);

  const current: Stats =
    view === "date" ? (stats.date ?? stats.today) : stats[view];
  const activeDay = view === "date" ? (initialDate ?? today) : today;

  // Lander visits follow the active window/date, same as the KPIs.
  const landerNow =
    view === "date" ? (landerVisits.date ?? landerVisits.today) : landerVisits[view];
  const perUserRows = view === "date" ? (perUser.date ?? []) : perUser.tabs;

  // Charts follow the same tab/date filter. Today = hour-wise (24 buckets);
  // 7d/all slice the full daily series; date = that single day.
  // xKind drives x-axis tick formatting; xLabels controls tick density
  // (all-time is too dense to label, so "none").
  const chart:
    | { data: DailyPoint[]; xKind: "hour" | "day"; xLabels: "all" | "sparse" | "none" }
    = view === "today"
      ? { data: hourly, xKind: "hour", xLabels: "sparse" }
      : view === "all"
        ? { data: daily, xKind: "day", xLabels: "none" }
        : view === "7d"
          ? { data: daily.slice(-7), xKind: "day", xLabels: "all" }
          : { data: daily.filter((d) => d.date === (initialDate ?? today)), xKind: "day", xLabels: "all" };
  const chartLabel =
    view === "date" ? (initialDate ?? today) : TABS[view];

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
        {/* Lander Studio visits — white card, matches the KPI/category cards. */}
        <div className={`${card} flex flex-col justify-center gap-1 px-7 py-4 lg:min-w-60`}>
          <span className="text-xs tracking-[-0.03em] text-[#71717b]">
            Lander Studio visits
          </span>
          <span className="text-[28px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[#09090b]">
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

      {/* Trend charts — series filtered by the active tab/date above. */}
      <TrendCharts
        data={chart.data}
        xKind={chart.xKind}
        xLabels={chart.xLabels}
        label={chartLabel}
      />

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

// The five metrics rendered as small line charts. Config is a static list so
// each chart pulls its own key/label/accent from the shared DailyPoint series.
const TREND_METRICS: {
  key: keyof Omit<DailyPoint, "date">;
  label: string;
  accent: string;
}[] = [
  { key: "newSignups", label: "New signups", accent: "#2974ff" },
  { key: "activeUsers", label: "Unique active users", accent: "#7c5cff" },
  { key: "copies", label: "Copy count", accent: "#12b981" },
  { key: "uniqueCopiers", label: "Unique copied accounts", accent: "#f59e0b" },
  { key: "uniqueIps", label: "Unique views per IP", accent: "#ef4444" },
];

type XKind = "hour" | "day";
type XLabels = "all" | "sparse" | "none";

function TrendCharts({
  data,
  xKind,
  xLabels,
  label,
}: {
  data: DailyPoint[];
  xKind: XKind;
  xLabels: XLabels;
  label: string;
}) {
  return (
    <section className={`${card} flex flex-col gap-5 p-6`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#09090b]">
          Trends
        </h2>
        <span className="text-xs tracking-[-0.03em] text-[#71717b]">
          {data.length ? label : "No data"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TREND_METRICS.map((m) => (
          <MiniLineChart
            key={m.key}
            label={m.label}
            accent={m.accent}
            xKind={xKind}
            xLabels={xLabels}
            points={data.map((d) => ({ date: d.date, value: d[m.key] }))}
          />
        ))}
      </div>
    </section>
  );
}

// Format an x-axis tick: "YYYY-MM-DD" → "M/D" for days, "HH" → "9a"/"12p" hours.
function fmtX(key: string, kind: XKind): string {
  if (kind === "hour") {
    return `${key.padStart(2, "0")}:00`; // 24-hour, e.g. "16:00"
  }
  const [, mo, da] = key.split("-");
  return `${Number(mo)}/${Number(da)}`;
}

// A dependency-free SVG line chart for one daily metric. The line + soft area
// fill scale to the series max; hovering a day shows its date + value with a
// marker + guide line. The header shows the window total and the hovered (or
// latest) day's value. viewBox lets it flex to the card width.
function MiniLineChart({
  label,
  accent,
  points,
  xKind,
  xLabels,
}: {
  label: string;
  accent: string;
  points: { date: string; value: number }[];
  xKind: XKind;
  xLabels: XLabels;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values);
  const total = values.reduce((s, v) => s + v, 0);
  const latest = values[values.length - 1] ?? 0;
  const active = hover != null ? points[hover] : null;

  // Fixed viewBox; a small vertical pad keeps the line off the top/bottom edges.
  const W = 100;
  const H = 40;
  const pad = 2;
  // Outer viewBox margin so edge points/strokes aren't clipped at the sides/top.
  const M = 3;
  const n = points.length;
  // X for point i; a single-point series (today / one date) centers so its dot
  // sits mid-chart instead of hugging the edge.
  const xAt = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  // Show a dot on every day only for short windows (today/date/7d); the all-time
  // series would be too dense, so it's line-only.
  const showDots = n <= 10;
  const yAt = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const line = points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ");
  const area =
    n > 0
      ? `${xAt(0)},${H} ` +
        points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ") +
        ` ${xAt(n - 1)},${H}`
      : "";
  const gradId = `grad-${label.replace(/\W/g, "")}`;

  // Nearest-point hover: map the pointer's x (0..1 of width) to an index.
  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[#eef0f2] bg-[#fafafa] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] tracking-[-0.03em] text-[#71717b]">
          {label}
        </span>
        <span className="text-xs tabular-nums text-[#a1a1aa]">
          {total.toLocaleString()} total
        </span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[#09090b]">
          {(active ? active.value : latest).toLocaleString()}
        </span>
        <span className="pb-0.5 text-[11px] tracking-[-0.03em] text-[#a1a1aa]">
          {active
            ? fmtX(active.date, xKind)
            : xKind === "hour"
              ? "now"
              : "latest"}
        </span>
      </div>
      {/* Plot with a date x-axis below. */}
      <div className="flex">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <svg
            viewBox={`${-M} ${-M} ${W + M * 2} ${H + M * 2}`}
            preserveAspectRatio="none"
            className="h-14 w-full"
            role="img"
            aria-label={`${label} — daily trend`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            {area && <polygon points={area} fill={`url(#${gradId})`} />}
            <polyline
              points={line}
              fill="none"
              stroke={accent}
              strokeWidth={1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {showDots &&
              points.map((p, i) => (
                <circle
                  key={p.date}
                  cx={xAt(i)}
                  cy={yAt(p.value)}
                  r={1.5}
                  fill={accent}
                  opacity={hover == null || hover === i ? 1 : 0.4}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {active && hover != null && (
              <>
                <line
                  x1={xAt(hover)}
                  y1={0}
                  x2={xAt(hover)}
                  y2={H}
                  stroke={accent}
                  strokeWidth={0.5}
                  strokeDasharray="1.5 1.5"
                  opacity={0.5}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={xAt(hover)}
                  cy={yAt(active.value)}
                  r={2}
                  fill={accent}
                  stroke="#fafafa"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>
          {/* X axis — dense series ("all") skip labels; "sparse" shows ~6 evenly
              spaced ticks (hourly today); "all" labels every point (7d / date). */}
          {xLabels !== "none" && (
            <div className="flex justify-between text-[9px] leading-none tabular-nums text-[#a1a1aa]">
              {points.map((p, i) => {
                const step = Math.max(1, Math.ceil(n / 6));
                const tick =
                  xLabels === "all" || i % step === 0 || i === n - 1;
                const show = tick || hover === i;
                return (
                  <span
                    key={p.date}
                    className={hover == null || hover === i ? "" : "opacity-40"}
                  >
                    {show ? fmtX(p.date, xKind) : ""}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
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
        <div className={`${card} flex flex-col justify-center gap-2 px-5 py-4`}>
          <div className={`${skel} h-3 w-32`} />
          <div className={`${skel} h-6 w-20`} />
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

      {/* Trend charts */}
      <section className={`${card} flex flex-col gap-5 p-6`}>
        <div className="flex items-baseline justify-between">
          <div className={`${skel} h-4 w-20`} />
          <div className={`${skel} h-3 w-16`} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2.5 rounded-xl border border-[#eef0f2] bg-[#fafafa] p-4"
            >
              <div className={`${skel} h-3 w-28`} />
              <div className={`${skel} h-6 w-16`} />
              <div className={`${skel} h-14 w-full`} />
            </div>
          ))}
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
