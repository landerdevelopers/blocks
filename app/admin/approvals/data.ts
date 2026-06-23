import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PendingItem } from "./ApprovalsGrid";

export const APPROVAL_PAGE_SIZE = 30;

type CompRow = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  colors: { hex: string; pct: number | null }[] | null;
  preview_url: string | null;
  aspect_ratio: number | null;
  created_at: string;
  uploaded_by: string | null;
  reuploaded: boolean | null;
};

// Fetch one page of pending components, newest first. figma_data (the big
// column) is NOT pulled — it's fetched on demand on copy. Service-role; callers
// must authorize (admin).
export async function fetchApprovalPage(offset: number): Promise<CompRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("components")
    .select(
      "id, category, section, filters, colors, preview_url, aspect_ratio, created_at, uploaded_by, reuploaded",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(offset, offset + APPROVAL_PAGE_SIZE - 1);
  return (data as CompRow[]) ?? [];
}

// Build display items for a page of pending rows. Only creator submissions are
// shown (admin uploads auto-approve, so they're never pending — but the role
// filter stays as a guard). Returns the built items AND the raw row count so the
// caller can advance the offset / decide hasMore independent of how many were
// filtered out.
export async function buildApprovalItems(
  rows: CompRow[],
): Promise<{ items: PendingItem[]; rawCount: number }> {
  const admin = createAdminClient();
  const uids = [
    ...new Set(rows.map((c) => c.uploaded_by).filter(Boolean)),
  ] as string[];

  const profileMap = new Map<
    string,
    {
      name: string | null;
      avatar: string | null;
      username: string | null;
      role: string | null;
    }
  >();
  if (uids.length) {
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, avatar_url, username, role")
      .in("id", uids);
    for (const p of data ?? []) {
      profileMap.set(p.id as string, {
        name: (p.full_name as string) ?? null,
        avatar: (p.avatar_url as string) ?? null,
        username: (p.username as string) ?? null,
        role: (p.role as string) ?? null,
      });
    }
  }

  const items: PendingItem[] = rows
    .filter((c) => profileMap.get(c.uploaded_by ?? "")?.role === "creator")
    .map((c) => {
      const prof = profileMap.get(c.uploaded_by ?? "");
      return {
        id: c.id,
        category: c.category,
        section: c.section,
        filters: c.filters,
        colors: c.colors,
        preview_url: c.preview_url,
        aspect_ratio: c.aspect_ratio,
        created_at: c.created_at,
        creatorName: prof?.name ?? "Unknown",
        creatorAvatar: prof?.avatar ?? null,
        creatorUsername: prof?.username ?? null,
        reuploaded: !!c.reuploaded,
      };
    });

  return { items, rawCount: rows.length };
}
