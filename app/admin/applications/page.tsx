import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import ApplicationsList, { type AppItem } from "./ApplicationsList";

// Admin-only (gated by middleware). Lists every Creator Program application.
export const dynamic = "force-dynamic";

type AppRow = {
  id: string;
  user_id: string;
  role: string;
  social_url: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export default async function AdminApplicationsPage() {
  const admin = createAdminClient();
  const { data: appsData } = await admin
    .from("creator_applications")
    .select("id, user_id, role, social_url, reason, status, created_at")
    .order("created_at", { ascending: false });

  const apps = (appsData as AppRow[]) ?? [];
  const uids = [...new Set(apps.map((a) => a.user_id))];

  // Applicant name/username + email, only for the users shown. Name falls back
  // from profiles.full_name → auth metadata name → email prefix.
  const profileMap = new Map<string, { name: string | null; username: string | null }>();
  const emailMap: Record<string, string> = {};
  const authNameMap: Record<string, string> = {};
  if (uids.length) {
    await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, username")
        .in("id", uids)
        .then(({ data }) => {
          for (const p of data ?? []) {
            profileMap.set(p.id as string, {
              name: (p.full_name as string) ?? null,
              username: (p.username as string) ?? null,
            });
          }
        }),
      ...uids.map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        const u = data?.user;
        if (!u) return;
        emailMap[id] = u.email || "";
        const meta = u.user_metadata ?? {};
        authNameMap[id] =
          (meta.full_name as string) || (meta.name as string) || "";
      }),
    ]);
  }

  const items: AppItem[] = apps.map((a) => {
    const email = emailMap[a.user_id] || "";
    const name =
      profileMap.get(a.user_id)?.name ||
      authNameMap[a.user_id] ||
      (email ? email.split("@")[0] : "") ||
      "—";
    return {
      id: a.id,
      role: a.role,
      social_url: a.social_url,
      reason: a.reason,
      status: a.status,
      created_at: a.created_at,
      name,
      username: profileMap.get(a.user_id)?.username ?? null,
      email,
    };
  });

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-275 flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Creator Applications
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {items.length.toLocaleString()} application
              {items.length === 1 ? "" : "s"}
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

        <ApplicationsList items={items} />
      </div>
    </main>
  );
}
