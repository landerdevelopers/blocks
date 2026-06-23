"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchApprovalPage, buildApprovalItems } from "./data";
import type { PendingItem } from "./ApprovalsGrid";

// Load-more for the approvals queue. Re-verifies admin (server actions are
// public endpoints). `offset` is the RAW number of pending rows already
// fetched (not the displayed item count, which the creator-role filter may
// reduce). Returns the next page's items + the raw row count.
export async function loadMoreApprovals(
  offset: number,
): Promise<{ items: PendingItem[]; rawCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], rawCount: 0 };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") return { items: [], rawCount: 0 };

  const rows = await fetchApprovalPage(offset);
  return buildApprovalItems(rows);
}
