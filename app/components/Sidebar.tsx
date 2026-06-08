"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, Minus } from "lucide-react";
import ColorSearch from "./ColorSearch";
import { useAuthStore } from "@/store/authStore";
import { createClient } from "@/lib/supabase/client";

// Sidebar section id -> public.components.category value.
const CAT_MAP: Record<string, string> = {
  website: "Website",
  mobile: "Mobile Apps",
  dashboard: "Dashboard",
  logos: "Logos",
};

type Comp = {
  category: string | null;
  section: string | null;
  filters: string[] | null;
};

// Asset URLs sourced from Figma (remote, expire ~7 days).
const imgVectorLogo = "https://www.figma.com/api/mcp/asset/e43c5089-51a7-45fe-8bd2-b63a7d3b1c34";
const imgLoginUser = "https://www.figma.com/api/mcp/asset/bd04080a-ebbb-4c22-b15b-9d6f989a987b";
const imgLoginArrow = "https://www.figma.com/api/mcp/asset/e2316c41-86b0-444b-a898-f01386376988";

type Tag = { label: string };
type Section = {
  id: string;
  label: string;
  tags?: Tag[];
  styles?: string[];
  letters?: string[];
};

const sections: Section[] = [
  {
    id: "website",
    label: "Website",
    tags: [
      { label: "Hero" },
      { label: "Bento" },
      { label: "Social Proof" },
      { label: "Features" },
      { label: "Process" },
      { label: "Pricing" },
      { label: "Footer" },
      { label: "Others" },
    ],
    styles: [
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
  {
    id: "mobile",
    label: "Mobile Apps",
    tags: [{ label: "Onboarding" }, { label: "Features" }],
    styles: ["Light", "Dark", "Minimal", "Colorful", "Gradient"],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    styles: ["Light", "Dark", "Others"],
  },
  {
    id: "logos",
    label: "Logos",
    letters: [
      ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
      "Others",
    ],
  },
];

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
        active
          ? "border-[#2974ff] bg-[#deeaff]"
          : "border-[#e4e4e7] bg-transparent shadow-[0px_0px_0.5px_0px_rgba(0,0,0,0.25)] hover:bg-[#fafafa]"
      }`}
    >
      <span
        className={`text-sm tracking-[-0.03em] ${
          active ? "text-[#2974ff]" : "text-[#71717b]"
        }`}
      >
        {label}
      </span>
      {count != null && (
        <span
          className={`flex items-center justify-center rounded-full border px-1.5 text-center text-xs leading-[18px] tracking-[-0.03em] ${
            active
              ? "border-[#99bdff] bg-[#ccdeff] text-[#2974ff]"
              : "border-[#e4e4e7] text-[#71717b]"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SectionCard({
  section,
  open,
  onToggle,
  selected,
  onSelect,
  comps,
}: {
  section: Section;
  open: boolean;
  onToggle: () => void;
  selected: Set<string>;
  onSelect: (key: string, sectionId: string) => void;
  comps: Comp[];
}) {
  const hasContent = !!(section.tags || section.styles || section.letters);
  const select = (key: string) => onSelect(key, section.id);

  // Components in this category — drives the count badges (0 when none).
  const catComps = comps.filter((c) => c.category === CAT_MAP[section.id]);
  const sectionCount = (label: string) =>
    catComps.filter((c) => c.section === label).length;

  const Header = (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-between"
    >
      <div className="flex items-center gap-1">
        <span className="text-base font-medium tracking-[-0.03em] text-[#09090b]">
          {section.label}
        </span>
        <span className="text-xs tracking-[-0.03em] text-[#71717b]">
          ({catComps.length})
        </span>
      </div>
      <ChevronDown
        size={18}
        strokeWidth={1.5}
        className={`text-[#71717b] transition-transform duration-300 ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );

  // Simple row (no expandable content)
  if (!hasContent) {
    return (
      <div className="w-full rounded-lg bg-white px-3 py-2">{Header}</div>
    );
  }

  return (
    <div className="flex w-full flex-col rounded-[10px] bg-white p-3">
      {Header}
      {/* Collapsible body — animates via grid-rows */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "mt-3.5 grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3.5">
            {section.tags && (
              <div className="flex w-full flex-wrap content-start gap-3.5">
                {section.tags.map((t) => {
                  const key = `${section.id}:${t.label}`;
                  return (
                    <Chip
                      key={key}
                      label={t.label}
                      count={sectionCount(t.label)}
                      active={selected.has(key)}
                      onClick={() => select(key)}
                    />
                  );
                })}
              </div>
            )}
            {section.tags && section.styles && (
              <div className="h-px w-full bg-[#e4e4e7]" />
            )}
            {section.styles && (
              <div className="flex w-full flex-wrap content-start gap-3.5">
                {section.styles.map((s) => {
                  const key = `${section.id}:style:${s}`;
                  return (
                    <Chip
                      key={key}
                      label={s}
                      active={selected.has(key)}
                      onClick={() => select(key)}
                    />
                  );
                })}
              </div>
            )}
            {section.letters && (
              <div className="flex w-full flex-wrap gap-3">
                {section.letters.map((l) => {
                  const key = `${section.id}:${l}`;
                  const active = selected.has(key);
                  const isLetter = l.length === 1;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => select(key)}
                      className={`flex items-center justify-center rounded-lg border text-[14px] tracking-[-0.03em] transition-colors ${
                        isLetter ? "size-[30px] p-1.5" : "h-[30px] px-2"
                      } ${
                        active
                          ? "border-[#2974ff] bg-[#deeaff] text-[#2974ff]"
                          : "border-[#e4e4e7] bg-transparent text-[#71717b] shadow-[0px_0px_0.5px_0px_rgba(0,0,0,0.25)] hover:bg-[#fafafa]"
                      }`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  cols,
  onColsChange,
  maxCols = 5,
  minCols = 1,
  loggedIn,
  onLoginClick,
  onMenuClick,
  onFilter,
  onColorSearch,
  onColorClear,
}: {
  cols: number;
  onColsChange: (n: number) => void;
  maxCols?: number;
  minCols?: number;
  loggedIn: boolean;
  onLoginClick: () => void;
  onMenuClick: () => void;
  onFilter: (sectionId: string | null, filters: string[]) => void;
  onColorSearch?: (colors: string[]) => void;
  onColorClear?: () => void;
}) {
  const profile = useAuthStore((s) => s.profile);
  const authLoading = useAuthStore((s) => s.authLoading);

  // `cols` derives from localStorage on the client, so the SSR value differs.
  // Render the column-split segments only after mount to avoid a hydration
  // mismatch on their count/rounded classes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Published components — used only to compute the count badges.
  const [comps, setComps] = useState<Comp[]>([]);
  useEffect(() => {
    let alive = true;
    createClient()
      .from("components")
      .select("category, section, filters")
      .eq("is_published", true)
      .then(({ data }) => {
        if (alive) setComps((data as Comp[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Accordion: at most one section open at a time.
  const [openId, setOpenId] = useState<string | null>("website");
  // Filters selected per section — persisted across open/close and across
  // switching accordions. Keys are prefixed "<sectionId>:" so one Set holds all.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Selected filters belonging to one section → DB values.
  // Strips the "<sectionId>:" prefix but KEEPS the "style:" theme marker so the
  // gallery can tell tags (match section) from themes (narrow within filters).
  const sectionFilters = (sectionId: string, keys: Set<string>) =>
    [...keys]
      .filter((k) => k.startsWith(`${sectionId}:`))
      .map((k) => k.slice(sectionId.length + 1));

  // Opening a section closes every other. Closing keeps the right side on that
  // section, so an all-closed sidebar still shows the last opened option.
  // Selections are never wiped.
  const toggleOpen = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    const active = next ?? id;
    onFilter(active, sectionFilters(active, selected));
  };

  // Toggle a filter; right side shows every still-selected one for its section.
  const selectChip = (key: string, sectionId: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    onFilter(sectionId, sectionFilters(sectionId, next));
  };

  return (
    <aside className="flex h-full w-[325px] shrink-0 flex-col p-[18px]">
      {/* Scrollable region (brand scrolls with the options) + fade overlays */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col gap-[18px] overflow-y-auto pb-6 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Brand */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <p className="text-xl font-medium tracking-[-0.03em] text-[#09090b]">
              Figma Blocks
            </p>
            <div className="flex flex-col gap-0.5">
              <p className="text-base tracking-[-0.03em] text-[#71717b]">
                A collection of designs shared on X, now
              </p>
              <div className="flex items-center gap-1.5">
                <p className="text-base tracking-[-0.03em] text-[#71717b]">
                  free for the community by
                </p>
                <a
                  href="https://lander.studio/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-1.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src={imgVectorLogo} className="h-[13.6px] w-[10.7px]" />
                  <span className="text-sm font-medium tracking-[-0.03em] text-[#09090b] group-hover:underline">
                    Lander Studio
                  </span>
                </a>
              </div>
            </div>
          </div>

          {sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              open={openId === s.id}
              onToggle={() => toggleOpen(s.id)}
              selected={selected}
              onSelect={selectChip}
              comps={comps}
            />
          ))}

          {/* Color search */}
          <ColorSearch onSearch={onColorSearch} onClear={onColorClear} />

          {/* Layout setting */}
          <div className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-[#e7e9ee] bg-white p-3">
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              Layout Setting
            </p>
            <div className="flex w-full items-center gap-1.5">
              <button
                type="button"
                onClick={() => onColsChange(Math.max(minCols, cols - 1))}
                disabled={mounted && cols <= minCols}
                aria-label="Fewer columns"
                className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#09090b] text-white disabled:cursor-default disabled:opacity-40"
              >
                <Minus size={20} strokeWidth={1.25} />
              </button>
              {/* Line split into `cols` equal segments. Always render the max (6)
                  segments and transition each one's flex-grow/margin, so the bar
                  smoothly redistributes width when the layout changes instead of
                  snapping. Client-only (see mounted). */}
              <div className="flex flex-1 items-center">
                {mounted &&
                  Array.from({ length: 6 }).map((_, i) => {
                    const active = i < cols;
                    return (
                      <div
                        key={i}
                        style={{
                          flexGrow: active ? 1 : 0,
                          opacity: active ? 1 : 0,
                          marginLeft: active && i > 0 ? 4 : 0,
                        }}
                        className={`h-[30px] flex-shrink basis-0 bg-[#efeff0] transition-all duration-300 ease-out ${
                          i === 0 ? "rounded-l-lg" : ""
                        } ${i === cols - 1 ? "rounded-r-lg" : ""}`}
                      />
                    );
                  })}
              </div>
              <button
                type="button"
                onClick={() => onColsChange(Math.min(maxCols, cols + 1))}
                disabled={mounted && cols >= maxCols}
                aria-label="More columns"
                className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#09090b] text-white disabled:cursor-default disabled:opacity-40"
              >
                <Plus size={20} strokeWidth={1.25} />
              </button>
            </div>
          </div>
        </div>

        {/* Fade overflow — content dissolves at the top and before the footer */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-[#f5f5f5] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#f5f5f5] to-transparent" />
      </div>

      {/* Footer — skeleton while auth resolves, then profile or login prompt */}
      {authLoading ? (
        <div className="mt-2.5 flex w-full shrink-0 items-center gap-2 rounded-lg border border-[#e7e9ee] bg-white px-3 py-2">
          <div className="size-[30px] shrink-0 animate-pulse rounded-full bg-[#ebebef]" />
          <div className="h-4 w-24 animate-pulse rounded-full bg-[#ebebef]" />
        </div>
      ) : loggedIn ? (
        <div className="mt-2.5 flex w-full shrink-0 items-center justify-between rounded-[10px] border border-[#e7e9ee] bg-white px-3 py-2">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open profile"
            className="flex cursor-pointer items-center gap-2"
          >
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={profile.avatar_url}
                referrerPolicy="no-referrer"
                className="size-[30px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-[30px] items-center justify-center rounded-full bg-[#09090b] text-sm font-medium text-white">
                {(profile?.full_name ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-base font-medium tracking-[-0.03em] text-[#09090b]">
              {profile?.full_name ?? "Account"}
            </span>
          </button>
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open profile"
            className="cursor-pointer px-1 text-lg leading-none tracking-[-0.03em] text-[#71717b]"
          >
            ⋮
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onLoginClick}
          className="mt-2.5 flex w-full shrink-0 cursor-pointer items-center justify-between rounded-[10px] border border-[#e7e9ee] bg-[rgba(123,113,113,0.05)] px-3 py-2 transition-colors hover:bg-[rgba(123,113,113,0.08)]"
        >
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={imgLoginUser} className="size-[18px]" />
            <span className="text-base tracking-[-0.03em] text-[#71717b]">
              Login to Copy
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={imgLoginArrow} className="size-4" />
        </button>
      )}
    </aside>
  );
}
