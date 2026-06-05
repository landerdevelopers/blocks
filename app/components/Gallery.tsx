"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Asset URLs sourced from Figma (remote, expire ~7 days).
const imgIhp1 = "https://www.figma.com/api/mcp/asset/cd937ef7-62cf-4bcc-86fa-d70576a2aa85";
const imgIhp2 = "https://www.figma.com/api/mcp/asset/cca8a4cb-e6c5-42fb-afcc-a2f3f6bae393";
const imgIhp3 = "https://www.figma.com/api/mcp/asset/a3e0d998-ee9b-4bff-8190-4b8b6dd650b8";
const imgIhp4 = "https://www.figma.com/api/mcp/asset/b1448205-9e74-4dd8-b3da-6d3a0e713e14";
const imgHeYy = "https://www.figma.com/api/mcp/asset/77d4d2f6-1c3b-4f94-bf41-8f4c2af23c5f";
const imgNZao = "https://www.figma.com/api/mcp/asset/a409967f-010c-495c-8513-336355bd2eaf";
const imgZcb = "https://www.figma.com/api/mcp/asset/c7807711-063b-46c3-85d2-f0f2cb5c1809";
const imgJIa = "https://www.figma.com/api/mcp/asset/5b925670-b949-4dcc-8705-90bca4719e83";
const imgCNb = "https://www.figma.com/api/mcp/asset/88ca585a-b2f0-47da-aed8-ab7cf6aa1c4a";
const imgGSa = "https://www.figma.com/api/mcp/asset/e3b149ca-8a57-4005-8a26-4a14fb92b84e";
const imgGIa = "https://www.figma.com/api/mcp/asset/c20c6e63-5930-4107-bfe1-7bf7c48c6b8a";
const imgGwb = "https://www.figma.com/api/mcp/asset/782f9e86-c9ea-41f8-9874-459d559e1f03";

const columns: { src: string; aspect: string }[][] = [
  [
    { src: imgIhp1, aspect: "2880 / 1818" },
    { src: imgIhp2, aspect: "2880 / 1818" },
    { src: imgIhp3, aspect: "2880 / 1818" },
    { src: imgIhp4, aspect: "2880 / 1818" },
  ],
  [
    { src: imgHeYy, aspect: "4096 / 2355" },
    { src: imgNZao, aspect: "1280 / 860" },
    { src: imgZcb, aspect: "2560 / 1820" },
    { src: imgJIa, aspect: "1200 / 799" },
  ],
  [
    { src: imgCNb, aspect: "1280 / 800" },
    { src: imgGSa, aspect: "2160 / 1326" },
    { src: imgGIa, aspect: "2160 / 1350" },
    { src: imgGwb, aspect: "2160 / 1497" },
  ],
];

const LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

// "Copy to Figma" button spec per layout (column count). 1 sits top-right; the rest slide up from middle-bottom.
// w/h = "Copy to Figma" size, cw/ch = "Copied Successfully!" size (wider).
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

export default function Gallery({
  cols = 3,
  loggedIn,
  onRequireLogin,
  onCopy,
  logos = false,
  logoFilter = [],
}: {
  cols?: number;
  loggedIn: boolean;
  onRequireLogin: () => void;
  onCopy: () => boolean;
  logos?: boolean;
  logoFilter?: string[];
}) {
  // Redistribute every image across `cols` columns (round-robin keeps them balanced).
  const all = columns.flat();
  const buckets: { src: string; aspect: string }[][] = Array.from(
    { length: Math.max(1, cols) },
    () => [],
  );
  all.forEach((img, i) => buckets[i % buckets.length].push(img));

  const cfg = BTN[Math.min(6, Math.max(1, cols))] ?? BTN[3];

  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markCopied = (key: string) => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
  };
  // Reset to "Copy to Figma" only after the button has faded out, so size never snaps while visible.
  const resetAfterLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 320);
  };

  // Lightbox — click an image to view it large. `logo` → render on a white card.
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
              {/* Close — black glassy, white icon; pinned to the image corner */}
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                src={lightbox.src}
                className={`block max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-[0px_12px_40px_rgba(0,0,0,0.4)] ${
                  lightbox.logo ? "bg-white p-16" : ""
                }`}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  // Logos view — letter sections, each a grid of logo marks.
  if (logos) {
    const n = Math.min(6, Math.max(1, cols));
    // No filter → all letters; picked letters → just those sections.
    const shown = logoFilter.length
      ? LETTERS.filter((l) => logoFilter.includes(l))
      : LETTERS;
    return (
      <main className="flex h-full flex-1 flex-col gap-6 overflow-y-auto rounded-tl-[22px] bg-white p-4">
        {shown.map((letter) => (
          <section key={letter} className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <h2 className="whitespace-nowrap text-sm tracking-[-0.03em] text-black">
                Letter {letter}
              </h2>
              <div className="h-0.5 flex-1 rounded-full bg-[#E4E4E7]" />
            </div>
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: n }).map((_, i) => {
                const lkey = `logo-${letter}-${i}`;
                const isCopied = copied === lkey;
                return (
                <div
                  key={i}
                  onMouseLeave={resetAfterLeave}
                  className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
                >
                  <div
                    onClick={() => setLightbox({ src: "/temp.png", logo: true })}
                    className="flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-[#e7e9ee] bg-white"
                    style={{
                      // Taller, narrower cards — more so as columns grow.
                      aspectRatio:
                        n >= 6 ? "3 / 4" : n >= 5 ? "4 / 5" : n >= 3 ? "1 / 1" : "5 / 4",
                      // Less padding as columns grow, so the mark stays large.
                      padding:
                        n >= 6 ? 16 : n >= 5 ? 24 : n >= 4 ? 32 : n >= 3 ? 48 : 72,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src="/temp.png"
                      className="size-full object-contain"
                    />
                  </div>

                  {/* Copy to Figma — black variant for logos */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!loggedIn) return onRequireLogin();
                      if (onCopy()) markCopied(lkey);
                    }}
                    style={{
                      width: isCopied ? cfg.cw : cfg.w,
                      height: isCopied ? cfg.ch : cfg.h,
                      borderRadius: cfg.r,
                      fontSize: cfg.fs,
                      ...(isCopied
                        ? { backgroundColor: "#deffd7", color: "#1C9A00", borderColor: "#BAFFAA" }
                        : {}),
                    }}
                    className={`pointer-events-none absolute z-10 flex items-center justify-center whitespace-nowrap border border-black bg-black font-medium tracking-[-0.03em] text-white opacity-0 shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,translate] duration-300 ease-out group-hover:pointer-events-auto group-hover:opacity-100 ${cfg.gap} ${
                      cfg.pos === "tr"
                        ? "right-6 top-6 -translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
                        : "bottom-4 left-1/2 -translate-x-1/2 translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={isCopied ? "/Tick.png" : "/figma.png"}
                      style={{ width: cfg.img, height: cfg.img }}
                    />
                    {isCopied ? "Copied Successfully!" : "Copy to Figma"}
                  </button>
                </div>
                );
              })}
            </div>
          </section>
        ))}
        {renderLightbox()}
      </main>
    );
  }

  return (
    <main className="flex h-full flex-1 items-start gap-3.5 overflow-y-auto rounded-tl-[22px] bg-white p-4">
      {buckets.map((col, i) => (
        <div key={i} className="flex flex-1 flex-col gap-3.5">
          {col.map((img, j) => {
            const key = `${i}-${j}`;
            const isCopied = copied === key;
            return (
            <div
              key={j}
              onMouseLeave={resetAfterLeave}
              className="group relative flex w-full items-end justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f5f5] p-1.5 drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
            >
              <div
                onClick={() => setLightbox({ src: img.src, logo: false })}
                className="w-full cursor-pointer overflow-hidden rounded-md border border-[#e7e9ee]"
                style={{ aspectRatio: img.aspect }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  src={img.src}
                  className="size-full rounded-md object-cover"
                />
              </div>

              {/* Copy to Figma — appears on hover; turns into a success state on click */}
              <button
                type="button"
                onClick={() => {
                  if (!loggedIn) return onRequireLogin();
                  if (onCopy()) markCopied(key);
                }}
                style={{
                  width: isCopied ? cfg.cw : cfg.w,
                  height: isCopied ? cfg.ch : cfg.h,
                  borderRadius: cfg.r,
                  fontSize: cfg.fs,
                  ...(isCopied
                    ? { backgroundColor: "#deffd7", color: "#1C9A00", borderColor: "#BAFFAA" }
                    : {}),
                }}
                className={`pointer-events-none absolute z-10 flex items-center justify-center whitespace-nowrap border border-[#e7e9ee] bg-white font-medium tracking-[-0.03em] text-[#09090b] opacity-0 shadow-[0px_4px_12px_rgba(0,0,0,0.12)] transition-[opacity,translate] duration-300 ease-out group-hover:pointer-events-auto group-hover:opacity-100 ${cfg.gap} ${
                  cfg.pos === "tr"
                    ? "right-6 top-6 -translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
                    : "bottom-6 left-1/2 -translate-x-1/2 translate-y-[calc(100%+1.5rem)] group-hover:translate-y-0"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  src={isCopied ? "/Tick.png" : "/figma.png"}
                  style={{ width: cfg.img, height: cfg.img }}
                />
                {isCopied ? "Copied Successfully!" : "Copy to Figma"}
              </button>
            </div>
            );
          })}
        </div>
      ))}

      {/* Lightbox */}
      {renderLightbox()}
    </main>
  );
}
