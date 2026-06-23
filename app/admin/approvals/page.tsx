import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import ApprovalsGrid, { type PendingItem } from "./ApprovalsGrid";

// Admin-only (gated by middleware). Shows every creator design awaiting review
// (status = 'pending') so an admin can approve or reject each one.
export const dynamic = "force-dynamic";

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

export default async function AdminApprovalsPage() {
  const admin = createAdminClient();

  // Pending designs, newest first. Service-role client bypasses RLS (admins
  // have no select policy for other creators' unpublished rows).
  const { data: compData } = await admin
    .from("components")
    // figma_data (the table's largest column — full Figma clipboard HTML) is
    // NOT pulled here; it's fetched on demand via get_component_figma_data when
    // the reviewer clicks Copy to Figma. Keeps this list query light.
    .select(
      "id, category, section, filters, colors, preview_url, aspect_ratio, created_at, uploaded_by, reuploaded",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const comps = (compData as CompRow[]) ?? [];
  const uids = [
    ...new Set(comps.map((c) => c.uploaded_by).filter(Boolean)),
  ] as string[];

  // Creator name / avatar / handle / role for each design's uploader.
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

  // Only show submissions from creators — admin uploads also default to
  // status='pending' but are published directly, never reviewed here.
  const items: PendingItem[] = comps
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

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Design Approvals
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {items.length.toLocaleString()} design
              {items.length === 1 ? "" : "s"} awaiting review
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

        <ApprovalsGrid items={items} />
      </div>
    </main>
  );
}
