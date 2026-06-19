"use server";

import { revalidateTag } from "next/cache";

// Invalidate the cached sidebar counts so a new/edited/deleted component is
// reflected on the next load instead of waiting out the 30-min revalidate
// window. Called from the upload form after a successful save.
export async function revalidateSidebarCounts() {
  // Two-arg form is required in Next 16; "max" marks the tag stale and serves
  // stale-while-revalidate (fresh counts fetched on the next visit).
  revalidateTag("sidebar_counts", "max");
}
