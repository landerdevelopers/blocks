"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Minus, User, LogOut, ChevronsUpDown, Search, CirclePlus, ExternalLink, Globe } from "lucide-react";
import ColorSearch from "./ColorSearch";
import { ScrollFadeEffect } from "@/components/scroll-fade-effect";
import { useAuthStore } from "@/store/authStore";
import { createClient } from "@/lib/supabase/client";

// Record a click on the "Lander Studio" link. Fire-and-forget — sendBeacon
// survives the new-tab navigation; fetch+keepalive is the fallback.
function trackLanderClick() {
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track-lander-click");
    } else {
      fetch("/api/track-lander-click", { method: "POST", keepalive: true });
    }
  } catch {
    // never block the visitor
  }
}

// A creator row in the "All Creators" popup (one row from list_creators()).
type Creator = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  count: number;
};

// Sidebar section id -> public.components.category value.
const CAT_MAP: Record<string, string> = {
  website: "Website",
  mobile: "Mobile Apps",
  dashboard: "Dashboard",
  logos: "Logos",
  illustrations: "Illustrations",
};

// Pre-aggregated counts from get_sidebar_counts, fetched + cached server-side
// and passed in as a prop so badges are correct in the first server-rendered
// HTML (no flash, no hydration mismatch, no client query).
export type SidebarCounts = {
  categories: Record<string, number>;
  sections: Record<string, number>;
  logoLetters: string[];
};


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
    styles: ["Light", "Dark"],
  },
  {
    id: "logos",
    label: "Logos",
    letters: [
      ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
      "Others",
    ],
  },
  {
    id: "illustrations",
    label: "Illustrations",
    tags: [{ label: "Flat" }, { label: "Isometric" }],
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
      className={`flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all duration-200 ease-out active:scale-95 ${
        active
          ? "border-[#2974ff] bg-[#deeaff]"
          : "border-[#e4e4e7] bg-transparent shadow-[0px_0px_0.5px_0px_rgba(0,0,0,0.25)] hover:bg-[#fafafa]"
      }`}
    >
      <span
        className={`text-sm tracking-[-0.03em] transition-colors duration-200 ${
          active ? "text-[#2974ff]" : "text-[#71717b]"
        }`}
      >
        {label}
      </span>
      {count != null && (
        <span
          className={`flex items-center justify-center rounded-full border px-1.5 text-center text-xs leading-[18px] tracking-[-0.03em] transition-colors duration-200 ${
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
  sidebarCounts,
}: {
  section: Section;
  open: boolean;
  onToggle: () => void;
  selected: Set<string>;
  onSelect: (key: string, sectionId: string) => void;
  sidebarCounts: SidebarCounts;
}) {
  // Every category is open to everyone now, showing its live count badge.
  const hasContent = !!(section.tags || section.styles || section.letters);
  const select = (key: string) => onSelect(key, section.id);

  // Count badges come from the pre-aggregated RPC (instant, accurate, no drift).
  const dbCat = CAT_MAP[section.id];
  const categoryCount = sidebarCounts.categories[dbCat] ?? 0;
  const sectionCount = (label: string) =>
    sidebarCounts.sections[`${dbCat}|${label}`] ?? 0;

  // Letters (logos) that actually have a component — others are hidden so the
  // filter only offers letters with logos behind them.
  const availableLetters = new Set(sidebarCounts.logoLetters ?? []);
  const letters = section.letters?.filter((l) => availableLetters.has(l));

  const headerInner = (
    <>
      <div className="flex items-center gap-1">
        <span className="text-base font-medium leading-none tracking-[-0.03em] text-[#09090b]">
          {section.label}
        </span>
        <span className="text-[14px] leading-none tracking-[-0.03em] text-[#71717b]">
          ({categoryCount})
        </span>
      </div>
      <ChevronDown
        size={18}
        strokeWidth={1.5}
        className={`text-[#71717b] transition-transform duration-300 ${
          open ? "rotate-180" : ""
        }`}
      />
    </>
  );

  // Simple row (no expandable content) — button spans full padded area.
  if (!hasContent) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg bg-white px-3 py-2"
      >
        {headerInner}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col rounded-[10px] border border-[#e7e9ee] bg-white">
      {/* Header button covers full card width incl. padding */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-3"
      >
        {headerInner}
      </button>
      {/* Collapsible body — animates via grid-rows */}
      <div
        className={`grid px-3 transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3.5 pb-3">
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
            {letters && letters.length > 0 && (
              <div className="flex w-full flex-wrap gap-3">
                {letters.map((l) => {
                  const key = `${section.id}:${l}`;
                  const active = selected.has(key);
                  const isLetter = l.length === 1;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => select(key)}
                      className={`flex cursor-pointer items-center justify-center rounded-lg border text-[14px] tracking-[-0.03em] transition-all duration-200 ease-out active:scale-95 ${
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
  onColorPickerOpen,
  activeCategory,
  onBecomeCreator,
  onCreatorSelect,
  onCreatorRestoreDone,
  creatorRestorePending = false,
  sidebarCounts,
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
  onColorPickerOpen?: () => void;
  // The category the gallery is currently showing (may differ from the open
  // accordion — a closed accordion still shows the last-opened category).
  activeCategory?: string | null;
  // Open the "Join the Creator Program" modal (handled by the parent).
  onBecomeCreator?: () => void;
  // A creator was picked (id) or cleared (null) — parent filters the gallery to
  // that creator's components.
  onCreatorSelect?: (creatorId: string | null) => void;
  // Fired once the ?creator= URL restore resolves (creator found OR not), so the
  // parent can release the gallery from its "restoring" skeleton hold.
  onCreatorRestoreDone?: () => void;
  // True while a ?creator= param is still resolving to a profile. Drives a
  // loading placeholder in the creator header/bio so the sidebar never flashes
  // the "All Creators" default before snapping to the restored creator.
  creatorRestorePending?: boolean;
  // Pre-aggregated count badges (server-fetched, server-cached).
  sidebarCounts: SidebarCounts;
}) {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const authLoading = useAuthStore((s) => s.authLoading);

  // The signed-in user's own creator handle — drives the "Open Creator Portal"
  // footer button. Only for an active creator (or admin); a user whose access
  // was revoked keeps their username but should no longer see the button (and
  // middleware would block the portal anyway).
  const myUsername =
    profile?.role === "creator" || profile?.role === "admin"
      ? (profile?.username ?? null)
      : null;

  // Creators popup (anchored to the "All Creators" row). Creators are loaded
  // once when the popup first opens (list_creators RPC).
  const [creatorsOpen, setCreatorsOpen] = useState(false);
  const [creatorQuery, setCreatorQuery] = useState("");
  // Selected creator — drives the sidebar header/bio AND, via onCreatorSelect,
  // filters the gallery to just their designs.
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);
  // Selected creator's socials/CTA (list_creators doesn't carry them) — fetched
  // via get_creator when a creator is picked, shown under their bio.
  const [creatorSocials, setCreatorSocials] = useState<{
    x_handle: string | null;
    instagram_handle: string | null;
    linkedin_handle: string | null;
    website_url: string | null;
    cta_url: string | null;
  } | null>(null);
  // Extract the socials/CTA fields out of a get_creator result.
  const socialsFrom = (d: Record<string, string | null>) => ({
    x_handle: d.x_handle ?? null,
    instagram_handle: d.instagram_handle ?? null,
    linkedin_handle: d.linkedin_handle ?? null,
    website_url: d.website_url ?? null,
    cta_url: d.cta_url ?? null,
  });
  // Username we already hold socials for — lets the effect below skip a fetch
  // when socials were seeded elsewhere (e.g. the URL-restore path, which already
  // called get_creator). Prevents a duplicate get_creator on load.
  const socialsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCreator) {
      setCreatorSocials(null);
      return;
    }
    // Already have this creator's socials (seeded by restore) → no refetch.
    if (socialsLoadedFor.current === selectedCreator.username) return;
    let alive = true;
    createClient()
      .rpc("get_creator", { uname: selectedCreator.username })
      .then(({ data }) => {
        if (!alive || !data) return;
        setCreatorSocials(socialsFrom(data as Record<string, string | null>));
        socialsLoadedFor.current = selectedCreator.username;
      });
    return () => {
      alive = false;
    };
  }, [selectedCreator]);
  // Real creators, loaded once the first time the popup opens (list_creators).
  const [creators, setCreators] = useState<Creator[]>([]);
  const [creatorsLoaded, setCreatorsLoaded] = useState(false);
  useEffect(() => {
    if (!creatorsOpen || creatorsLoaded) return;
    createClient()
      .rpc("list_creators")
      .then(({ data }) => {
        setCreators((data as Creator[]) ?? []);
        setCreatorsLoaded(true);
      });
  }, [creatorsOpen, creatorsLoaded]);
  const filteredCreators = creators.filter((c) =>
    (c.full_name ?? c.username).toLowerCase().includes(creatorQuery.toLowerCase()),
  );

  // When a creator is selected, the prop counts (global, server-cached) are
  // wrong — the gallery only shows that creator's published designs. Recompute
  // the badge counts client-side from their published components and use those
  // instead. Cleared back to the global prop when no creator is selected.
  const [creatorCounts, setCreatorCounts] = useState<SidebarCounts | null>(null);
  // Recompute when a component is added/removed (delete in the gallery) too.
  const componentsVersion = useAuthStore((s) => s.componentsVersion);
  useEffect(() => {
    if (!selectedCreator) {
      setCreatorCounts(null);
      return;
    }
    let alive = true;
    // Aggregated in-DB (get_creator_sidebar_counts) instead of pulling every one
    // of the creator's component rows to tally in JS.
    createClient()
      .rpc("get_creator_sidebar_counts", { creator_id: selectedCreator.id })
      .then(({ data }) => {
        if (!alive || !data) return;
        setCreatorCounts(data as SidebarCounts);
      });
    return () => {
      alive = false;
    };
  }, [selectedCreator, componentsVersion]);

  // Badge source: creator-scoped when one is selected, else the global prop.
  const counts = creatorCounts ?? sidebarCounts;

  // Persist the picked creator in the URL (?creator=<username>) so a refresh or
  // shared link restores the same creator instead of snapping back to All
  // Creators. Mirrors the ?category= persistence in HomeClient and preserves any
  // other params (e.g. category).
  const writeCreatorParam = (username: string | null) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (username) params.set("creator", username);
    else params.delete("creator");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  };

  // Pick a creator (or clear back to All Creators) — updates the sidebar UI,
  // tells the parent to filter the gallery, and persists the choice to the URL.
  const pickCreator = (c: Creator | null) => {
    setSelectedCreator(c);
    onCreatorSelect?.(c?.id ?? null);
    setCreatorsOpen(false);
    writeCreatorParam(c?.username ?? null);
  };

  // Restore a creator selected before a refresh (or opened via a shared link)
  // from ?creator=<username>. Fetches the public profile via get_creator and
  // re-picks it. Runs once on mount; a stale/removed username drops the param.
  const creatorRestored = useRef(false);
  useEffect(() => {
    if (creatorRestored.current) return;
    creatorRestored.current = true;
    const uname = new URLSearchParams(window.location.search).get("creator");
    if (!uname) return;
    let alive = true;
    createClient()
      .rpc("get_creator", { uname })
      .then(({ data }) => {
        if (!alive) return;
        if (!data) {
          writeCreatorParam(null); // unknown/removed creator → clear stale param
          onCreatorRestoreDone?.(); // release the gallery's restore hold
          return;
        }
        const d = data as Record<string, string | null>;
        // Seed socials from this same fetch + mark loaded, so the socials effect
        // doesn't fire a second get_creator for the same username.
        setCreatorSocials(socialsFrom(d));
        socialsLoadedFor.current = (d.username as string) ?? null;
        pickCreator({
          id: d.id as string,
          username: d.username as string,
          full_name: d.full_name ?? null,
          avatar_url: d.avatar_url ?? null,
          bio: d.bio ?? null,
          count: 0,
        });
        onCreatorRestoreDone?.(); // creator resolved → gallery can fetch it now
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Become a Creator" — opens the Creator Program modal (handled by parent).
  const becomeCreator = () => {
    setCreatorsOpen(false);
    onBecomeCreator?.();
  };

  // Pending creator application — prefetched at sign-in (AuthProvider), so the
  // footer CTA is correct the instant the popup opens (no query flash).
  const hasPendingApplication =
    useAuthStore((s) => s.pendingCreatorApp) === true;
  // Existing OR revoked creator (approved application) — no "Become a Creator" CTA.
  const wasCreator = useAuthStore((s) => s.wasCreator) === true;

  // `cols` derives from localStorage on the client, so the SSR value differs.
  // Render the column-split segments only after mount to avoid a hydration
  // mismatch on their count/rounded classes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Accordion: at most one section open at a time. Init to the active category
  // (now SSR-correct — page derives it from ?category), so the right accordion
  // is open from the first render with no flash. toggleOpen owns it after.
  const [openId, setOpenId] = useState<string | null>(
    () => activeCategory ?? "website",
  );
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
        <div
          className={`absolute inset-0 flex flex-col gap-[18px] pb-6 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            creatorsOpen ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {/* Creators */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setCreatorsOpen((o) => !o)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-[10px] border py-2 transition-all duration-200 ${
                  creatorsOpen
                    ? "border-[#e7e9ee] bg-white px-2 shadow-[0px_0.98px_1.96px_0px_rgba(44,43,79,0.05),0px_1.42px_3.42px_0px_rgba(44,43,79,0.04)]"
                    : "border-transparent px-0 hover:border-[#e7e9ee] hover:bg-white hover:px-2 hover:shadow-[0px_0.98px_1.96px_0px_rgba(44,43,79,0.05),0px_1.42px_3.42px_0px_rgba(44,43,79,0.04)]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {selectedCreator ? (
                    <span className="flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#ebebef] text-xs font-medium text-[#09090b]">
                      {selectedCreator.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          src={selectedCreator.avatar_url}
                          referrerPolicy="no-referrer"
                          className="size-full object-cover"
                        />
                      ) : (
                        (selectedCreator.full_name ?? selectedCreator.username)
                          .charAt(0)
                          .toUpperCase()
                      )}
                    </span>
                  ) : creatorRestorePending ? (
                    <span className="skeleton-shimmer size-[30px] shrink-0 rounded-md" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src="/creators.svg" className="size-[30px] shrink-0" />
                  )}
                  {selectedCreator ? (
                    <span className="truncate text-[18px] leading-none tracking-[-0.03em] text-[#09090b]">
                      {selectedCreator.full_name ?? selectedCreator.username}
                    </span>
                  ) : creatorRestorePending ? (
                    <span className="skeleton-shimmer h-4 w-24 rounded-md" />
                  ) : (
                    <span className="truncate text-[18px] leading-none tracking-[-0.03em] text-[#09090b]">
                      All Creators
                    </span>
                  )}
                </div>
                <ChevronsUpDown size={18} strokeWidth={1.5} className="shrink-0 text-[#71717b]" />
              </button>

              {creatorsOpen && (
                <>
                  {/* click-away */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setCreatorsOpen(false)}
                  />
                  <div className="absolute inset-x-0 top-full z-50 mt-1 flex flex-col overflow-hidden rounded-[14px] border border-[#e7e9ee] bg-white shadow-[0px_10px_5px_rgba(0,0,0,0.04),0px_2px_2.5px_rgba(0,0,0,0.04)]">
                    {/* Search */}
                    <div className="flex items-center gap-2 border-b border-[#e7e9ee] p-2.5">
                      <Search size={18} strokeWidth={1.5} className="shrink-0 text-[#71717b]" />
                      <input
                        value={creatorQuery}
                        onChange={(e) => setCreatorQuery(e.target.value)}
                        placeholder="Search creators"
                        className="w-full bg-transparent text-base tracking-[-0.03em] text-black outline-none placeholder:text-[#71717b]"
                      />
                    </div>

                    {/* List — max 4 rows visible, scroll the rest. Edge fade. */}
                    <ScrollFadeEffect className="max-h-[192px]">
                        {/* All Creators — always on top; clears the selection.
                            Active (dark gray) when no creator is selected. */}
                        <button
                          type="button"
                          onClick={() => pickCreator(null)}
                          className={`flex w-full cursor-pointer items-center gap-2 p-2.5 transition-colors ${
                            selectedCreator ? "hover:bg-[#f2f2f2]" : "bg-[#e4e4e7]"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt="" src="/creators.svg" className="size-7 shrink-0" />
                          <span className="text-base tracking-[-0.03em] text-black">
                            All Creators
                          </span>
                        </button>
                        {/* Shimmer while the list loads. */}
                        {!creatorsLoaded &&
                          Array.from({ length: 4 }).map((_, i) => (
                            <div
                              key={`sk-${i}`}
                              className="flex w-full items-center justify-between p-2.5"
                            >
                              <span className="flex items-center gap-2">
                                <span className="skeleton-shimmer size-7 shrink-0 rounded-md" />
                                <span className="skeleton-shimmer h-4 w-28 rounded-md" />
                              </span>
                              <span className="skeleton-shimmer h-[22px] w-[37px] shrink-0 rounded-md" />
                            </div>
                          ))}
                        {creatorsLoaded && filteredCreators.length === 0 && (
                          <p className="p-2.5 text-sm tracking-[-0.03em] text-[#a1a1aa]">
                            No creators found.
                          </p>
                        )}
                        {filteredCreators.map((c) => {
                          const active = c.username === selectedCreator?.username;
                          return (
                          <button
                            key={c.username}
                            type="button"
                            onClick={() => pickCreator(c)}
                            className={`group flex w-full cursor-pointer items-center justify-between p-2.5 transition-colors ${
                              active ? "bg-[#e4e4e7]" : "hover:bg-[#f2f2f2]"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#ebebef] text-xs font-medium text-[#09090b]">
                                {c.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    alt=""
                                    src={c.avatar_url}
                                    referrerPolicy="no-referrer"
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  (c.full_name ?? c.username).charAt(0).toUpperCase()
                                )}
                              </span>
                              <span className="text-base tracking-[-0.03em] text-black">
                                {c.full_name ?? c.username}
                              </span>
                            </span>
                            <span className="flex h-[22px] w-[37px] shrink-0 items-center justify-center rounded-md bg-[#f7f7f7] text-xs font-medium tracking-[-0.03em] text-[#71717b] transition-colors group-hover:bg-white">
                              {c.count}
                            </span>
                          </button>
                          );
                        })}
                    </ScrollFadeEffect>

                    {/* Footer — approved creators get an "Open Creator Portal"
                        link to their own page; a pending applicant sees nothing;
                        everyone else gets the Become-a-Creator action. */}
                    {myUsername ? (
                      <div className="flex items-center border-t border-[#e7e9ee] p-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCreatorsOpen(false);
                            router.push(`/creators/${myUsername}`);
                          }}
                          className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#ebebeb] bg-white px-2.5 py-1.5 shadow-[0px_1px_1px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#fafafa]"
                        >
                          <ExternalLink size={16} strokeWidth={1.5} className="text-[#71717b]" />
                          <span className="text-base tracking-[-0.03em] text-[#71717b]">
                            Open Creator Portal
                          </span>
                        </button>
                      </div>
                    ) : hasPendingApplication || wasCreator ? null : (
                      <div className="flex items-center border-t border-[#e7e9ee] p-2">
                        <button
                          type="button"
                          onClick={becomeCreator}
                          className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#ebebeb] bg-white px-2.5 py-1.5 shadow-[0px_1px_1px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#fafafa]"
                        >
                          <CirclePlus size={16} strokeWidth={1.5} className="text-[#71717b]" />
                          <span className="text-base tracking-[-0.03em] text-[#71717b]">
                            Become a Creator
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {selectedCreator ? (
              <div className="flex flex-col gap-2.5">
                <p className="text-base tracking-[-0.03em] text-[#71717b]">
                  {selectedCreator.bio ? selectedCreator.bio : "No bio added"}
                </p>
                {creatorSocials &&
                  (() => {
                    // Hire Creator deliberately omitted here. One social → icon +
                    // label; two or more → icons only, each stretched to fill the
                    // row evenly. Brand glyphs come from /public.
                    const socials = [
                      ...(creatorSocials.website_url
                        ? [
                            {
                              key: "web",
                              href: creatorSocials.website_url,
                              label: "Website",
                              icon: <Globe size={16} strokeWidth={1.5} />,
                            },
                          ]
                        : []),
                      ...(creatorSocials.x_handle
                        ? [
                            {
                              key: "x",
                              href: `https://x.com/${creatorSocials.x_handle}`,
                              label: "X",
                              // eslint-disable-next-line @next/next/no-img-element
                              icon: <img src="/x.svg" alt="" className="size-4" />,
                            },
                          ]
                        : []),
                      ...(creatorSocials.instagram_handle
                        ? [
                            {
                              key: "ig",
                              href: `https://instagram.com/${creatorSocials.instagram_handle}`,
                              label: "Instagram",
                              // eslint-disable-next-line @next/next/no-img-element
                              icon: <img src="/insta.svg" alt="" className="size-4" />,
                            },
                          ]
                        : []),
                      ...(creatorSocials.linkedin_handle
                        ? [
                            {
                              key: "li",
                              href: `https://linkedin.com/in/${creatorSocials.linkedin_handle}`,
                              label: "LinkedIn",
                              // eslint-disable-next-line @next/next/no-img-element
                              icon: <img src="/linkedin.svg" alt="" className="size-4" />,
                            },
                          ]
                        : []),
                    ];
                    if (socials.length === 0) return null;
                    const single = socials.length === 1;
                    return (
                      <div className="flex items-center gap-2">
                        {socials.map((s) => (
                          <a
                            key={s.key}
                            href={s.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={s.label}
                            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#e7e9ee] bg-white text-[#52525b] transition-opacity hover:opacity-90"
                          >
                            {s.icon}
                            {single && (
                              <span className="text-[13px] font-medium tracking-[-0.03em]">
                                {s.label}
                              </span>
                            )}
                          </a>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            ) : creatorRestorePending ? (
              <div className="flex flex-col gap-2">
                <span className="skeleton-shimmer h-4 w-full rounded-md" />
                <span className="skeleton-shimmer h-4 w-2/3 rounded-md" />
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <p className="text-base tracking-[-0.03em] text-[#71717b]">
                  Blocks is a growing library of design
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="text-base tracking-[-0.03em] text-[#71717b]">
                    resources created by
                  </p>
                  <a
                    href="https://lander.studio/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackLanderClick}
                    className="group flex items-center gap-1.5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="Lander Studio" src="/Lander_black.png" className="h-[13.6px] w-[10.7px]" />
                    <span className="text-base font-medium tracking-[-0.03em] text-[#09090b] group-hover:underline">
                      Lander Studio
                    </span>
                  </a>
                </div>
              </div>
            )}
          </div>

          {sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              open={openId === s.id}
              onToggle={() => toggleOpen(s.id)}
              selected={selected}
              onSelect={selectChip}
              sidebarCounts={counts}
            />
          ))}

          {/* Color search — hidden for Logos (logos aren't color-searchable).
              Gate on the gallery's active category, not the open accordion: a
              closed Logos accordion still shows logos, so the bar stays hidden.
              Animated via grid-rows (height) + scale/opacity (pop); -mt cancels
              the parent gap while collapsed so nothing leaves a hole. Keyed so
              it remounts fresh (clears picked swatches) when it returns. */}
          {(() => {
            const show = activeCategory !== "logos";
            return (
              <div
                className={`grid shrink-0 transition-all duration-300 ${
                  show
                    ? "grid-rows-[1fr] scale-100 opacity-100 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                    : "pointer-events-none -mt-4.5 grid-rows-[0fr] scale-90 opacity-0 ease-out"
                }`}
              >
                <div className="overflow-hidden">
                  <ColorSearch
                    key={show ? "color-search-on" : "color-search-off"}
                    onSearch={onColorSearch}
                    onClear={onColorClear}
                    onOpen={onColorPickerOpen}
                  />
                </div>
              </div>
            );
          })()}

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
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open profile"
          className="mt-2.5 flex w-full shrink-0 cursor-pointer items-center justify-between rounded-[10px] border border-[#e7e9ee] bg-white px-3 py-2 transition-colors hover:bg-[#fafafa]"
        >
          <span className="flex items-center gap-2">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={profile.avatar_url}
                referrerPolicy="no-referrer"
                className="size-[30px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-[30px] items-center justify-center rounded-full bg-[#09090b] text-sm font-medium text-white">
                {(profile?.full_name ?? "?").charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-base font-medium tracking-[-0.03em] text-[#09090b]">
              {profile?.full_name ?? "Account"}
            </span>
          </span>
          <span className="px-1 text-lg leading-none tracking-[-0.03em] text-[#71717b]">
            ⋮
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onLoginClick}
          className="mt-2.5 flex w-full shrink-0 cursor-pointer items-center justify-between rounded-[10px] border border-[#e7e9ee] bg-[rgba(123,113,113,0.05)] px-3 py-2 transition-colors hover:bg-[rgba(123,113,113,0.08)]"
        >
          <div className="flex items-center gap-2">
            <User size={18} strokeWidth={1.5} className="text-[#71717b]" />
            <span className="text-base tracking-[-0.03em] text-[#71717b]">
              Login to Copy
            </span>
          </div>
          <LogOut size={16} strokeWidth={1.5} className="text-[#71717b]" />
        </button>
      )}
    </aside>
  );
}
