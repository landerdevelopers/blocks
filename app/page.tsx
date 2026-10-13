import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SidebarCounts } from "./components/Sidebar";
import HomeClient from "./HomeClient";

const EMPTY_COUNTS: SidebarCounts = {
  categories: {},
  sections: {},
  logoLetters: [],
};

// Sidebar count badges, fetched once and cached in Next's data cache for 30 min
// — shared across ALL visitors, so the get_sidebar_counts RPC runs ~once per
// window globally (not per page load, not per user). Tagged so a successful
// upload can invalidate it on demand (see app/actions.ts). Served in the
// initial server-rendered HTML, so even a brand-new visitor sees correct counts
// on first paint with no flash and no hydration mismatch.
const getSidebarCounts = unstable_cache(
  async (): Promise<SidebarCounts> => {
    const { data, error } = await createAdminClient().rpc("get_sidebar_counts");
    // Throw rather than return EMPTY_COUNTS: unstable_cache keeps whatever is
    // returned for 30 min, so one failed call would pin every badge at 0.
    // A throw is not cached; Page falls back to zeros for this request only.
    if (error || !data) throw new Error(error?.message ?? "no sidebar counts");
    return data as SidebarCounts;
  },
  // v2: bump the cache key to discard the pre-private-filter entry (a stale
  // cached count survived the RPC fix). Tag stays "sidebar_counts" so on-demand
  // revalidation keeps working.
  ["sidebar_counts_v2"],
  { tags: ["sidebar_counts"], revalidate: 1800 },
);

export default async function Page() {
  const sidebarCounts = await getSidebarCounts().catch((e) => {
    console.error("[page] get_sidebar_counts:", e.message);
    return EMPTY_COUNTS;
  });
  return <HomeClient initialSidebarCounts={sidebarCounts} />;
}
