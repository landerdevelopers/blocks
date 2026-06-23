import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppItem } from "./ApplicationsList";

// Page size for the applications list (server-paginated).
export const APP_PAGE_SIZE = 30;

export type AppRow = {
  id: string;
  user_id: string;
  role: string;
  social_url: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

// Fetch one page of applications, newest first. Uses the service-role client —
// callers MUST authorize (admin) before invoking.
export async function fetchApplicationPage(offset: number): Promise<AppRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("creator_applications")
    .select("id, user_id, role, social_url, reason, status, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + APP_PAGE_SIZE - 1);
  return (data as AppRow[]) ?? [];
}

// Resolve display fields (name / username / email) for a page of application
// rows. Email comes from profiles (mirrored by the signup trigger); falls back
// to the auth admin API ONLY for rows still missing email/name — normally none,
// so no per-user fan-out. Service-role; callers must authorize.
export async function buildApplicationItems(
  rows: AppRow[],
): Promise<AppItem[]> {
  const admin = createAdminClient();
  const uids = [...new Set(rows.map((r) => r.user_id))];
  const profileMap = new Map<
    string,
    { name: string | null; username: string | null; email: string }
  >();

  if (uids.length) {
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

  return rows.map((a) => {
    const p = profileMap.get(a.user_id);
    const email = p?.email || "";
    const name = p?.name || (email ? email.split("@")[0] : "") || "—";
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
}
