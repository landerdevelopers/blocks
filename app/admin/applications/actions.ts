"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchApplicationPage, buildApplicationItems } from "./data";
import type { AppItem } from "./ApplicationsList";

// Load-more for the applications list. Re-verifies the caller is an admin —
// server actions are public endpoints, and this returns applicants' emails, so
// the check is mandatory (not just middleware on the page).
export async function loadMoreApplications(offset: number): Promise<AppItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") return [];

  const rows = await fetchApplicationPage(offset);
  return buildApplicationItems(rows);
}
