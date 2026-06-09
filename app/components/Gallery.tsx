"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type GalleryComponent } from "@/store/authStore";
import { readComponentsCache } from "@/lib/componentsCache";
type Component = GalleryComponent;

// Cloudflare Images URLs already have the delivery variant baked in at upload
// time, so just pass them through (no-op for non-Cloudflare URLs).
function cloudflareUrl(url: string): string {
  if (!url || !url.includes("imagedelivery.net")) return url;
  return url;
}

// Sidebar section id -> public.components.category value.
const CAT_MAP: Record<string, string> = {
  website: "Website",
  mobile: "Mobile Apps",
  dashboard: "Dashboard",
  logos: "Logos",
};

const LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

// "Copy to Figma" button spec per layout (column count).
const BTN: Record<
  number,
  {
    w: number;
    h: number;
    cw: number;
    ch: number;
    r: number;
    img: number;
    fs: number;
    gap: string;
    pos: "tr" | "b";
  }
> = {
  1: { w: 230, h: 52, cw: 291, ch: 52, r: 16, img: 32, fs: 24.14, gap: "gap-2.5", pos: "tr" },
  2: { w: 190, h: 45, cw: 240, ch: 44, r: 14, img: 26, fs: 20, gap: "gap-2", pos: "b" },
  3: { w: 155, h: 37, cw: 196, ch: 36, r: 12, img: 22, fs: 16, gap: "gap-2", pos: "b" },
  4: { w: 140, h: 33, cw: 177, ch: 33, r: 10, img: 20, fs: 15, gap: "gap-1.5", pos: "b" },
  5: { w: 126, h: 30, cw: 159, ch: 30, r: 8, img: 18, fs: 14, gap: "gap-1.5", pos: "b" },
  6: { w: 112, h: 28, cw: 142, ch: 28, r: 8, img: 16, fs: 13, gap: "gap-1", pos: "b" },
};

const KBOX: Record<number, { box: number; icon: number }> = {
  1: { box: 40, icon: 20 },
  2: { box: 36, icon: 18 },
  3: { box: 30, icon: 16 },
  4: { box: 28, icon: 15 },
  5: { box: 26, icon: 14 },
  6: { box: 24, icon: 13 },
};

export default function Gallery({
  cols = 3,
  loggedIn,
  onRequireLogin,
  onCopy,
  category = null,
  filters = [],
  colorSearchActive = false,
  colorSearchLoading = false,
  colorSearchResults = null,
}: {
  cols?: number;
  loggedIn: boolean;
  onRequireLogin: () => void;
  onCopy: (componentId: string) => boolean;
  category?: string | null;
  filters?: string[];
  colorSearchActive?: boolean;
  colorSearchLoading?: boolean;
  colorSearchResults?: Component[] | null;
}) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const authLoading = useAuthStore((s) => s.authLoading);
  // Shared list in the store so new uploads appear instantly (no refetch).
  const components = useAuthStore((s) => s.components);
  const componentsLoaded = useAuthStore((s) => s.componentsLoaded);
  const setComponents = useAuthStore((s) => s.setComponents);

  // Seed from a fresh (< 5 min) localStorage cache before the store has data,
  // so a refresh shows components instantly with no skeletons.
  useEffect(() => {
    if (componentsLoaded) return;
    const cached = readComponentsCache();
    if (cached) setComponents(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always background-refetch; update the store/cache only when data changed.
  useEffect(() => {
    let alive = true;
    createClient()
      .from("components")
      .select("id, category, section, filters, figma_url, preview_url, aspect_ratio")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!alive) return;
        const fresh = (data as Component[]) ?? [];
        const current = useAuthStore.getState().components;
        if (JSON.stringify(current) !== JSON.stringify(fresh)) {
          setComponents(fresh);
        } else if (!useAuthStore.getState().componentsLoaded) {
          // Same data but not yet flagged loaded (no cache existed).
          setComponents(fresh);
        }
      });
    return () => {
      alive = false;
    };
  }, [setComponents]);

  // Preload the copied-state icon so the figma→tick swap doesn't flash/break.
  useEffect(() => {
    const img = new Image();
    img.src = "/Tick.png";
  }, []);

  const dbCategory = category ? CAT_MAP[category] : null;
  const isLogos = dbCategory === "Logos";

  // Apply category + filter selection.
  const filtered = useMemo(() => {
    return components.filter((c) => {
      if (dbCategory && c.category !== dbCategory) return false;
      if (filters.length) {
        if (dbCategory === "Logos") {
          // Letters are a union — show a component matching any selected letter.
          if (!filters.some((f) => (c.filters ?? []).includes(f))) return false;
        } else {
          // Two groups, AND'd together. Tags (no prefix) match the section and
          // are a union among themselves. Themes ("style:" prefix) narrow the
          // result, also a union. Pick "Hero", "Bento" + "Dark" → section is
          // Hero OR Bento, AND a Dark theme.
          const tags = filters.filter((f) => !f.startsWith("style:"));
          const themes = filters
            .filter((f) => f.startsWith("style:"))
            .map((f) => f.slice("style:".length));
          if (tags.length && !tags.includes(c.section ?? "")) return false;
          if (
            themes.length &&
            !themes.some((t) => (c.filters ?? []).includes(t))
          )
            return false;
        }
      }
      return true;
    });
  }, [components, dbCategory, filters]);

  const cfg = BTN[Math.min(6, Math.max(1, cols))] ?? BTN[3];

  // Hover overlay behind the copy button. The 1-col layout shows the button at
  // the top, every other layout at the bottom — so flip the gradient to match.
  const overlayCls = `pointer-events-none absolute inset-x-0 z-5 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${
    cfg.pos === "tr"
      ? "top-0 bg-linear-to-b from-black/70 to-transparent"
      : "bottom-0 bg-linear-to-t from-black/70 to-transparent"
  }`;

  // `cols` derives from localStorage on the client, so the grid's column count
  // differs from the SSR default. Render only after mount to avoid a hydration
  // mismatch on the bucket/column structure.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [copied, setCopied] = useState<string | null>(null);
  // Ids whose preview image has finished loading — drives the placeholder fade.
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const markLoaded = (id: string) =>
    setLoadedIds((prev) => new Set(prev).add(id));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markCopied = (key: string) => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
  };
  const resetAfterLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 320);
  };

  // Lightbox.
  const [lightbox, setLightbox] = useState<
    { src: string; logo: boolean } | null
  >(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Admin pencil — opens the edit page in a new tab. Slides in from the top.
  const adminPencil = (id: string, dark = false) => {
    if (!isAdmin) return null;
    const k = KBOX[Math.min(6, Math.max(1, cols))] ?? KBOX[3];
    const side = cols === 1 ? "left-5" : "right-3";
    const top = cols === 1 ? "top-5" : "top-3";
    return (
      <button
        type="button"
        aria-label="Edit component"
        onClick={(e) => {
          e.stopPropagation();
          window.open(`/upload/${id}/edit`, "_blank");
        }}
        style={{ width: k.box, height: k.box }}
        className={`absolute ${top} ${side} z-30 flex cursor-pointer items-center justify-center rounded-full border opacity-0 shadow-[0px_2px_6px_rgba(0,0,0,0.15)] transition-[opacity,translate] duration-300 ease-out -translate-y-[calc(100%+0.75rem)] pointer-events-none group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 ${
          dark ? "border-black bg-black text-white" : "border-[#e7e9ee] bg-white text-[#52525b]"
        }`}
      >
        <Pencil size={k.icon} strokeWidth={2} />
      </button>
    );
  };

  // Copy button — shared by both views; `dark` for the logo cards. Two stacked
  // pills anchored at the same spot: on copy the "Copy to Figma" pill slides
  // down + fades out while the "Copied!" pill rises up into its place.
  const copyButton = (id: string, dark: boolean, figmaUrl: string | null) => {
    const isCopied = copied === id;
    const onClick = async (e: MouseEvent) => {
      e.stopPropagation(); // don't trigger the image lightbox
      if (authLoading) return; // wait for the session to resolve
      if (!loggedIn) return onRequireLogin();
      if (!onCopy(id)) return;
      if (figmaUrl) {
        try {
          await navigator.clipboard.writeText(figmaUrl);
        } catch {
          // clipboard may be blocked; still show the copied state
        }
      }
      markCopied(id);
    };

    const pill =
      "flex items-center justify-center whitespace-nowrap border font-medium tracking-[-0.03em] shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-300 ease-out";

    return (
      // Wrapper: positioned per layout + slides in on card hover.
      <div
        className={`pointer-events-none absolute z-10 opacity-0 transition-[opacity,translate] duration-300 ease-out group-hover:opacity-100 ${
          cfg.pos === "tr"
            ? "right-6 top-6 -translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
            : "bottom-6 left-1/2 -translate-x-1/2 translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
        }`}
      >
        <div className="relative">
          {/* Copy pill — in flow, sizes the wrapper. Slides down + out on copy. */}
          <button
            type="button"
            onClick={onClick}
            style={{
              width: cfg.w,
              height: cfg.h,
              borderRadius: cfg.r,
              fontSize: cfg.fs,
              transform: isCopied ? "translateY(14px)" : "translateY(0)",
              opacity: isCopied ? 0 : undefined,
            }}
            className={`${pill} ${cfg.gap} cursor-pointer hover:opacity-90 ${
              isCopied ? "pointer-events-none" : "group-hover:pointer-events-auto"
            } ${dark ? "border-black bg-black text-white" : "border-[#e7e9ee] bg-white text-[#09090b]"}`}
          >
            {authLoading ? (
              <>
                <span
                  className="animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
                  style={{ width: cfg.img, height: cfg.img }}
                />
                Loading…
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" src="/figma.png" style={{ width: cfg.img, height: cfg.img }} />
                Copy to Figma
              </>
            )}
          </button>

          {/* Copied pill — absolutely centered over the copy pill. Rises up + in. */}
          <div
            aria-hidden={!isCopied}
            style={{
              width: cfg.cw,
              height: cfg.ch,
              borderRadius: cfg.r,
              fontSize: cfg.fs,
              backgroundColor: "#deffd7",
              color: "#1C9A00",
              borderColor: "#BAFFAA",
              top: "50%",
              left: "50%",
              transform: `translate(-50%, ${isCopied ? "-50%" : "calc(-50% + 14px)"})`,
              opacity: isCopied ? 1 : 0,
            }}
            className={`${pill} ${cfg.gap} pointer-events-none absolute`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/Tick.png" style={{ width: cfg.img, height: cfg.img }} />
            {cols >= 5 ? "Copied!" : "Copied Successfully!"}
          </div>
        </div>
      </div>
    );
  };

  const renderLightbox = () =>
    lightbox && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative inline-block"
            >
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
              {lightbox.logo ? (
                // Fixed square box so every logo opens at the same size (no
                // per-logo sizing or blank-then-resize jump).
                <div className="flex size-[min(90vw,520px)] items-center justify-center rounded-xl bg-white p-16 shadow-[0px_12px_40px_rgba(0,0,0,0.4)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={lightbox.src} className="size-full object-contain" />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={lightbox.src}
                  className="block max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-[0px_12px_40px_rgba(0,0,0,0.4)]"
                />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  // Reusable masonry grid for a given component list.
  const renderGrid = (list: Component[]) => {
    const buckets: Component[][] = Array.from(
      { length: Math.max(1, cols) },
      () => [],
    );
    list.forEach((c, i) => buckets[i % buckets.length].push(c));
    return (
      <main suppressHydrationWarning className="flex h-full flex-1 items-start gap-3.5 overflow-y-auto rounded-tl-[22px] bg-white p-4">
        {buckets.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-3.5">
            {col.map((c, j) => (
              <div
                key={c.id}
                onMouseLeave={resetAfterLeave}
                className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
              >
                {adminPencil(c.id)}
                <div className="relative w-full overflow-hidden rounded-md">
                  <div
                    onClick={() =>
                      c.preview_url &&
                      setLightbox({ src: c.preview_url, logo: false })
                    }
                    className="relative w-full cursor-zoom-in overflow-hidden rounded-md border border-[#e7e9ee]"
                  >
                    <div
                      className={`relative w-full overflow-hidden rounded-md bg-[#e4e4e7] ${
                        loadedIds.has(c.id) ? "" : "animate-pulse"
                      }`}
                      style={{
                        paddingBottom: c.aspect_ratio
                          ? `${(1 / c.aspect_ratio) * 100}%`
                          : "75%",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        src={cloudflareUrl(c.preview_url ?? "")}
                        loading={j === 0 ? "eager" : "lazy"}
                        onLoad={() => markLoaded(c.id)}
                        className={`absolute inset-0 h-full w-full rounded-md object-cover transition-opacity duration-500 ${
                          loadedIds.has(c.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    </div>
                    <span className={overlayCls} />
                  </div>
                  {copyButton(c.id, false, c.figma_url)}
                </div>
              </div>
            ))}
          </div>
        ))}
        {renderLightbox()}
      </main>
    );
  };

  // Before mount, render an empty (but identically-classed) main so SSR and the
  // first client render match — the real grid depends on the client-only `cols`.
  if (!mounted) {
    return (
      <main
        suppressHydrationWarning
        className="flex h-full flex-1 items-start gap-3.5 overflow-y-auto rounded-tl-[22px] bg-white p-4"
      />
    );
  }

  // Color search overrides the normal list while active.
  if (colorSearchActive) {
    if (colorSearchLoading) {
      return (
        <main className="flex h-full flex-1 items-center justify-center rounded-tl-[22px] bg-white p-4">
          <div className="size-8 animate-spin rounded-full border-2 border-[#e4e4e7] border-t-[#2974ff]" />
        </main>
      );
    }
    const results = colorSearchResults ?? [];
    if (results.length === 0) {
      return (
        <main className="flex h-full flex-1 items-center justify-center rounded-tl-[22px] bg-white p-4">
          <div className="flex max-w-md flex-col items-center gap-0 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/NoColor.png" className="size-65 object-contain" />
            <p className="-mt-3 text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
              No blocks found for this color
            </p>
          </div>
        </main>
      );
    }
    return renderGrid(results);
  }

  const empty = componentsLoaded && filtered.length === 0;

  if (empty) {
    return (
      <main className="flex h-full flex-1 items-center justify-center rounded-tl-[22px] bg-white p-4">
        <div className="flex max-w-md flex-col items-center gap-0 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src="/NoColor.png" className="size-65 object-contain" />
          <p className="-mt-3 text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
            No blocks match the selected filter
          </p>
        </div>
        {renderLightbox()}
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Logos view — group components by letter (from their filters).
  // ---------------------------------------------------------------------------
  if (isLogos) {
    const n = Math.min(6, Math.max(1, cols));
    const groups: { letter: string; items: Component[] }[] = [];
    [...LETTERS, "Others"].forEach((letter) => {
      const items = filtered.filter((c) => (c.filters ?? []).includes(letter));
      if (items.length) groups.push({ letter, items });
    });

    return (
      <main suppressHydrationWarning className="flex h-full flex-1 flex-col gap-6 overflow-y-auto rounded-tl-[22px] bg-white p-4">
        {groups.map(({ letter, items }) => (
          <section key={letter} className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <h2 className="whitespace-nowrap text-sm tracking-[-0.03em] text-black">
                {letter === "Others" ? "Others" : `Letter ${letter}`}
              </h2>
              <div className="h-0.5 flex-1 rounded-full bg-[#E4E4E7]" />
            </div>
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            >
              {items.map((c, idx) => (
                <div
                  key={c.id}
                  onMouseLeave={resetAfterLeave}
                  className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
                >
                  {adminPencil(c.id, true)}
                  <div className="relative w-full overflow-hidden rounded-md">
                    <div
                      onClick={() =>
                        c.preview_url &&
                        setLightbox({ src: c.preview_url, logo: true })
                      }
                      className="relative flex w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md border border-[#e7e9ee] bg-white"
                      style={{
                        aspectRatio:
                          n >= 6 ? "3 / 4" : n >= 5 ? "4 / 5" : n >= 3 ? "1 / 1" : "5 / 4",
                        padding:
                          n >= 6 ? 16 : n >= 5 ? 24 : n >= 4 ? 32 : n >= 3 ? 48 : 72,
                      }}
                    >
                      {/* Placeholder fills the whole card (ignores padding). */}
                      {!loadedIds.has(c.id) && (
                        <span className="absolute inset-0 animate-pulse bg-[#e4e4e7]" />
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        src={cloudflareUrl(c.preview_url ?? "")}
                        loading={idx < n ? "eager" : "lazy"}
                        onLoad={() => markLoaded(c.id)}
                        className={`size-full object-contain transition-opacity duration-500 ${
                          loadedIds.has(c.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                    </div>
                    {copyButton(c.id, true, c.figma_url)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {renderLightbox()}
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Masonry grid — distribute components across `cols` columns.
  // ---------------------------------------------------------------------------
  const buckets: Component[][] = Array.from({ length: Math.max(1, cols) }, () => []);
  filtered.forEach((c, i) => buckets[i % buckets.length].push(c));

  return (
    <main suppressHydrationWarning className="flex h-full flex-1 items-start gap-3.5 overflow-y-auto rounded-tl-[22px] bg-white p-4">
      {buckets.map((col, i) => (
        <div key={i} className="flex flex-1 flex-col gap-3.5">
          {col.map((c, j) => (
            <div
              key={c.id}
              onMouseLeave={resetAfterLeave}
              className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
            >
              {adminPencil(c.id)}
              <div className="relative w-full overflow-hidden rounded-md">
                <div
                  onClick={() =>
                    c.preview_url &&
                    setLightbox({ src: c.preview_url, logo: false })
                  }
                  className="relative w-full cursor-zoom-in overflow-hidden rounded-md border border-[#e7e9ee]"
                >
                  <div
                    className={`relative w-full overflow-hidden rounded-md bg-[#e4e4e7] ${
                      loadedIds.has(c.id) ? "" : "animate-pulse"
                    }`}
                    style={{
                      paddingBottom: c.aspect_ratio
                        ? `${(1 / c.aspect_ratio) * 100}%`
                        : "75%",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={cloudflareUrl(c.preview_url ?? "")}
                      loading={j === 0 ? "eager" : "lazy"}
                      onLoad={() => markLoaded(c.id)}
                      className={`absolute inset-0 h-full w-full rounded-md object-cover transition-opacity duration-500 ${
                        loadedIds.has(c.id) ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </div>
                  <span className={overlayCls} />
                </div>
                {copyButton(c.id, false, c.figma_url)}
              </div>
            </div>
          ))}
        </div>
      ))}

      {renderLightbox()}
    </main>
  );
}
