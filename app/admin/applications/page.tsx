import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIST, addDays } from "@/lib/ist";
import StatsTabs from "../StatsTabs";
import AdminBackLink from "../AdminBackLink";
import ApplicationsList from "./ApplicationsList";
import { APP_PAGE_SIZE, fetchApplicationPage, buildApplicationItems } from "./data";

type WindowStats = Record<"today" | "7d" | "all", Record<string, number>>;

// Admin-only (gated by middleware). Lists Creator Program applications,
// server-paginated (first page here, the rest via a load-more server action).
export const dynamic = "force-dynamic";

export default async function AdminApplicationsPage() {
  const admin = createAdminClient();
  const today = todayIST();
  const start7 = addDays(today, -6);
  const [firstRows, { data: statsRaw }] = await Promise.all([
    fetchApplicationPage(0),
    admin.rpc("get_application_stats", { d_today: today, d_start7: start7 }),
  ]);
  const appWindows = (statsRaw as WindowStats | null) ?? null;
  const items = await buildApplicationItems(firstRows);
  const totalCount = appWindows?.all?.total ?? items.length;
  const initialHasMore = firstRows.length === APP_PAGE_SIZE;

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-275 flex-col gap-6">
        <AdminBackLink />
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Creator Applications
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {totalCount.toLocaleString()} application
              {totalCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/approvals"
              className="rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium tracking-[-0.03em] text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafa]"
            >
              Approvals
            </Link>
            <Link
              href="/admin/creators"
              className="rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium tracking-[-0.03em] text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafa]"
            >
              Creators
            </Link>
          </div>
        </header>

        {/* Summary — today / 7d / all-time. */}
        <StatsTabs
          windows={appWindows}
          cards={[
            { key: "total", label: "Total applied", color: "#09090b" },
            { key: "pending", label: "Pending", color: "#ca8000" },
            { key: "approved", label: "Accepted", color: "#1c9a00" },
            { key: "rejected", label: "Rejected", color: "#ef4444" },
          ]}
        />

        <ApplicationsList
          items={items}
          initialHasMore={initialHasMore}
          pageSize={APP_PAGE_SIZE}
        />
      </div>
    </main>
  );
}
