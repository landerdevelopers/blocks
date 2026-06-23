import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import CreatorAccessButton from "./CreatorAccessButton";
import AdminBackLink from "../AdminBackLink";

// Admin-only (gated by middleware). Lists every approved creator (a user with
// an approved Creator Program application) and their design counts by status.
export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  role: string | null;
};

const card =
  "rounded-2xl border border-[#e7e9ee] bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.04)]";

export default async function AdminCreatorsPage() {
  const admin = createAdminClient();

  // Approved creators = distinct users with an approved application.
  const { data: approved } = await admin
    .from("creator_applications")
    .select("user_id, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  // Distinct user ids, newest-approval first.
  const uids: string[] = [];
  for (const a of (approved as { user_id: string }[]) ?? []) {
    if (!uids.includes(a.user_id)) uids.push(a.user_id);
  }

  const profileMap = new Map<string, ProfileRow & { email: string | null }>();
  const counts = new Map<
    string,
    { total: number; live: number; pending: number; rejected: number }
  >();

  if (uids.length) {
    // Kick off the counts RPC in parallel with the profiles read.
    const countsPromise = admin.rpc("get_creator_counts", { creator_ids: uids });

    // Profiles (incl. email, mirrored by the signup trigger) — replaces the
    // per-user admin.auth.admin.getUserById fan-out that dominated load time.
    // If the DB predates the `email` column, the select errors — retry with the
    // core columns so username/name/avatar still load (and email falls back to
    // the auth lookup below).
    let profRes = await admin
      .from("profiles")
      .select("id, full_name, avatar_url, username, bio, role, email")
      .in("id", uids);
    if (profRes.error) {
      profRes = (await admin
        .from("profiles")
        .select("id, full_name, avatar_url, username, bio, role")
        .in("id", uids)) as typeof profRes;
    }
    for (const p of (profRes.data as (ProfileRow & {
      email?: string | null;
    })[]) ?? []) {
      profileMap.set(p.id, { ...p, email: p.email ?? null });
    }

    const countsRes = await countsPromise;

    for (const c of (countsRes.data as
      | {
          uploaded_by: string;
          total: number;
          live: number;
          pending: number;
          rejected: number;
        }[]
      | null) ?? []) {
      counts.set(c.uploaded_by, {
        total: Number(c.total),
        live: Number(c.live),
        pending: Number(c.pending),
        rejected: Number(c.rejected),
      });
    }

    // Fallback ONLY for creators whose profile is missing email or name (e.g.
    // signed up before the email column/trigger). Normally this set is empty, so
    // the per-user auth lookup fan-out is skipped entirely.
    const incomplete = uids.filter((id) => {
      const p = profileMap.get(id);
      return !p?.email || !p?.full_name;
    });
    if (incomplete.length) {
      await Promise.all(
        incomplete.map(async (id) => {
          const { data } = await admin.auth.admin.getUserById(id);
          const u = data?.user;
          if (!u) return;
          const existing = profileMap.get(id);
          const meta = u.user_metadata ?? {};
          const metaName =
            (meta.full_name as string) || (meta.name as string) || null;
          const metaAvatar =
            (meta.avatar_url as string) || (meta.picture as string) || null;
          profileMap.set(id, {
            id,
            full_name: existing?.full_name ?? metaName,
            avatar_url: existing?.avatar_url ?? metaAvatar,
            username: existing?.username ?? null,
            bio: existing?.bio ?? null,
            role: existing?.role ?? null,
            email: existing?.email || u.email || "",
          });
        }),
      );
    }
  }

  const rows = uids.map((id) => {
    const p = profileMap.get(id);
    const email = p?.email || "";
    const name =
      p?.full_name || p?.username || (email ? email.split("@")[0] : "") || "—";
    return {
      id,
      name,
      email,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
      bio: p?.bio ?? null,
      role: p?.role ?? null,
      counts: counts.get(id) ?? { total: 0, live: 0, pending: 0, rejected: 0 },
    };
  });

  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b] tracking-[-0.01em]">
      <div className="mx-auto flex w-full max-w-275 flex-col gap-6">
        <AdminBackLink />
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.04em]">
              Creators
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              {rows.length.toLocaleString()} approved creator
              {rows.length === 1 ? "" : "s"}
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
              href="/admin/applications"
              className="rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium tracking-[-0.03em] text-[#52525b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[#fafafa]"
            >
              Applications
            </Link>
          </div>
        </header>

        <section className={`${card} flex flex-col overflow-hidden`}>
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-[#71717b]">
              No approved creators yet.
            </div>
          ) : (
            <ul className="divide-y divide-[#f0f1f3]">
              {rows.map((r) => {
                const rowInner = (
                  <>
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#ebebef] text-sm font-medium text-[#09090b]">
                      {r.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          src={r.avatar_url}
                          referrerPolicy="no-referrer"
                          className="size-full object-cover"
                        />
                      ) : (
                        r.name.charAt(0).toUpperCase()
                      )}
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-medium tracking-[-0.03em] text-[#09090b]">
                        {r.name}
                      </span>
                      <span className="truncate text-[13px] tracking-[-0.03em] text-[#71717b]">
                        {r.email || "—"}
                        {r.username ? ` · @${r.username}` : ""}
                      </span>
                    </div>

                    {/* Grant / revoke creator access. Hidden for admins. */}
                    {r.role !== "admin" && (
                      <CreatorAccessButton
                        userId={r.id}
                        isCreator={r.role === "creator"}
                      />
                    )}

                    <div className="flex shrink-0 items-center gap-2 text-[12px] tracking-[-0.03em]">
                      <span className="rounded-full bg-[#deeaff] px-2 py-0.5 font-medium text-[#2974ff]">
                        {r.counts.live} live
                      </span>
                      <span className="rounded-full bg-[#fff0d6] px-2 py-0.5 font-medium text-[#ca8000]">
                        {r.counts.pending} pending
                      </span>
                      <span className="rounded-full bg-[#ffe1e1] px-2 py-0.5 font-medium text-[#ef4444]">
                        {r.counts.rejected} rejected
                      </span>
                      <span className="rounded-full border border-[#e7e9ee] px-2 py-0.5 font-medium text-[#52525b]">
                        {r.counts.total} total
                      </span>
                    </div>
                  </>
                );
                // Whole row links to the creator's page when they have a handle.
                return (
                  <li key={r.id}>
                    {r.username ? (
                      <Link
                        href={`/creators/${r.username}`}
                        className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-[#fafafa]"
                      >
                        {rowInner}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-4 px-6 py-3.5">
                        {rowInner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
