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

  // Applicant name/username + email, only for the users shown — all from one
  // profiles read (email is mirrored there by the signup trigger). Avoids the
  // per-user admin.auth.admin.getUserById fan-out, which was the page's main
  // latency. Name falls back: profiles.full_name → email prefix.
  const profileMap = new Map<
    string,
    { name: string | null; username: string | null; email: string }
  >();
  if (uids.length) {
    // Try with email; retry on the core columns if the DB lacks the email column
    // so name/username still load (email falls back to the auth lookup below).
    let profRes = await admin
      .from("profiles")
      .select("id, full_name, username, email")
      .in("id", uids);
    if (profRes.error) {
      profRes = (await admin
        .from("profiles")
        .select("id, full_name, username")
        .in("id", uids)) as typeof profRes;
    }
    for (const p of (profRes.data as {
      id: string;
      full_name: string | null;
      username: string | null;
      email?: string | null;
    }[]) ?? []) {
      profileMap.set(p.id, {
        name: p.full_name ?? null,
        username: p.username ?? null,
        email: (p.email as string) || "",
      });
    }

    // Fallback ONLY for applicants whose profile is missing email or name —
    // normally empty, so the per-user auth lookup is skipped.
    const incomplete = uids.filter((id) => {
      const p = profileMap.get(id);
      return !p?.email || !p?.name;
    });
    if (incomplete.length) {
      await Promise.all(
        incomplete.map(async (id) => {
          const { data: u } = await admin.auth.admin.getUserById(id);
          const user = u?.user;
          if (!user) return;
          const existing = profileMap.get(id);
          const meta = user.user_metadata ?? {};
          const metaName =
            (meta.full_name as string) || (meta.name as string) || null;
          profileMap.set(id, {
            name: existing?.name ?? metaName,
            username: existing?.username ?? null,
            email: existing?.email || user.email || "",
          });
        }),
      );
    }
  }

  const items: AppItem[] = apps.map((a) => {
    const p = profileMap.get(a.user_id);
    const email = p?.email || "";
    const name =
      p?.name || (email ? email.split("@")[0] : "") || "—";
    return {
      id: a.id,
      role: a.role,
      social_url: a.social_url,
      reason: a.reason,
      status: a.status,
      created_at: a.created_at,
      name,
      username: p?.username ?? null,
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
