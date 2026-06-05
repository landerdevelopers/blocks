"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const POP_W = 225;

// Asset URLs sourced from Figma (remote, expire ~7 days).
const imgPalette = "https://www.figma.com/api/mcp/asset/40efe4f1-8196-4315-a479-834937cbd0b3";
const imgDashedCircle = "https://www.figma.com/api/mcp/asset/1c1615e2-d955-4371-9dc7-c751bdcb18e1";
const imgPlus = "https://www.figma.com/api/mcp/asset/7b313401-6eb4-4cb5-b3d9-c6347f4d5850";

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export default function ColorSearch({
  onSearch,
  onClear,
}: {
  onSearch?: (colors: string[]) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [hue, setHue] = useState(220);
  const [sat, setSat] = useState(0.6);
  const [val, setVal] = useState(0.9);

  const ref = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Popover opens upward, right-aligned to the bar; portal'd so it can't be
  // clipped by the sidebar's scroll overflow. tip x is measured from the preview.
  const [tipLeft, setTipLeft] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const SHIFT = 10; // nudge the popover right of the bar edge
  const GAP = 0; // vertical offset above the bar (negative nudges it down)

  const hex = hsvToHex(hue, sat, val);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Aim the tip at the active color preview. The popover itself is right-aligned
  // to the bar via CSS (right-0), so only the tip's x-offset needs measuring.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const root = ref.current;
      const pop = popRef.current;
      const anchor = previewRef.current ?? buttonRef.current;
      if (!root || !pop || !anchor) return;
      const rootRect = root.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      // Right-aligned to the bar (+ shift), opening upward above the bar.
      const popLeft = rootRect.right - POP_W + SHIFT;
      const top = rootRect.top - GAP - pop.offsetHeight;
      setCoords({ left: popLeft, top });
      const center = a.left + a.width / 2 - popLeft;
      setTipLeft(Math.max(16, Math.min(POP_W - 16, center)));
    };
    measure();
    // Follow the + button while the preview animates in/out (~300ms) so the
    // tip stays glued to it instead of pointing at its old position.
    let raf = 0;
    let frames = 22;
    const follow = () => {
      measure();
      if (frames-- > 0) raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, colors.length]);

  const dragSquare = (e: React.PointerEvent) => {
    const el = squareRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      setSat(clamp((clientX - r.left) / r.width));
      setVal(1 - clamp((clientY - r.top) / r.height));
    };
    move(e.clientX, e.clientY);
    el.onpointermove = (ev) => ev.buttons && move(ev.clientX, ev.clientY);
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
    };
  };

  const dragHue = (e: React.PointerEvent) => {
    const el = hueRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (clientX: number) => {
      const r = el.getBoundingClientRect();
      setHue(clamp((clientX - r.left) / r.width) * 360);
    };
    move(e.clientX);
    el.onpointermove = (ev) => ev.buttons && move(ev.clientX);
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
    };
  };

  const search = () => {
    // Keep at most 2 colors — drop the oldest when full.
    const next = colors.includes(hex) ? colors : [...colors, hex].slice(-2);
    setColors(next);
    setOpen(false);
    onSearch?.(next);
  };

  return (
    <div
      ref={ref}
      className="relative flex w-full shrink-0 items-center justify-between rounded-full border border-[#e7e9ee] bg-white p-1.5"
    >
      <div className="flex items-center justify-center gap-1 rounded-full bg-[#f5f5f5] py-1.5 pl-1.5 pr-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={imgPalette} className="size-4" />
        <span className="text-sm tracking-[-0.03em] text-[#71717b]">
          Color Search
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Add color toggle — hidden once 2 colors are picked */}
        {colors.length < 2 && (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Add color"
            aria-expanded={open}
            className="relative size-[30px] shrink-0 cursor-pointer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={imgDashedCircle} className="absolute inset-0 size-full" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              src={imgPlus}
              className={`absolute left-1/2 top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 transition-transform duration-200 ${
                open ? "rotate-45" : ""
              }`}
            />
          </button>
        )}

        {/* Selected colors — on the right; hover shows a cross to remove */}
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              const next = colors.filter((x) => x !== c);
              setColors(next);
              // Keep results in sync: re-search the rest, or clear if none left.
              if (next.length === 0) onClear?.();
              else onSearch?.(next);
            }}
            title={`Remove ${c}`}
            className="group relative size-[30px] shrink-0 cursor-pointer rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: c }}
          >
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </span>
          </button>
        ))}

        {/* Live preview of picked color — grows in from the right while picking */}
        <div
          ref={previewRef}
          aria-hidden
          style={{ backgroundColor: hex }}
          className={`shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-black/10 ${
            open
              ? "size-[30px] scale-100 opacity-100 transition-all duration-300 ease-out"
              : "-ml-2.5 size-0 scale-50 opacity-0"
          }`}
        />

      </div>

      {/* Color picker popover — portal'd, fixed, right-aligned, opens upward */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              opacity: coords ? 1 : 0,
            }}
            className="fixed z-[1000] w-[225px] rounded-xl border border-[#e7e9ee] bg-white p-1.5 shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
          >
            {/* Tip pointing down at the active color preview */}
            <div
              aria-hidden
              className="absolute -translate-x-1/2"
              style={{
                left: tipLeft ?? POP_W / 2,
                bottom: -9,
                width: 0,
                height: 0,
                borderLeft: "9px solid transparent",
                borderRight: "9px solid transparent",
                borderTop: "9px solid #e7e9ee",
              }}
            />
            <div
              aria-hidden
              className="absolute -translate-x-1/2"
              style={{
                left: tipLeft ?? POP_W / 2,
                bottom: -8,
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: "8px solid #fff",
              }}
            />
            <div className="flex flex-col gap-1.5">
            {/* Saturation / value square */}
            <div
              ref={squareRef}
              onPointerDown={dragSquare}
              className="relative h-[110px] w-full cursor-crosshair touch-none overflow-hidden rounded-[10px]"
              style={{
                backgroundColor: `hsl(${hue} 100% 50%)`,
                backgroundImage:
                  "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))",
              }}
            >
              <div
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }}
              />
            </div>

            {/* Hue slider */}
            <div
              ref={hueRef}
              onPointerDown={dragHue}
              className="relative h-2.5 w-full cursor-pointer touch-none rounded-full"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
              }}
            >
              <div
                className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
                style={{ left: `${(hue / 360) * 100}%` }}
              />
            </div>
          </div>

          {/* Hex input */}
          <input
            value={hex}
            onChange={(e) => {
              const v = e.target.value;
              // Best-effort: keep field controlled; full hex→hsv parse on valid 6-digit.
              const m = /^#?([0-9a-fA-F]{6})$/.exec(v);
              if (!m) return;
              const int = parseInt(m[1], 16);
              const r = ((int >> 16) & 255) / 255;
              const g = ((int >> 8) & 255) / 255;
              const b = (int & 255) / 255;
              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const d = max - min;
              let h = 0;
              if (d) {
                if (max === r) h = ((g - b) / d) % 6;
                else if (max === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h *= 60;
                if (h < 0) h += 360;
              }
              setHue(h);
              setSat(max ? d / max : 0);
              setVal(max);
            }}
            className="mt-2.5 w-full rounded-[10px] border-[0.5px] border-[#e7e9ee] px-3 py-1.5 text-sm tracking-[-0.03em] text-[#09090b] shadow-[0px_0px_0.55px_rgba(0,0,0,0.25)] outline-none focus:border-[#2974ff]"
          />

          {/* Search button */}
          <button
            type="button"
            onClick={search}
            className="mt-2.5 flex w-full cursor-pointer items-center justify-center rounded-[10px] border-[0.5px] border-[#2974ff] bg-gradient-to-b from-[#2974ff] to-[#0b53d7] px-3 py-1.5 text-sm tracking-[-0.03em] text-white shadow-[0px_2px_4px_0px_rgba(1,1,1,0.15)]"
          >
            Search
          </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

