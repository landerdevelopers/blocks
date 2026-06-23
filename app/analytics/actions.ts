"use server";

import { revalidateTag } from "next/cache";

// Drop the cached analytics overview so the next render reads fresh numbers
// straight from the DB. Invoked by the in-page Refresh button; pair with a
// client-side router.refresh() to re-render the server component.
export async function refreshAnalytics() {
  revalidateTag("analytics", "max");
}
