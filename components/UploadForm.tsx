"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type GalleryComponent } from "@/store/authStore";
import { hexToHsl } from "@/lib/utils";

// Compress + convert to WebP client-side before upload. Returns the new file
// plus the aspect ratio computed from the (possibly downscaled) canvas.
async function compressImage(
  file: File,
  maxWidth = 2560,
  quality = 0.9,
): Promise<{ file: File; aspectRatio: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const aspectRatio =
        img.width && img.height ? img.width / img.height : null;

      // Image within bounds → upload original untouched (no re-encode, no
      // quality loss).
      if (img.width <= maxWidth) {
        URL.revokeObjectURL(url);
        resolve({ file, aspectRatio });
        return;
      }

      // Oversized → downscale with high-quality interpolation, encode WebP.
      const scale = maxWidth / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve({
            file: new File([blob!], file.name, { type: "image/webp" }),
            aspectRatio,
          });
        },
        "image/webp",
        quality,
      );
    };
    img.src = url;
  });
}

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

const CATEGORIES = [
  "Web",
  "Mobile",
  "Dashboard",
  "Logo",
  "Illustration",
] as const;
type Category = (typeof CATEGORIES)[number];

// UI category labels <-> the values stored in public.components.category.
const UI_TO_DB: Record<Category, string> = {
  Web: "Website",
  Mobile: "Mobile Apps",
  Dashboard: "Dashboard",
  Logo: "Logos",
  Illustration: "Illustrations",
};
const DB_TO_UI: Record<string, Category> = {
  Website: "Web",
  "Mobile Apps": "Mobile",
  Dashboard: "Dashboard",
  Logos: "Logo",
  Illustrations: "Illustration",
};

const LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

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
  Illustration: {
    sections: ["Flat", "Isometric", "Icons"],
    filters: [],
  },
};

// weight === null → auto (shares the remaining % evenly with other auto colors).
type ColorWeight = { hex: string; weight: number | null };

function resolveWeights(colors: ColorWeight[]): number[] {
  const lockedTotal = colors.reduce((s, c) => s + (c.weight ?? 0), 0);
  const autoIdx = colors
    .map((c, i) => (c.weight === null ? i : -1))
    .filter((i) => i >= 0);
  const remaining = Math.max(0, 100 - lockedTotal);
  const each = autoIdx.length ? Math.floor(remaining / autoIdx.length) : 0;

  const out = colors.map((c) => c.weight ?? 0);
  autoIdx.forEach((i, k) => {
    out[i] =
      k === autoIdx.length - 1 ? remaining - each * (autoIdx.length - 1) : each;
  });
  return out;
}

// Shape used to pre-fill the form when editing an existing component.
export type UploadInitialValues = {
  previewUrl?: string | null;
  aspectRatio?: number | null;
  figmaData?: string | null;
  category?: string | null; // DB category value
  section?: string | null;
  filters?: string[] | null;
  colors?: { hex: string; pct: number | null }[] | null;
  featured?: boolean | null;
};

// The saved row returned to the caller after insert/update.
export type SavedComponent = {
  id: string;
  category: string | null;
  section: string | null;
  filters: string[] | null;
  figma_url: string | null;
  figma_data: string | null;
  preview_url: string | null;
  aspect_ratio: number | null;
  colors: { hex: string; pct: number | null }[] | null;
  [key: string]: unknown;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-[#71717b]">
      {children}
    </p>
  );
}

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

export default function UploadForm({
  initialValues,
  componentId,
  heading = "Upload New Component",
  subheading = "Customize layout assets, Figma data, and color weights.",
  submitLabel = "Upload Component",
  onSuccess,
}: {
  initialValues?: UploadInitialValues;
  componentId?: string;
  heading?: string;
  subheading?: string;
  submitLabel?: string;
  onSuccess?: (component: SavedComponent) => void;
}) {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const addComponent = useAuthStore((s) => s.addComponent);
  const isEdit = !!componentId;

  const [file, setFile] = useState<File | null>(null);
  const [existingPreview, setExistingPreview] = useState<string | null>(
    initialValues?.previewUrl ?? null,
  );
  const [existingAspect, setExistingAspect] = useState<number | null>(
    initialValues?.aspectRatio ?? null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState<Category>(
    (initialValues?.category && DB_TO_UI[initialValues.category]) || "Web",
  );
  const [section, setSection] = useState<string | null>(
    initialValues?.section ?? null,
  );
  const [filters, setFilters] = useState<Set<string>>(
    () => new Set(initialValues?.filters ?? []),
  );
  const [colors, setColors] = useState<ColorWeight[]>(
    () =>
      (initialValues?.colors ?? []).map((c) => ({
        hex: c.hex,
        weight: c.pct ?? null,
      })),
  );
  const [featured, setFeatured] = useState<boolean>(
    initialValues?.featured ?? false,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [figmaData, setFigmaData] = useState<string | null>(
    initialValues?.figmaData ?? null,
  );
  const [pasteWaiting, setPasteWaiting] = useState(false);
  const [figmaCopied, setFigmaCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteCleanup = useRef<(() => void) | null>(null);

  // A local object URL for previewing a freshly-picked file.
  const filePreview = file ? URL.createObjectURL(file) : null;
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);
  const previewSrc = filePreview ?? existingPreview;

  // Wait for the user's own Ctrl+V (native paste event — no clipboard-read
  // permission needed). Stores the Figma component HTML fragment. Esc cancels.
  const pasteFigmaSection = () => {
    setPasteWaiting(true);
    const cleanup = () => {
      setPasteWaiting(false);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
      pasteCleanup.current = null;
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const html = e.clipboardData?.getData("text/html") ?? "";
      if (html.includes("<!--StartFragment-->")) {
        setFigmaData(html);
      } else {
        alert(
          "No Figma component found. Copy a frame in Figma (Ctrl+C), click the button, then press Ctrl+V.",
        );
      }
      cleanup();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup();
    };
    pasteCleanup.current = cleanup;
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
  };

  // Copy the stored Figma component back to the clipboard (execCommand → no
  // permission popup).
  const copyFigmaData = () => {
    if (!figmaData) return;
    const html = figmaData;
    const listener = (e: ClipboardEvent) => {
      e.clipboardData?.setData("text/html", html);
      e.preventDefault();
    };
    document.addEventListener("copy", listener);
    document.execCommand("copy");
    document.removeEventListener("copy", listener);
    setFigmaCopied(true);
    setTimeout(() => setFigmaCopied(false), 1500);
  };

  const { sections, filters: filterOpts } = CONFIG[category];
  const multiFilter = category === "Web" || category === "Mobile";

  // Image required, but in edit mode an existing preview counts.
  const hasImage = !!file || !!existingPreview;
  const canSave =
    hasImage &&
    !!figmaData &&
    (sections.length === 0 || section !== null) &&
    (filterOpts.length === 0 || filters.size > 0);

  const changeCategory = (c: Category) => {
    setCategory(c);
    setSection(null);
    setFilters(new Set());
  };

  const addColor = (hex: string) => {
    setColors((prev) =>
      prev.some((c) => c.hex === hex) ? prev : [...prev, { hex, weight: null }],
    );
    setPickerOpen(false);
  };
  const removeColor = (hex: string) =>
    setColors((prev) => prev.filter((c) => c.hex !== hex));
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
      return multiFilter ? new Set(prev).add(f) : new Set([f]);
    });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const submit = async () => {
    if (!canSave || saving) return;
    setError(null);
    setSaving(true);
    try {
      // Keep the existing preview/aspect unless a new file was chosen.
      let preview_url = existingPreview;
      let aspect_ratio = existingAspect;
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          setSaving(false);
          setError("Image must be under 10MB.");
          return;
        }
        // Compress to WebP in the browser, then upload straight to Cloudflare
        // via a one-time direct-upload URL (no server hop).
        const { file: compressed, aspectRatio } = await compressImage(file);
        const res = await fetch("/api/upload-image");
        const { uploadURL, id } = await res.json();
        const form = new FormData();
        form.append("file", compressed);
        const up = await fetch(uploadURL, { method: "POST", body: form });
        if (!up.ok) throw new Error("Image upload failed.");
        preview_url = `https://imagedelivery.net/${process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH}/${id}/public`;
        aspect_ratio = aspectRatio;
      }

      const dbColors = colors.map((c, i) => ({ hex: c.hex, pct: weights[i] }));
      // Same array + precomputed HSL, consumed by search_by_color's fast path.
      const colors_hsl = dbColors.map((c) => ({ ...c, ...hexToHsl(c.hex) }));
      const payload = {
        category: UI_TO_DB[category],
        section: sections.length > 0 ? section : null,
        filters: [...filters],
        // Only the pasted clipboard component is stored; no link.
        figma_url: null,
        figma_data: figmaData,
        preview_url,
        aspect_ratio,
        colors: dbColors,
        colors_hsl,
        featured,
      };

      const query = componentId
        ? supabase.from("components").update(payload).eq("id", componentId)
        : supabase
            .from("components")
            .insert({ ...payload, uploaded_by: profile?.id ?? null });

      const { data, error: dbErr } = await query.select().single();
      setSaving(false);
      if (dbErr) {
        setError(dbErr.message);
        return;
      }
      if (file && data?.preview_url) {
        setExistingPreview(data.preview_url);
        setExistingAspect((data as SavedComponent).aspect_ratio ?? null);
      }
      // New uploads prepend to the shared gallery list — instant homepage update.
      if (!componentId && data) {
        const c = data as SavedComponent;
        addComponent({
          id: c.id,
          category: c.category,
          section: c.section,
          filters: c.filters,
          figma_url: c.figma_url,
          preview_url: c.preview_url,
          aspect_ratio: c.aspect_ratio,
          colors: c.colors,
          featured: (c.featured as boolean) ?? false,
        } as GalleryComponent);
      }
      onSuccess?.(data as SavedComponent);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <div className="w-full max-w-[628px] rounded-2xl border border-[#e7e9ee] bg-[#f9fafa] p-6 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
          {heading}
        </h1>
        <p className="text-sm tracking-[-0.03em] text-[#71717b]">{subheading}</p>
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
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed px-4 py-9 transition-colors ${
            dragOver
              ? "border-[#2974ff] bg-[#f4f8ff]"
              : "border-[#d4d4d8] bg-[#fafafa] hover:bg-[#f5f5f5]"
          }`}
        >
          {previewSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                src={previewSrc}
                className="max-h-32 w-auto rounded-lg object-contain"
              />
              <span className="text-xs tracking-[-0.03em] text-[#a1a1aa]">
                {file ? file.name : "Click to replace image"}
              </span>
            </>
          ) : (
            <>
              <UploadIcon />
              <span className="text-sm tracking-[-0.03em] text-[#52525b]">
                Click to upload or drag &amp; drop
              </span>
              <span className="text-xs tracking-[-0.03em] text-[#a1a1aa]">
                PNG, JPG, WebP up to 10MB
              </span>
            </>
          )}
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
        <div className="flex min-h-[46px] w-full items-center gap-1 rounded-lg border border-[#e4e4e7] bg-white px-[7px] py-1.5">
          {pasteWaiting ? (
            <span className="flex-1 border border-transparent px-1 py-1.5 text-center text-sm font-medium tracking-[-0.03em] text-[#2974ff]">
              Press Ctrl+V to paste your Figma component
            </span>
          ) : figmaData ? (
            <>
              <button
                type="button"
                onClick={pasteFigmaSection}
                className="flex cursor-pointer items-center gap-2 rounded-[7px] border border-[#09090b] bg-[#09090b] px-2 py-1.5 text-sm tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
              >
                <ClipboardIcon />
                Paste Again
              </button>
              <button
                type="button"
                onClick={copyFigmaData}
                className="ml-auto flex cursor-pointer items-center gap-2 rounded-[7px] border border-[#e4e4e7] px-2 py-1.5 text-sm tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
              >
                <CopyIcon />
                {figmaCopied ? "Copied!" : "Copy"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={pasteFigmaSection}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-sm tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
            >
              <ClipboardIcon />
              Paste Figma Section
            </button>
          )}
        </div>
        {pasteWaiting ? (
          <p className="text-[11px] tracking-[-0.03em] text-[#a1a1aa]">
            Press Esc to cancel.
          </p>
        ) : figmaData ? (
          <p className="flex items-center gap-1.5 text-[11px] tracking-[-0.03em] text-[#1C9A00]">
            <CheckIcon />
            Figma component pasted successfully.
          </p>
        ) : (
          <p className="text-[11px] tracking-[-0.03em] text-[#a1a1aa]">
            Copy a frame in Figma (Ctrl+C), then click to paste.
          </p>
        )}
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

      {/* Select Section */}
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

      {/* Select Filter */}
      {filterOpts.length > 0 && (
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
      )}

      {/* Select Colors */}
      {category !== "Logo" && (
      <div className="mt-6 flex flex-col gap-2.5">
        {colors.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <FieldLabel>Select Colors</FieldLabel>
              <span className="text-xs tracking-[-0.03em] text-[#71717b]">
                Total: {total}%
              </span>
            </div>

            <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#efeff0]">
              {colors.map((c, i) => (
                <div
                  key={c.hex}
                  style={{ flex: weights[i], backgroundColor: c.hex }}
                />
              ))}
            </div>

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
                        onChange={(e) => setWeight(c.hex, Number(e.target.value))}
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

        <div className="relative mt-1">
          {pickerOpen && (
            <ColorPicker onAdd={addColor} onClose={() => setPickerOpen(false)} />
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
      )}

      {/* Show on top */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-[#e7e9ee] bg-white px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium tracking-[-0.03em] text-[#09090b]">
            Show on top
          </span>
          <span className="text-xs tracking-[-0.03em] text-[#71717b]">
            Pin this component to the top of the gallery.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={featured}
          onClick={() => setFeatured((v) => !v)}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            featured ? "bg-[#09090b]" : "bg-[#e4e4e7]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
              featured ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm tracking-[-0.03em] text-[#ef4444]">{error}</p>
      )}

      {/* Submit */}
      <button
        type="button"
        disabled={!canSave || saving}
        onClick={submit}
        className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#09090b] px-4 py-3 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#09090b]"
      >
        {saving ? "Saving…" : isEdit ? "Save Changes" : submitLabel}
      </button>
    </div>
  );
}

// Color picker popover — SV square, hue slider, hex input, Add button.
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
      <div
        aria-hidden
        className="absolute left-1/2 -bottom-2 size-4 -translate-x-1/2 rotate-45 rounded-br-[3px] border-b border-r border-[#e7e9ee] bg-white"
      />

      <div className="flex flex-col gap-2.5">
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

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1C9A00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
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
