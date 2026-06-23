"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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
  // Reject flow: the application id awaiting a feedback note (null = modal
  // closed) and the feedback draft (emailed to the applicant).
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
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

  // Reject opens a feedback modal first; submitting posts to an API route that
  // saves the rejection + emails the applicant the feedback (email key stays
  // server-side). Approve likewise goes through its own route (welcome email).
  const submitReject = async () => {
    const id = rejectId;
    const feedback = reason.trim();
    if (!id || !feedback) return;
    setRejectId(null);
    setBusy(id);
    const res = await fetch("/api/creator-rejected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: id, reason: feedback }),
    });
    setBusy(null);
    if (!res.ok) return;
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

  // Rejection-feedback modal — same design as the design-approvals reject modal.
  const rejectModal =
    rejectId && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => setRejectId(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex w-[445px] max-w-full flex-col gap-5 rounded-[20px] bg-white p-6 shadow-[0px_0px_0px_1px_rgba(51,51,51,0.04),0px_5px_5px_-2.5px_rgba(51,51,51,0.08),0px_1px_3px_-1.5px_rgba(51,51,51,0.16)]"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between">
                  <h2 className="text-[16px] font-medium tracking-[-0.03em] text-[#09090b]">
                    Why are you rejecting this application?
                  </h2>
                  <button
                    type="button"
                    onClick={() => setRejectId(null)}
                    aria-label="Close"
                    className="cursor-pointer text-[#71717b] transition-colors hover:text-[#09090b]"
                  >
                    <X size={18} strokeWidth={1.75} />
                  </button>
                </div>
                <p className="text-[14px] tracking-[-0.03em] text-[#71717b]">
                  This feedback is emailed to the applicant.
                </p>
              </div>

              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                placeholder="Share feedback so they can improve and re-apply…"
                className="h-[88px] resize-none rounded-[12px] text-[14px] tracking-[-0.03em] placeholder:text-[#757575] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRejectId(null)}
                  className="cursor-pointer rounded-[10px] border border-[#ebebeb] bg-white px-3 py-2 text-[14px] tracking-[-0.03em] text-[#71717b] shadow-[0px_1px_2px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#ececec]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitReject}
                  disabled={!reason.trim()}
                  className="cursor-pointer rounded-[10px] bg-[#2974ff] px-3 py-2 text-[14px] tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col gap-4">
      {rejectModal}
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
                    onClick={() => {
                      setReason("");
                      setRejectId(a.id);
                    }}
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
