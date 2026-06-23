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
    const { data } = await createAdminClient().rpc("get_sidebar_counts");
    return (data as SidebarCounts | null) ?? EMPTY_COUNTS;
  },
  // v2: bump the cache key to discard the pre-private-filter entry (a stale
  // cached count survived the RPC fix). Tag stays "sidebar_counts" so on-demand
  // revalidation keeps working.
  ["sidebar_counts_v2"],
  { tags: ["sidebar_counts"], revalidate: 1800 },
);

export default async function Page() {
  const sidebarCounts = await getSidebarCounts();
  return <HomeClient initialSidebarCounts={sidebarCounts} />;
}
