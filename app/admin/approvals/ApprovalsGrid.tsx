"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Check, Clock, X } from "lucide-react";
import { cloudflareThumb, cloudflareLogo } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { loadMoreApprovals } from "./actions";

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
  // True when this is a creator's edit of a previously-approved design (now back
  // in review) — shows a "Reuploaded" tag.
  reuploaded: boolean;
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
  const [copied, setCopied] = useState(false);
  const copyLock = useRef(false);
  const isLogos = item.category === "Logos";

  // Button sizing matches the home gallery's 3-column layout (BTN[3]).
  const C = { w: 155, h: 37, cw: 196, ch: 36, r: 12, img: 22, fs: 16 };
  const pill =
    "flex items-center justify-center whitespace-nowrap border font-medium tracking-[-0.03em] shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-300 ease-out";

  // Write the Figma clipboard HTML so the reviewer can paste the real block into
  // Figma. figma_data isn't in the list query (it's the table's largest column)
  // — fetch it on demand via the admin-only get_component_figma_data RPC. The
  // fetch is handed to ClipboardItem as a promise so the clipboard write stays
  // inside the user gesture (Safari/Firefox block a write after an await).
  const copyToFigma = async () => {
    if (copyLock.current) return;
    copyLock.current = true;
    const resolved = createClient()
      .rpc("get_component_figma_data", { component_id: item.id })
      .then(({ data }) => (data as string | null) ?? "");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": resolved.then(
            (fd) => new Blob([fd], { type: "text/html" }),
          ),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — no-op
    } finally {
      copyLock.current = false;
    }
  };

  return (
    <div className="mb-4 flex break-inside-avoid flex-col gap-1.5 rounded-[12px] border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]">
      {/* Preview. Logos render as a square, padded, contained card (matching
          the gallery / creator pages); other categories keep the natural-height
          object-cover thumbnail. Copy-to-Figma slides up from the bottom on
          hover, exactly like the home gallery. */}
      <div className="group relative overflow-hidden rounded-[6px]">
        {isLogos ? (
          <div
            className="flex w-full items-center justify-center overflow-hidden rounded-[6px] border border-[#e7e9ee] bg-white p-12"
            style={{ aspectRatio: "1 / 1" }}
          >
            {item.preview_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={cloudflareLogo(item.preview_url)}
                className="size-full object-contain"
              />
            )}
          </div>
        ) : (
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
        )}
        {/* Copy-to-Figma overlay — always shown (every pending item is a creator
            upload, so figma_data always exists; it's fetched on click). */}
        <>
            {/* Hover gradient behind the button. */}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-5 h-24 bg-linear-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            {/* Copy button — hidden below the image (clipped by the wrapper's
                overflow-hidden so it never shows over the details), rises into
                place on hover. */}
            <div
              className={`pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 transition-[opacity,translate] duration-300 ease-out ${
                copied
                  ? "translate-y-0 opacity-100"
                  : "translate-y-[calc(100%+1.5rem)] opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
              }`}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={copyToFigma}
                  style={{
                    width: C.w,
                    height: C.h,
                    borderRadius: C.r,
                    fontSize: C.fs,
                    transform: copied ? "translateY(14px)" : "translateY(0)",
                    opacity: copied ? 0 : undefined,
                  }}
                  className={`${pill} gap-2 cursor-pointer hover:opacity-90 ${
                    copied
                      ? "pointer-events-none"
                      : "group-hover:pointer-events-auto"
                  } ${
                    isLogos
                      ? "border-black bg-black text-white"
                      : "border-[#e7e9ee] bg-white text-[#09090b]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    src="/figma.png"
                    style={{ width: C.img, height: C.img }}
                  />
                  Copy to Figma
                </button>

                {/* Copied pill — rises up + in over the copy pill. */}
                <div
                  aria-hidden={!copied}
                  style={{
                    width: C.cw,
                    height: C.ch,
                    borderRadius: C.r,
                    fontSize: C.fs,
                    backgroundColor: "#deffd7",
                    color: "#1C9A00",
                    borderColor: "#BAFFAA",
                    top: "50%",
                    left: "50%",
                    transform: `translate(-50%, ${copied ? "-50%" : "calc(-50% + 14px)"})`,
                    opacity: copied ? 1 : 0,
                  }}
                  className={`${pill} absolute gap-2 pointer-events-none`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    src="/Tick.png"
                    style={{ width: C.img, height: C.img }}
                  />
                  Copied Successfully!
                </div>
              </div>
            </div>
        </>
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

          {/* Date + time — with a "Reuploaded" tag pinned bottom-right when this
              is a creator's edit of a previously-approved design. */}
          <div className="flex items-center justify-between gap-1.5 py-1.5 text-[14px] tracking-[-0.03em] text-[#71717b]">
            <div className="flex items-center gap-1.5">
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
            {item.reuploaded && (
              <span className="shrink-0 rounded-full bg-[#fff0d6] px-2.5 py-1 text-[12px] font-medium tracking-[-0.03em] text-[#ca8000]">
                Reuploaded
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsGrid({
  items,
  initialHasMore = false,
  initialRawOffset = 0,
  pageSize = 30,
}: {
  items: PendingItem[];
  initialHasMore?: boolean;
  initialRawOffset?: number;
  pageSize?: number;
}) {
  const router = useRouter();
  // `removed` only tracks ids reviewed this session so they drop instantly
  // before the server data re-fetches.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Reject flow: the design id awaiting a rejection reason (null = modal closed)
  // and the reason draft.
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // Paginated list. Seeded from the server's first page; grows via load-more.
  // `rawOffset` is how many RAW pending rows have been fetched (the creator
  // filter may show fewer), driving the next offset.
  const [list, setList] = useState<PendingItem[]>(items);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [rawOffset, setRawOffset] = useState(initialRawOffset);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Re-sync when the server sends a fresh first page (e.g. after router.refresh
  // on review / tab refocus) — reset list + pagination to the new top.
  useEffect(() => {
    setList(items);
    setRawOffset(initialRawOffset);
    setHasMore(initialHasMore);
    setRemoved(new Set());
  }, [items, initialRawOffset, initialHasMore]);

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

  // Infinite scroll — fetch the next page (admin-gated server action).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || loadingRef.current) return;
        loadingRef.current = true;
        setLoadingMore(true);
        const { items: next, rawCount } = await loadMoreApprovals(rawOffset);
        setList((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...next.filter((n) => !seen.has(n.id))];
        });
        setRawOffset((o) => o + rawCount);
        setHasMore(rawCount === pageSize);
        setLoadingMore(false);
        loadingRef.current = false;
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, rawOffset, pageSize]);

  // Approve runs immediately; reject opens the reason modal first.
  const onReview = (id: string, action: "approve" | "reject") => {
    if (action === "reject") {
      setReason("");
      setRejectId(id);
      return;
    }
    void doReview(id, "approve");
  };

  const doReview = async (
    id: string,
    action: "approve" | "reject",
    rejectReason?: string,
  ) => {
    setBusy(id);
    const res = await fetch("/api/component-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ componentId: id, action, reason: rejectReason }),
    });
    setBusy(null);
    if (!res.ok) return;
    // Reviewed → drops out of the pending queue immediately.
    setRemoved((r) => new Set(r).add(id));
    // Re-sync with the server so the underlying data matches.
    router.refresh();
  };

  const submitReject = async () => {
    if (!rejectId || !reason.trim()) return;
    const id = rejectId;
    setRejectId(null);
    await doReview(id, "reject", reason.trim());
  };

  const pending = list.filter((i) => !removed.has(i.id));

  // Rejection-reason modal (design: Figma node 135:371).
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
              {/* Heading + close */}
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between">
                  <h2 className="text-[16px] font-medium tracking-[-0.03em] text-[#09090b]">
                    Why are you rejecting this block?
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
                  Let the creator know what should be updated before approval.
                </p>
              </div>

              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                placeholder="Tell the creator what needs to be improved…"
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

  if (pending.length === 0) {
    return (
      <>
        <div className="rounded-2xl border border-[#e7e9ee] bg-white px-6 py-16 text-center text-sm text-[#71717b] shadow-[0px_1px_2px_rgba(0,0,0,0.04)] h-96 grid place-content-center">
          No designs awaiting review.
        </div>
        {rejectModal}
      </>
    );
  }

  return (
    <>
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
      {hasMore && (
        <div
          ref={sentinelRef}
          className="py-4 text-center text-sm tracking-[-0.03em] text-[#a1a1aa]"
        >
          {loadingMore ? "Loading…" : ""}
        </div>
      )}
      {rejectModal}
    </>
  );
}
