"use client";

import { useEffect, useRef, useState } from "react";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

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

function hexToHsv(hex: string): [number, number, number] | null {
  const mm = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!mm) return null;
  const int = parseInt(mm[1], 16);
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
  return [h, max ? d / max : 0, max];
}

const CATEGORIES = ["Web", "Mobile", "Dashboard", "Logo"] as const;
type Category = (typeof CATEGORIES)[number];

const LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

// Per-category sections (single select) and filters (multi select).
const CONFIG: Record<Category, { sections: string[]; filters: string[] }> = {
  Web: {
    sections: [
      "Hero",
      "Bento",
      "Social Proof",
      "Features",
      "Process",
      "Pricing",
      "Footer",
      "Others",
    ],
    filters: [
      "Light",
      "Dark",
      "Colorful",
      "Minimal",
      "Gradient",
      "Futuristic",
      "Enterprise",
      "Isometric",
    ],
  },
  Mobile: {
    sections: ["Onboarding", "Features"],
    filters: ["Light", "Dark", "Minimal", "Colorful", "Gradient"],
  },
  Dashboard: {
    sections: [],
    filters: ["Light", "Dark", "Others"],
  },
  Logo: {
    sections: [],
    filters: [...LETTERS, "Others"],
  },
};

// weight === null → auto (shares the remaining % evenly with other auto colors).
// weight === number → locked to that value by the user.
type ColorWeight = { hex: string; weight: number | null };

// Resolve every color to a concrete %: locked keep theirs, the rest split the
// leftover evenly (last auto absorbs the rounding remainder so the total is 100).
function resolveWeights(colors: ColorWeight[]): number[] {
  const lockedTotal = colors.reduce((s, c) => s + (c.weight ?? 0), 0);
  const autoIdx = colors
    .map((c, i) => (c.weight === null ? i : -1))
    .filter((i) => i >= 0);
  const remaining = Math.max(0, 100 - lockedTotal);
  const each = autoIdx.length ? Math.floor(remaining / autoIdx.length) : 0;

  const out = colors.map((c) => c.weight ?? 0);
  autoIdx.forEach((i, k) => {
    // Last auto color takes whatever's left so the autos sum to `remaining`.
    out[i] = k === autoIdx.length - 1 ? remaining - each * (autoIdx.length - 1) : each;
  });
  return out;
}

// Small label above a group of controls.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-[#71717b]">
      {children}
    </p>
  );
}

// Pill chip — shared by section (single) and theme (multi) selectors.
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center rounded-full border px-[14px] py-[5px] text-[12px] tracking-[-0.03em] transition-colors ${
        active
          ? "border-[#09090b] bg-[#09090b] text-white"
          : "border-[#e4e4e7] bg-transparent text-[#71717b] shadow-[0px_0px_0.5px_0px_rgba(0,0,0,0.25)] hover:bg-[#fafafa]"
      }`}
    >
      {label}
    </button>
  );
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState<Category>("Web");
  const [section, setSection] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<string>>(() => new Set());
  const [colors, setColors] = useState<ColorWeight[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [figma, setFigma] = useState("");
  const [figmaEditing, setFigmaEditing] = useState(false);
  const [figmaCopied, setFigmaCopied] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const figmaInputRef = useRef<HTMLInputElement>(null);

  const openFigmaInput = () => {
    setFigmaEditing(true);
    // Focus after the input mounts.
    requestAnimationFrame(() => figmaInputRef.current?.focus());
  };

  // Blur commits: keep the two-button view if text exists, else back to default.
  const commitFigma = () => setFigmaEditing(false);

  const copyFigma = () => {
    navigator.clipboard?.writeText(figma);
    setFigmaCopied(true);
    setTimeout(() => setFigmaCopied(false), 1500);
  };

  const { sections, filters: filterOpts } = CONFIG[category];
  // Filters: multi-select for Web/Mobile, single-select for Dashboard/Logo.
  const multiFilter = category === "Web" || category === "Mobile";

  // Everything required except colors: image, figma link, a section (when the
  // category has any), and at least one filter.
  const canUpload =
    !!file &&
    !!figma &&
    (sections.length === 0 || section !== null) &&
    filters.size > 0;

  // Switching category resets section + filters (the options differ per category).
  const changeCategory = (c: Category) => {
    setCategory(c);
    setSection(null);
    setFilters(new Set());
  };

  // Clear the whole form back to its initial state for another upload.
  const reset = () => {
    setFile(null);
    setCategory("Web");
    setSection(null);
    setFilters(new Set());
    setColors([]);
    setFigma("");
    setFigmaEditing(false);
    setUploaded(false);
  };

  // New colors start as auto (null) → resolveWeights redistributes evenly.
  const addColor = (hex: string) => {
    setColors((prev) =>
      prev.some((c) => c.hex === hex) ? prev : [...prev, { hex, weight: null }],
    );
    setPickerOpen(false);
  };

  const removeColor = (hex: string) =>
    setColors((prev) => prev.filter((c) => c.hex !== hex));

  // Locking a color's % — clamps 0–100; the rest stay auto and absorb the rest.
  const setWeight = (hex: string, value: number) =>
    setColors((prev) =>
      prev.map((c) =>
        c.hex === hex
          ? { ...c, weight: Math.max(0, Math.min(100, value)) }
          : c,
      ),
    );

  const weights = resolveWeights(colors);
  const total = weights.reduce((sum, w) => sum + w, 0);

  const toggleFilter = (f: string) =>
    setFilters((prev) => {
      if (prev.has(f)) return new Set([...prev].filter((x) => x !== f));
      // Single-select categories keep only the newly picked filter.
      return multiFilter ? new Set(prev).add(f) : new Set([f]);
    });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  if (uploaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
        <div className="flex w-full max-w-[628px] flex-col items-center gap-4 rounded-2xl border border-[#e7e9ee] bg-[#f9fafa] p-10 text-center shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#dcfce7] text-[#16a34a]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
              Uploaded Successfully
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              Your component has been uploaded.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="mt-2 flex items-center justify-center rounded-xl bg-[#09090b] px-5 py-2.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
          >
            Upload Another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
      <div className="w-full max-w-[628px] rounded-2xl border border-[#e7e9ee] bg-[#f9fafa] p-6 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
            Upload New Component
          </h1>
          <p className="text-sm tracking-[-0.03em] text-[#71717b]">
            Customize layout assets, Figma data, and color weights.
          </p>
        </div>

        {/* Upload Image */}
        <div className="mt-6 flex flex-col gap-2">
          <FieldLabel>Upload Image</FieldLabel>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-9 transition-colors ${
              dragOver
                ? "border-[#2974ff] bg-[#f4f8ff]"
                : "border-[#d4d4d8] bg-[#fafafa] hover:bg-[#f5f5f5]"
            }`}
          >
            <UploadIcon />
            <span className="text-sm tracking-[-0.03em] text-[#52525b]">
              {file ? file.name : "Click to upload or drag & drop"}
            </span>
            <span className="text-xs tracking-[-0.03em] text-[#a1a1aa]">
              PNG, JPG, WebP up to 10MB
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Paste Figma */}
        <div className="mt-5 flex flex-col gap-2">
          <FieldLabel>Paste Figma</FieldLabel>
          <div className="flex w-full items-center gap-1 rounded-lg border border-[#e4e4e7] bg-white px-[7px] py-1.5">
            {figmaEditing ? (
              // Input — paste a link, blur to commit.
              <input
                ref={figmaInputRef}
                value={figma}
                onChange={(e) => setFigma(e.target.value)}
                onBlur={commitFigma}
                onKeyDown={(e) => e.key === "Enter" && commitFigma()}
                placeholder="Paste Figma section link…"
                className="flex-1 rounded-md border border-transparent px-3 py-1.5 text-sm tracking-[-0.03em] text-[#09090b] outline-none placeholder:text-[#a1a1aa]"
              />
            ) : figma ? (
              // Committed — Paste Again (left) + Copy Pasted Text (right).
              <>
                <button
                  type="button"
                  onClick={openFigmaInput}
                  className="flex cursor-pointer items-center gap-2 rounded-[7px] border border-[#09090b] bg-[#09090b] px-2 py-1.5 text-sm tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
                >
                  <ClipboardIcon />
                  Paste Again
                </button>
                <button
                  type="button"
                  onClick={copyFigma}
                  className="ml-auto flex cursor-pointer items-center gap-2 rounded-[7px] border border-[#e4e4e7] px-2 py-1.5 text-sm tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
                >
                  <CopyIcon />
                  {figmaCopied ? "Copied!" : "Copy Pasted Text"}
                </button>
              </>
            ) : (
              // Default — click to open the input.
              <button
                type="button"
                onClick={openFigmaInput}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-sm tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
              >
                <ClipboardIcon />
                Paste Figma Section
              </button>
            )}
          </div>
          <p className="text-[11px] tracking-[-0.03em] text-[#a1a1aa]">
            {figma
              ? "Figma content pasted. Use Paste Again to replace it."
              : "No Figma content pasted yet. Click the button to paste from clipboard."}
          </p>
        </div>

        {/* Categories */}
        <div className="mt-5 flex flex-col gap-2">
          <FieldLabel>Categories</FieldLabel>
          <div className="flex w-full items-center gap-1 rounded-lg border border-[#e4e4e7] p-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => changeCategory(c)}
                className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm tracking-[-0.03em] transition-colors ${
                  category === c
                    ? "bg-[#eaeaea] font-medium text-[#09090b] shadow-[0px_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-[#71717b] hover:text-[#09090b]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Select Section — single select (only categories that have sections) */}
        {sections.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            <FieldLabel>Select Section (single select)</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={section === s}
                  onClick={() => setSection(section === s ? null : s)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Select Filter — multi select */}
        <div className="mt-4 flex flex-col gap-2">
          <FieldLabel>
            Select {category === "Logo" ? "Letter" : "Theme"}
            {multiFilter ? " (multi select)" : ""}
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            {filterOpts.map((f) => (
              <Chip
                key={f}
                label={f}
                active={filters.has(f)}
                onClick={() => toggleFilter(f)}
              />
            ))}
          </div>
        </div>

        {/* Select Colors */}
        <div className="mt-6 flex flex-col gap-2.5">
          {/* Header + bar + rows only once at least one color is picked. */}
          {colors.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <FieldLabel>Select Colors</FieldLabel>
                <span className="text-xs tracking-[-0.03em] text-[#71717b]">
                  Total: {total}%
                </span>
              </div>

              {/* Weighted gradient bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#efeff0]">
                {colors.map((c, i) => (
                  <div
                    key={c.hex}
                    style={{ flex: weights[i], backgroundColor: c.hex }}
                  />
                ))}
              </div>

              {/* Color rows */}
              <div className="flex flex-col gap-2.5">
                {colors.map((c, i) => (
                  <div
                    key={c.hex}
                    className="flex items-center justify-between rounded-xl border border-[#e7e9ee] bg-white px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="size-4 rounded-md ring-1 ring-inset ring-black/10"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-sm tracking-[-0.03em] text-[#71717B]">
                        {c.hex}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center rounded-md bg-[#f4f4f5] px-2 py-0.5 text-xs tracking-[-0.03em] text-[#52525b]">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={weights[i]}
                          onChange={(e) =>
                            setWeight(c.hex, Number(e.target.value))
                          }
                          className="w-5 text-center bg-transparent tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        %
                      </label>
                      <button
                        type="button"
                        onClick={() => removeColor(c.hex)}
                        aria-label={`Remove ${c.hex}`}
                        className="cursor-pointer text-[#a1a1aa] transition-colors hover:text-[#ef4444]"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Add More Colors — opens the color picker popover */}
          <div className="relative mt-1">
            {pickerOpen && (
              <ColorPicker
                onAdd={addColor}
                onClose={() => setPickerOpen(false)}
              />
            )}
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#d4d4d8] px-4 py-3.5 text-sm tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
            >
              Add Colors
              <PlusIcon />
            </button>
          </div>
        </div>

        {/* Upload — enabled once every required field is filled */}
        <button
          type="button"
          disabled={!canUpload}
          onClick={() => setUploaded(true)}
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#09090b] px-4 py-3 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#09090b]"
        >
          Upload Component
        </button>
      </div>
    </main>
  );
}

// Color picker popover — SV square, hue slider, hex input, Add button.
// Floats above its anchor with a downward tip.
function ColorPicker({
  onAdd,
  onClose,
}: {
  onAdd: (hex: string) => void;
  onClose: () => void;
}) {
  const [hue, setHue] = useState(28);
  const [sat, setSat] = useState(0.24);
  const [val, setVal] = useState(0.66);

  const ref = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const hex = hsvToHex(hue, sat, val);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 z-50 mb-3 w-[300px] -translate-x-1/2 rounded-2xl border border-[#e7e9ee] bg-white p-3 shadow-[0px_12px_32px_rgba(0,0,0,0.16)]"
    >
      {/* Downward tip */}
      <div
        aria-hidden
        className="absolute left-1/2 -bottom-2 size-4 -translate-x-1/2 rotate-45 rounded-br-[3px] border-b border-r border-[#e7e9ee] bg-white"
      />

      <div className="flex flex-col gap-2.5">
        {/* Saturation / value square */}
        <div
          ref={squareRef}
          onPointerDown={dragSquare}
          className="relative h-[150px] w-full cursor-crosshair touch-none overflow-hidden rounded-xl"
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

        {/* Hex input */}
        <input
          value={hex}
          onChange={(e) => {
            const hsv = hexToHsv(e.target.value);
            if (!hsv) return;
            setHue(hsv[0]);
            setSat(hsv[1]);
            setVal(hsv[2]);
          }}
          className="w-full rounded-lg border border-[#e4e4e7] px-3 py-2 text-sm tracking-[-0.03em] text-[#09090b] outline-none focus:border-[#2974ff]"
        />

        {/* Add button */}
        <button
          type="button"
          onClick={() => onAdd(hex)}
          className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-[#09090b] px-3 py-2.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
        >
          Add Color
        </button>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#71717b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
