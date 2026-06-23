import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIST, addDays } from "@/lib/ist";
import StatsTabs from "../StatsTabs";
import ApprovalsGrid from "./ApprovalsGrid";
import AdminBackLink from "../AdminBackLink";
import {
  APPROVAL_PAGE_SIZE,
  fetchApprovalPage,
  buildApprovalItems,
} from "./data";

type WindowStats = Record<"today" | "7d" | "all", Record<string, number>>;

// Admin-only (gated by middleware). Pending-review queue, server-paginated
// (first page here, the rest via a load-more server action).
export const dynamic = "force-dynamic";

export default async function AdminApprovalsPage() {
  const admin = createAdminClient();
  const today = todayIST();
  const start7 = addDays(today, -6);
  const [firstRows, { data: statsRaw }] = await Promise.all([
    fetchApprovalPage(0),
    admin.rpc("get_approval_stats", { d_today: today, d_start7: start7 }),
  ]);
  const apprWindows = (statsRaw as WindowStats | null) ?? null;
  const { items } = await buildApprovalItems(firstRows);
  const initialHasMore = firstRows.length === APPROVAL_PAGE_SIZE;
  const pendingCount = apprWindows?.all?.pending ?? items.length;

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
        <AdminBackLink />
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Design Approvals
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {pendingCount.toLocaleString()} design
              {pendingCount === 1 ? "" : "s"} awaiting review
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/applications"
              className="rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium tracking-[-0.03em] text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafa]"
            >
              Applications
            </Link>
            <Link
              href="/admin/creators"
              className="rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium tracking-[-0.03em] text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafa]"
            >
              Creators
            </Link>
          </div>
        </header>

        {/* Moderation analytics (creator submissions) — today / 7d / all-time. */}
        <StatsTabs
          windows={apprWindows}
          cards={[
            { key: "total", label: "Total submitted", color: "#09090b" },
            { key: "approved", label: "Approved", color: "#1c9a00" },
            { key: "rejected", label: "Rejected", color: "#ef4444" },
            { key: "pending", label: "Pending", color: "#ca8000" },
            { key: "creators_uploaded", label: "Creators uploaded", color: "#2974ff" },
          ]}
        />

        <ApprovalsGrid
          items={items}
          initialHasMore={initialHasMore}
          initialRawOffset={firstRows.length}
          pageSize={APPROVAL_PAGE_SIZE}
        />
      </div>
    </main>
  );
}
