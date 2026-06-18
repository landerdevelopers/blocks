"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Check, Clock, X } from "lucide-react";
import { cloudflareThumb } from "@/lib/utils";

export type PendingItem = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  colors: { hex: string; pct: number | null }[] | null;
  preview_url: string | null;
  aspect_ratio: number | null;
  created_at: string;
  creatorName: string;
  creatorAvatar: string | null;
  creatorUsername: string | null;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${d.getDate()} ${month}, ${d.getFullYear()}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LABEL =
  "text-[10px] font-medium uppercase tracking-[-0.03em] text-black";

function Card({
  item,
  onReview,
  busy,
}: {
  item: PendingItem;
  onReview: (id: string, action: "approve" | "reject") => void;
  busy: boolean;
}) {
  const themes = item.filters ?? [];
  const colors = item.colors ?? [];
  return (
    <div className="mb-4 flex break-inside-avoid flex-col gap-1.5 rounded-[12px] border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]">
      {/* Preview — natural height per image (aspect ratio preserved). */}
      <div
        className="w-full overflow-hidden rounded-[6px] border border-[#e7e9ee] bg-[#e4e4e7]"
        style={{ aspectRatio: String(item.aspect_ratio || 16 / 10) }}
      >
        {item.preview_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={cloudflareThumb(item.preview_url)}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* Creator + actions */}
        <div className="flex items-start justify-between border-b border-[#e7e7e7] px-2 pb-3.5 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="flex size-[35px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#ebebef] text-sm font-medium text-[#09090b]">
              {item.creatorAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={item.creatorAvatar}
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                item.creatorName.charAt(0).toUpperCase()
              )}
            </span>
            {item.creatorUsername ? (
              <Link
                href={`/creators/${item.creatorUsername}`}
                className="text-[18px] tracking-[-0.03em] text-black underline-offset-2 hover:text-[#2974ff] hover:underline"
              >
                {item.creatorName}
              </Link>
            ) : (
              <span className="text-[18px] tracking-[-0.03em] text-black">
                {item.creatorName}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label="Reject"
              disabled={busy}
              onClick={() => onReview(item.id, "reject")}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-[#ffdede] text-[#ef4444] transition-colors hover:bg-[#ffcaca] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Approve"
              disabled={busy}
              onClick={() => onReview(item.id, "approve")}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-[#b2ffbe] text-[#16a34a] transition-colors hover:bg-[#9bf5a9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-2.5 px-2 pb-1">
          {/* Category + section */}
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1">
              <p className={LABEL}>Category</p>
              <span className="flex w-fit items-center rounded-full bg-[#18181b] px-3.5 py-[5px] text-[12px] text-white">
                {item.category ?? "—"}
              </span>
            </div>
            {item.section && (
              <>
                <div className="self-stretch w-px bg-[#e4e4e7]" />
                <div className="flex flex-col gap-1">
                  <p className={LABEL}>Section Selected</p>
                  <span className="flex w-fit items-center rounded-full bg-[#18181b] px-3.5 py-[5px] text-[12px] text-white">
                    {item.section}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Themes */}
          {themes.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className={LABEL}>Selected theme</p>
              <div className="flex flex-wrap gap-1.5">
                {themes.map((t) => (
                  <span
                    key={t}
                    className="flex items-center rounded-full border border-[#e4e4e7] px-3.5 py-[5px] text-[12px] text-[#52525c]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          {colors.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className={LABEL}>Colors selected</p>
              <div className="flex flex-wrap gap-1.5">
                {colors.map((c, i) => (
                  <div
                    key={`${c.hex}-${i}`}
                    className="flex items-center gap-4 rounded-[7px] bg-white p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-4 shrink-0 rounded border border-black/5"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-[12px] font-medium uppercase text-[#71717b]">
                        {c.hex}
                      </span>
                    </div>
                    {c.pct != null && (
                      <span className="flex items-center justify-center rounded-full bg-[#f5f5f5] p-1 text-[10px] font-medium text-black">
                        {c.pct} %
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date + time */}
          <div className="flex items-center gap-1.5 py-1.5 text-[14px] tracking-[-0.03em] text-[#71717b]">
            <span className="flex items-center gap-1">
              <Calendar size={14} strokeWidth={1.5} />
              {fmtDate(item.created_at)}
            </span>
            <span className="size-1 rounded-full bg-[#d4d4d8]" />
            <span className="flex items-center gap-1">
              <Clock size={14} strokeWidth={1.5} />
              {fmtTime(item.created_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsGrid({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  // The grid is derived from the live server `items` prop (the page is
  // force-dynamic). `removed` only tracks ids reviewed this session so they
  // drop instantly before the server data re-fetches.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // Refresh the server data when the admin returns to the tab — picks up
  // designs a creator deleted while pending (admin can't realtime-subscribe to
  // other creators' pending rows under RLS) and any other queue changes.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  const onReview = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    const res = await fetch("/api/component-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ componentId: id, action }),
    });
    setBusy(null);
    if (!res.ok) return;
    // Reviewed → drops out of the pending queue immediately.
    setRemoved((r) => new Set(r).add(id));
    // Re-sync with the server so the underlying data matches.
    router.refresh();
  };

  const pending = items.filter((i) => !removed.has(i.id));

  if (pending.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e7e9ee] bg-white px-6 py-16 text-center text-sm text-[#71717b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        No designs awaiting review.
      </div>
    );
  }

  return (
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
      {pending.map((item) => (
        <Card
          key={item.id}
          item={item}
          busy={busy === item.id}
          onReview={onReview}
        />
      ))}
    </div>
  );
}
