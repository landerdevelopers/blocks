"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadMoreApplications } from "./actions";

export type AppItem = {
  id: string;
  role: string;
  social_url: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  name: string;
  email: string;
  username: string | null;
};

const STATUS: Record<AppItem["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-[#fff0d6] text-[#ca8000]" },
  approved: { label: "Approved", cls: "bg-[#e3f7ec] text-[#1c9a00]" },
  rejected: { label: "Rejected", cls: "bg-[#ffe1e1] text-[#ef4444]" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#a1a1aa]">
        {label}
      </span>
      <span className="text-[14px] tracking-[-0.03em] text-[#09090b]">
        {children}
      </span>
    </div>
  );
}

export default function ApplicationsList({
  items,
  initialHasMore = false,
  pageSize = 30,
}: {
  items: AppItem[];
  initialHasMore?: boolean;
  pageSize?: number;
}) {
  const [apps, setApps] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Infinite scroll — load the next page (admin-gated server action) when the
  // bottom sentinel nears. Dedupes by id (approve/reject may have shifted rows).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        setLoadingMore(true);
        const next = await loadMoreApplications(apps.length);
        setApps((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...next.filter((n) => !seen.has(n.id))];
        });
        setHasMore(next.length === pageSize);
        setLoadingMore(false);
        loadingRef.current = false;
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, apps.length, pageSize]);

  // Reject is a plain status update. Approve goes through an API route so the
  // applicant gets a congratulations email (and the email key stays server-side).
  const reject = async (id: string) => {
    setBusy(id);
    const { error } = await createClient()
      .from("creator_applications")
      .update({ status: "rejected" })
      .eq("id", id);
    setBusy(null);
    if (error) return;
    setApps((a) => a.map((x) => (x.id === id ? { ...x, status: "rejected" } : x)));
  };

  const approve = async (id: string) => {
    setBusy(id);
    const res = await fetch("/api/creator-approved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: id }),
    });
    setBusy(null);
    if (!res.ok) return;
    setApps((a) => a.map((x) => (x.id === id ? { ...x, status: "approved" } : x)));
  };

  if (apps.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e7e9ee] bg-white px-6 py-12 text-center text-sm text-[#71717b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        No applications yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {apps.map((a) => {
        const st = STATUS[a.status];
        const isBusy = busy === a.id;
        return (
          <div
            key={a.id}
            className="flex flex-col gap-5 rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]"
          >
            {/* Header: applicant + status */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold tracking-[-0.03em] text-[#09090b]">
                    {a.name}
                  </span>
                  {a.username && (
                    <Link
                      href={`/creators/${a.username}`}
                      className="shrink-0 text-[13px] tracking-[-0.03em] text-[#71717b] underline-offset-2 hover:text-[#2974ff] hover:underline"
                    >
                      @{a.username}
                    </Link>
                  )}
                </div>
                <span className="truncate text-[14px] tracking-[-0.03em] text-[#71717b]">
                  {a.email || "—"}
                </span>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium tracking-[-0.03em] ${st.cls}`}
              >
                {st.label}
              </span>
            </div>

            {/* Form data */}
            <div className="flex flex-col gap-5 rounded-xl bg-[#fafafa] p-4">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="What they do">{a.role}</Field>
                <Field label="Social profile">
                  {a.social_url ? (
                    <a
                      href={a.social_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[#2974ff] underline-offset-2 hover:underline"
                    >
                      {a.social_url}
                    </a>
                  ) : (
                    <span className="text-[#a1a1aa]">—</span>
                  )}
                </Field>
              </div>
              <Field label="Why they want to become a creator">
                {a.reason ? (
                  <span className="whitespace-pre-wrap">{a.reason}</span>
                ) : (
                  <span className="text-[#a1a1aa]">—</span>
                )}
              </Field>
            </div>

            {/* Footer: date + actions */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-[12px] tracking-[-0.03em] text-[#a1a1aa]">
                Applied {fmtDate(a.created_at)}
              </span>
              {/* Actions only while the application is still pending. */}
              {a.status === "pending" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => reject(a.id)}
                    disabled={isBusy}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e7e9ee] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fff0f0] hover:text-[#ef4444] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={16} strokeWidth={2} />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => approve(a.id)}
                    disabled={isBusy}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#2974ff] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={16} strokeWidth={2} />
                    Approve
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="py-4 text-center text-sm tracking-[-0.03em] text-[#a1a1aa]"
        >
          {loadingMore ? "Loading…" : ""}
        </div>
      )}
    </div>
  );
}
