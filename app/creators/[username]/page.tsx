"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { revalidateSidebarCounts } from "@/app/actions";
import { useAuthStore } from "@/store/authStore";
import { cloudflareThumb, cloudflareLogo } from "@/lib/utils";
import { todayIST } from "@/lib/ist";
import AccountModal from "@/app/components/AccountModal";
import EditProfileModal from "@/app/components/EditProfileModal";

type Creator = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  created_at: string;
  x_handle?: string | null;
  instagram_handle?: string | null;
  linkedin_handle?: string | null;
  website_url?: string | null;
  cta_url?: string | null;
};

type Design = {
  id: string;
  category: string | null;
  section: string | null;
  preview_url: string | null;
  aspect_ratio: number | null;
  figma_url: string | null;
  status: "pending" | "approved" | "rejected";
  is_private: boolean;
  is_published: boolean;
  created_at: string;
  copy_count: number;
  featured?: boolean;
  // Per-creator manual order; most-recently-pinned leads. Null = unpinned.
  creator_pinned_at?: string | null;
  // Admin's note when status = 'rejected' — shown as a tooltip on the tag.
  rejection_reason?: string | null;
};

type SortKey = "newest" | "oldest" | "most_copied" | "private" | "public";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "most_copied", label: "Most copied" },
  { key: "private", label: "Private blocks" },
  { key: "public", label: "Public View" },
];

// Tab label <-> public.components.category (DB value).
const TABS = [
  { db: "Website", label: "Websites" },
  { db: "Mobile Apps", label: "Mobile" },
  { db: "Dashboard", label: "Dashboard" },
  { db: "Logos", label: "Logo" },
  { db: "Illustrations", label: "Illustrations" },
] as const;

const STATUS: Record<Design["status"], { dot: string; label: string }> = {
  pending: { dot: "#f5a623", label: "Pending" },
  approved: { dot: "#1c9a00", label: "Approved" },
  rejected: { dot: "#ef4444", label: "Rejected" },
};

// Render this many designs first; load PAGE more each time the bottom sentinel
// scrolls into view. Keeps the DOM small for creators with many components.
const PAGE = 24;

// Portal cache (localStorage) — keyed by username + viewer id (the design set
// differs for the owner/admin vs a visitor). Lets a revisit paint instantly
// while a fresh copy is refetched in the background.
const PORTAL_CACHE_KEY = "creator_portal_v2";
const PORTAL_TTL = 5 * 60 * 1000;

type PortalEntry = { ts: number; creator: Creator; designs: Design[] };

function readPortalCache(key: string): PortalEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PORTAL_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, PortalEntry>;
    const entry = map[key];
    if (!entry || Date.now() - entry.ts > PORTAL_TTL) return null;
    return entry;
  } catch {
    return null;
  }
}

function writePortalCache(key: string, creator: Creator, designs: Design[]) {
  if (typeof window === "undefined") return;
  const entry: PortalEntry = { ts: Date.now(), creator, designs };
  try {
    const raw = localStorage.getItem(PORTAL_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, PortalEntry>) : {};
    map[key] = entry;
    localStorage.setItem(PORTAL_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Quota — keep only this entry.
    try {
      localStorage.setItem(PORTAL_CACHE_KEY, JSON.stringify({ [key]: entry }));
    } catch {
      // give up silently
    }
  }
}

export default function CreatorPage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = params.username;

  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  const [creator, setCreator] = useState<Creator | null>(null);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  // True once the design set is known (from cache or fetch) — gates the grid
  // skeletons vs the empty state.
  const [designsLoaded, setDesignsLoaded] = useState(false);
  // How many of the filtered/sorted designs are currently rendered.
  const [shown, setShown] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<string>(TABS[0].db);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [sortOpen, setSortOpen] = useState(false);

  const [showAccount, setShowAccount] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  // Delete confirmation — id awaiting confirmation (null = closed).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Rejection-reason tooltip — rendered in a portal (document.body) so it's never
  // clipped or stacked under a card. Holds the anchor position + the message.
  const [rejectTip, setRejectTip] = useState<{
    top: number;
    left: number;
    text: string;
  } | null>(null);

  // Owner chrome (publish/edit/delete/privacy) shows for the creator viewing
  // their OWN page, and for any admin viewing ANYONE's page (admins have full
  // rights everywhere).
  const isOwner =
    !!profile &&
    !!creator &&
    (profile.id === creator.id || profile.role === "admin");
  const used =
    profile && profile.last_copy_date === todayIST()
      ? profile.copies_today ?? 0
      : 0;

  // Re-pull just the designs (owner/admin see all; visitors see only live).
  // Used on mount and whenever something changes (realtime / tab refocus) so
  // status pills (pending → approved/rejected) stay current without a reload.
  // Cache key — design set differs per viewer (owner/admin see all).
  const cacheKey = `${username}:${profile?.id ?? "anon"}`;

  const refetchDesigns = useCallback(async () => {
    const { data, error } = await createClient().rpc("get_creator_designs", {
      uname: username,
    });
    if (error) {
      console.error("[creator] get_creator_designs:", error.message);
      return;
    }
    setDesigns((data as Design[] | null) ?? []);
  }, [username]);

  // Re-pull just the creator profile (e.g. after the owner edits socials/bio in
  // the account modal) so the header + social links update without a reload.
  const refetchCreator = useCallback(async () => {
    const { data } = await createClient().rpc("get_creator", {
      uname: username,
    });
    const c = (data as Creator | null) ?? null;
    if (c) setCreator(c);
  }, [username]);

  // Load the real creator (public get_creator RPC) + their designs. Cache-first:
  // a fresh (<5 min) cached portal paints instantly, then a background refetch
  // updates it. Re-runs when the viewer's identity resolves so owner/admin get
  // the full set once their profile loads.
  useEffect(() => {
    let active = true;

    const cached = readPortalCache(cacheKey);
    if (cached) {
      setCreator(cached.creator);
      setDesigns(cached.designs);
      setDesignsLoaded(true);
      setLoading(false);
    }

    (async () => {
      const supabase = createClient();
      const [{ data: creatorJson }, { data: designRows }] = await Promise.all([
        supabase.rpc("get_creator", { uname: username }),
        supabase.rpc("get_creator_designs", { uname: username }),
      ]);
      if (!active) return;
      let c = (creatorJson as Creator | null) ?? null;
      // Fallback: you're viewing your OWN handle but the public lookup came back
      // empty (e.g. the row was just created this session) — build the creator
      // from the signed-in profile so the owner always sees their portal instead
      // of "Creator not found".
      if (!c && profile?.username && profile.username === username) {
        c = {
          id: profile.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
          username: profile.username,
          bio: profile.bio ?? null,
          created_at: profile.created_at,
          x_handle: profile.x_handle ?? null,
          instagram_handle: profile.instagram_handle ?? null,
          linkedin_handle: profile.linkedin_handle ?? null,
          website_url: profile.website_url ?? null,
          cta_url: profile.cta_url ?? null,
        };
      }
      const rows = (designRows as Design[] | null) ?? [];
      setCreator(c);
      setDesigns(rows);
      setDesignsLoaded(true);
      setLoading(false);
      if (c) writePortalCache(cacheKey, c, rows);
    })();
    return () => {
      active = false;
    };
  }, [username, profile?.id, cacheKey]);

  // Keep statuses live: refetch when an admin approves/rejects a design.
  // Realtime fires instantly (requires the `components` table to be in the
  // realtime publication); a tab-refocus refetch is the fallback that always
  // works (e.g. the creator uploads, comes back to the tab → fresh statuses).
  useEffect(() => {
    if (!creator?.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`creator-designs-${creator.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "components",
          filter: `uploaded_by=eq.${creator.id}`,
        },
        () => refetchDesigns(),
      )
      .subscribe();

    const onFocus = () => {
      if (document.visibilityState === "visible") refetchDesigns();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [creator?.id, refetchDesigns]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete;
    setConfirmDelete(null);
    const removed = designs.find((x) => x.id === id);
    setDesigns((d) => d.filter((x) => x.id !== id)); // optimistic
    const { data, error } = await createClient().rpc("delete_design", {
      design_id: id,
    });
    if ((error || !data) && removed) {
      setDesigns((d) => [removed, ...d]); // revert
    } else {
      // Deleting a published design changes the global gallery counts — mark the
      // server-cached sidebar counts stale so the home page shows fresh numbers.
      revalidateSidebarCounts().catch(() => {});
    }
  };

  // Eye open = public, eye crossed = private. Optimistic, reverted on failure.
  const togglePrivate = async (id: string) => {
    const target = designs.find((x) => x.id === id);
    if (!target) return;
    const nextPrivate = !target.is_private;
    setDesigns((d) =>
      d.map((x) => (x.id === id ? { ...x, is_private: nextPrivate } : x)),
    );
    const { data, error } = await createClient().rpc("set_design_privacy", {
      design_id: id,
      make_private: nextPrivate,
    });
    if (error || !data) {
      setDesigns((d) =>
        d.map((x) => (x.id === id ? { ...x, is_private: !nextPrivate } : x)),
      );
    } else {
      // Privacy change adds/removes the design from the public gallery → refresh
      // the server-cached sidebar counts.
      revalidateSidebarCounts().catch(() => {});
    }
  };

  // Manual arrange — pin a block to the front so visitors see the creator's
  // preferred order. Persists via creator_pinned_at; the home gallery reflects
  // the same order when this creator is selected. Optimistic + revert on failure.
  const pinToTop = async (id: string) => {
    const target = designs.find((x) => x.id === id);
    if (!target) return;
    const prev = target.creator_pinned_at ?? null;
    const stamp = new Date().toISOString();
    setDesigns((d) =>
      d.map((x) => (x.id === id ? { ...x, creator_pinned_at: stamp } : x)),
    );
    const { data, error } = await createClient().rpc("pin_creator_design", {
      design_id: id,
    });
    if (error || !data) {
      setDesigns((d) =>
        d.map((x) => (x.id === id ? { ...x, creator_pinned_at: prev } : x)),
      );
    }
  };

  const logout = async () => {
    setShowAccount(false);
    await createClient().auth.signOut();
    setProfile(null);
    useAuthStore.persist.clearStorage();
    router.push("/");
  };

  const becomeCreator = () => {
    setShowAccount(false);
    router.push("/creator-rules");
  };

  // Which designs a given sort/view includes. "Private blocks" = the creator's
  // private ones; "Public View" = exactly what a visitor sees (approved, public,
  // published); every other sort shows all.
  const matchesView = (d: Design) =>
    sortBy === "private"
      ? d.is_private
      : sortBy === "public"
        ? d.status === "approved" && !d.is_private && d.is_published
        : true;

  // Tab badge counts respect the active view, so Public View shows only the
  // publicly-visible count per category.
  const tabCount = (db: string) =>
    designs.filter((d) => d.category === db && matchesView(d)).length;

  // Show every category tab, even empty ones (each shows its 0 count and an
  // empty state when selected).
  const visibleTabs = TABS;

  // Keep the active tab valid as the visible set changes. Adjusting state during
  // render (React's documented pattern) instead of in an effect avoids an extra
  // commit + the set-state-in-effect cascade.
  if (visibleTabs.length && !visibleTabs.some((t) => t.db === activeTab)) {
    setActiveTab(visibleTabs[0].db);
  }

  // Sliding active-tab indicator — measure the active button and animate the
  // highlight between tabs instead of snapping.
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current[activeTab];
      if (!el || el.offsetWidth === 0) return;
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
      setIndicatorReady(true);
    };
    // rAF so the measurement runs after the tabs have laid out (designs load
    // after mount, fonts settle), otherwise offsetWidth can read 0.
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
    };
  }, [activeTab, designs]);

  const visible = designs
    .filter((d) => d.category === activeTab)
    .filter(matchesView)
    .sort((a, b) => {
      // The creator's manual order leads — pinned blocks first (newest pin on
      // top), mirroring how the home gallery shows this creator. Applies to the
      // default sorts; explicit oldest/most_copied override it.
      if (sortBy === "newest" || sortBy === "public" || sortBy === "private") {
        const ap = a.creator_pinned_at ?? "";
        const bp = b.creator_pinned_at ?? "";
        if (ap !== bp) return bp.localeCompare(ap); // pinned-desc, unpinned last
      }
      if (sortBy === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sortBy === "most_copied") return b.copy_count - a.copy_count;
      // newest (default; also the within-group order for Public View)
      return b.created_at.localeCompare(a.created_at);
    });

  // Only render the first `shown` of the filtered/sorted set; the rest load as
  // the sentinel scrolls into view.
  const paged = visible.slice(0, shown);

  // Reset pagination whenever the category/sort changes.
  useEffect(() => {
    setShown(PAGE);
  }, [activeTab, sortBy]);

  // Infinite scroll — reveal PAGE more designs as the bottom sentinel nears.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShown((s) => (s < visible.length ? s + PAGE : s));
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible.length]);

  // Public View previews exactly what a visitor sees — no owner chrome (status,
  // privacy pill, pin/edit/delete actions).
  const showOwnerChrome = isOwner && sortBy !== "public";

  // Logos render as square, padded, contained cards (matching the home gallery's
  // logos layout) instead of the masonry object-cover thumbnails.
  const isLogosTab = activeTab === "Logos";

  // First load with nothing cached — show a skeleton of the whole portal
  // instead of a bare "Loading…".
  if (loading && !creator) {
    return (
      <main className="min-h-screen bg-white font-sans">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[30px] px-6 py-10 sm:px-12 sm:py-[60px]">
          <div className="h-9 w-24 animate-pulse rounded-[10px] bg-[#ebebef]" />
          <div className="flex flex-col gap-[26px]">
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <div className="size-[90px] shrink-0 animate-pulse rounded-[20px] bg-[#ebebef]" />
                <div className="flex flex-col gap-2">
                  <div className="h-6 w-40 animate-pulse rounded-md bg-[#ebebef]" />
                  <div className="h-4 w-24 animate-pulse rounded-md bg-[#ebebef]" />
                </div>
              </div>
              <div className="h-4 w-[320px] max-w-full animate-pulse rounded-md bg-[#ebebef]" />
            </div>
            <div className="h-10 w-full max-w-[420px] animate-pulse rounded-[10px] bg-[#f5f5f5]" />
            <div className="columns-1 gap-[22px] sm:columns-2 lg:columns-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="mb-[22px] break-inside-avoid animate-pulse rounded-[12px] bg-[#ebebef]"
                  style={{ height: 180 + (i % 3) * 70 }}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!creator) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white font-sans">
        <p className="text-[16px] tracking-[-0.03em] text-[#71717b]">
          Creator not found.
        </p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="cursor-pointer rounded-[10px] bg-[#09090b] px-5 py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
        >
          Back home
        </button>
      </main>
    );
  }

  const initial = (creator.full_name ?? "?").charAt(0).toUpperCase();

  return (
    <main className="min-h-screen bg-white font-sans">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[30px] px-6 py-10 sm:px-12 sm:py-[60px]">
        {/* Go Back */}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex w-fit cursor-pointer items-center gap-1 rounded-[10px] border border-[#ebebeb] bg-white px-2 py-2 text-[14px] tracking-[-0.03em] text-[#71717b] shadow-[0px_1px_2px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#fafafa]"
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
          <span className="px-1">Go Back</span>
        </button>

        <div className="flex flex-col gap-[26px]">
          {/* Identity — boxed profile card */}
          {(() => {
            const hasSocials =
              !!creator.website_url ||
              !!creator.x_handle ||
              !!creator.instagram_handle ||
              !!creator.linkedin_handle;
            const socialCls =
              "flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#52525b] shadow-[0px_1px_2px_rgba(10,13,20,0.04)] transition-colors hover:text-black hover:bg-[#fafafa]";
            return (
          <div className="flex w-full max-w-[460px] flex-col gap-5 rounded-[24px] bg-[#f5f5f5] p-4">
            {/* Row: avatar + name (grows) + edit profile */}
            <div className="flex w-full items-start gap-5">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <button
                  type="button"
                  onClick={() => isOwner && setShowEditProfile(true)}
                  aria-label={isOwner ? "Edit profile" : undefined}
                  className={`group relative size-[90px] shrink-0 overflow-hidden rounded-[14px] bg-[#ebebef] ${
                    isOwner ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  {creator.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      src={creator.avatar_url}
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-[32px] font-medium text-[#09090b]">
                      {initial}
                    </span>
                  )}
                </button>
                <div className="flex min-w-0 flex-col justify-center">
                  <p className="truncate text-[24px] font-medium tracking-[-0.03em] text-black">
                    {creator.full_name ?? "Creator"}
                  </p>
                  <p className="truncate text-[16px] tracking-[-0.03em] text-[#71717b]">
                    @{creator.username}
                  </p>
                </div>
              </div>

              {isOwner && (
                <button
                  type="button"
                  onClick={() => setShowEditProfile(true)}
                  className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#e7e9ee] bg-white px-2.5 py-1.5 text-[16px] tracking-[-0.03em] text-black transition-colors hover:bg-[#fafafa]"
                >
                  <Pencil size={14} strokeWidth={1.5} />
                  Edit Profile
                </button>
              )}
            </div>

            {/* Bio + action row */}
            <div className="flex w-full flex-col gap-3.5">
              {/* Bio — read-only on the card. Editing happens in the
                  Edit Profile modal. No bio + owner → "No bio yet" + pencil. */}
              {creator.bio ? (
                <p className="w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[16px] tracking-[-0.03em] text-black">
                  {creator.bio}
                </p>
              ) : isOwner ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[16px] tracking-[-0.03em] text-[#a1a1aa]">
                    No bio yet
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowEditProfile(true)}
                    aria-label="Add bio"
                    className="inline-flex translate-y-px cursor-pointer text-[#71717b] transition-colors hover:text-[#09090b]"
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                  </button>
                </div>
              ) : (
                <p className="text-[16px] tracking-[-0.03em] text-[#a1a1aa]">
                  No bio added
                </p>
              )}

              {/* Hire Creator (grows, disabled until a link is set) + socials */}
              <div className="flex w-full items-center gap-3.5">
                  {creator.cta_url ? (
                    <a
                      href={creator.cta_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-px flex-1 items-center justify-center gap-1 rounded-[10px] bg-[#2974ff] px-1.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e0]"
                    >
                      Hire Creator
                      <ExternalLink size={14} strokeWidth={1.75} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex min-w-px flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-[10px] bg-[#2974ff] px-1.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-white opacity-50"
                    >
                      Hire Creator
                      <ExternalLink size={14} strokeWidth={1.75} />
                    </button>
                  )}
                  {hasSocials && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {creator.website_url && (
                        <a
                          href={creator.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Website"
                          className={socialCls}
                        >
                          <Globe size={17} strokeWidth={1.5} />
                        </a>
                      )}
                      {creator.x_handle && (
                        <a
                          href={`https://x.com/${creator.x_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="X"
                          className={socialCls}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/x.svg" alt="" className="size-[18px]" />
                        </a>
                      )}
                      {creator.instagram_handle && (
                        <a
                          href={`https://instagram.com/${creator.instagram_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Instagram"
                          className={socialCls}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/insta.svg" alt="" className="size-[18px]" />
                        </a>
                      )}
                      {creator.linkedin_handle && (
                        <a
                          href={`https://linkedin.com/in/${creator.linkedin_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="LinkedIn"
                          className={socialCls}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/linkedin.svg" alt="" className="size-[18px]" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
            </div>
          </div>
            );
          })()}

          {/* Action bar: publish + tabs + sort */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {isOwner ? (
              <button
                type="button"
                onClick={() => router.push("/upload")}
                className="flex cursor-pointer items-center gap-1 rounded-[10px] bg-[#f5f5f5] px-3 py-2 text-[14px] tracking-[-0.03em] text-black transition-colors hover:bg-[#ececec]"
              >
                <Plus size={16} strokeWidth={1.5} />
                <span className="px-1">Publish New Design</span>
              </button>
            ) : (
              <span />
            )}

            {visibleTabs.length > 0 && (
            <div className="relative flex items-center gap-1 rounded-[10px] bg-[#f5f5f5] p-1">
              {/* Sliding highlight behind the active tab */}
              <span
                aria-hidden
                style={{ left: indicator.left, width: indicator.width }}
                className={`absolute top-1 bottom-1 rounded-[8px] bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.1)] ${
                  indicatorReady ? "transition-[left,width] duration-300 ease-out" : ""
                }`}
              />
              {visibleTabs.map((t) => {
                const active = activeTab === t.db;
                return (
                  <button
                    key={t.db}
                    ref={(el) => {
                      tabRefs.current[t.db] = el;
                    }}
                    type="button"
                    onClick={() => setActiveTab(t.db)}
                    className="relative z-10 flex min-h-[29px] cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[14px] font-medium tracking-[-0.03em] text-[#0a0a0a]"
                  >
                    {t.label}
                    <span
                      className={`flex h-[15px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-black transition-colors ${
                        active ? "bg-[#f5f5f5]" : "bg-white"
                      }`}
                    >
                      {tabCount(t.db)}
                    </span>
                  </button>
                );
              })}
            </div>
            )}

            {/* Sort is an owner/admin tool, and only useful once there's
                something to sort. Hidden for non-owners and empty portals. */}
            {isOwner && designs.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSortOpen((o) => !o)}
                className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-[8px] bg-[#f5f5f5] px-4 py-2 text-[14px] font-medium tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#ececec]"
              >
                <ArrowUpDown size={16} strokeWidth={1.5} />
                Sort By
              </button>

              {sortOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setSortOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 flex w-[180px] flex-col overflow-hidden rounded-[12px] border border-[#e7e9ee] bg-white p-1 shadow-[0px_10px_5px_rgba(0,0,0,0.04),0px_2px_2.5px_rgba(0,0,0,0.04)]">
                    {SORT_OPTIONS.map((o) => {
                      const active = sortBy === o.key;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => {
                            setSortBy(o.key);
                            setSortOpen(false);
                          }}
                          className="flex items-center justify-between rounded-[8px] px-2.5 py-2 text-[14px] tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#f5f5f5]"
                        >
                          {o.label}
                          {active && (
                            <Check size={16} strokeWidth={2} className="text-[#2974ff]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            ) : (
              <span />
            )}
          </div>

          {/* Designs */}
          {!designsLoaded ? (
            // Grid skeleton while the (uncached) design set loads.
            <div className="columns-1 gap-[22px] sm:columns-2 lg:columns-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="mb-[22px] break-inside-avoid animate-pulse rounded-[12px] bg-[#ebebef]"
                  style={{ height: 180 + (i % 3) * 70 }}
                />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#e7e9ee] px-6 text-center">
              <p className="text-[15px] font-medium tracking-[-0.03em] text-[#09090b]">
                {sortBy === "public"
                  ? "No published designs in this category"
                  : isOwner
                    ? "Nothing here yet"
                    : "No designs published yet"}
              </p>
              <p className="text-[14px] tracking-[-0.03em] text-[#a1a1aa]">
                {sortBy === "public"
                  ? "Once your designs are approved and public, they'll appear here exactly as visitors see them."
                  : isOwner
                    ? "Publish a design in this category and it will appear here."
                    : "This creator hasn't published any designs yet."}
              </p>
            </div>
          ) : (
            <>
            <div
              className={
                isLogosTab
                  ? "grid grid-cols-1 gap-[22px] sm:grid-cols-2 lg:grid-cols-3"
                  : "columns-1 gap-[22px] sm:columns-2 lg:columns-3"
              }
            >
              {paged.map((d) => (
                <div
                  key={d.id}
                  className={`flex flex-col gap-1.5 rounded-[12px] p-1.5 ${
                    isLogosTab ? "" : "mb-[22px] break-inside-avoid"
                  }`}
                >
                  {/* Status (owner only). Rejected shows a tooltip on hover
                      with the admin's reason. */}
                  {showOwnerChrome && (
                    <div
                      className="flex w-fit items-center gap-1.5 py-1.5"
                      onMouseEnter={
                        d.status === "rejected"
                          ? (e) => {
                              const r =
                                e.currentTarget.getBoundingClientRect();
                              setRejectTip({
                                top: r.top,
                                left: r.left,
                                text: d.rejection_reason?.trim()
                                  ? d.rejection_reason
                                  : "No reason provided.",
                              });
                            }
                          : undefined
                      }
                      onMouseLeave={
                        d.status === "rejected"
                          ? () => setRejectTip(null)
                          : undefined
                      }
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: STATUS[d.status].dot }}
                      />
                      <span className="text-[14px] tracking-[-0.03em] text-black">
                        {STATUS[d.status].label}
                      </span>
                    </div>
                  )}

                  <div className="group relative">
                    {isLogosTab ? (
                      // Square, padded, contained — matches the home gallery's
                      // 3-col logos layout.
                      <div
                        className="relative flex w-full items-center justify-center overflow-hidden rounded-[6px] border border-[#e7e9ee] bg-white"
                        style={{ aspectRatio: "1 / 1", padding: 48 }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          src={cloudflareLogo(d.preview_url ?? "")}
                          className="size-full object-contain"
                        />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        src={cloudflareThumb(d.preview_url ?? "")}
                        style={
                          d.aspect_ratio
                            ? { aspectRatio: String(d.aspect_ratio) }
                            : undefined
                        }
                        className="w-full rounded-[6px] border border-[#f5f5f5] object-cover"
                      />
                    )}

                    {/* Privacy pill — shown by default (owner) */}
                    {isOwner && (
                      <span className="absolute bottom-3 left-3 rounded-[59px] bg-black/20 px-[18px] py-1.5 text-[14px] tracking-[-0.03em] text-white backdrop-blur-[2px]">
                        {d.is_private ? "Private" : "Public"}
                      </span>
                    )}

                    {/* Send to top — alone, top-right. Pins the block first so
                        visitors see the creator's preferred order. Approved
                        designs only (pending/rejected can't be ordered/shown). */}
                    {isOwner && d.status === "approved" && (
                      <button
                        type="button"
                        onClick={() => pinToTop(d.id)}
                        aria-label="Send to top"
                        className="absolute right-3 top-3 flex h-9 w-[50px] cursor-pointer items-center justify-center rounded-full bg-[#f5f5f5] text-[#171717] opacity-0 transition-opacity duration-200 hover:bg-[#ececec] group-hover:opacity-100"
                      >
                        <ArrowUp size={16} strokeWidth={1.5} />
                      </button>
                    )}

                    {/* Owner actions — revealed on hover */}
                    {isOwner && (
                      <div className="absolute bottom-3 right-3 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => togglePrivate(d.id)}
                          aria-label={d.is_private ? "Make public" : "Make private"}
                          className="flex h-9 w-[50px] cursor-pointer items-center justify-center rounded-full bg-[#f5f5f5] text-[#171717] transition-colors hover:bg-[#ececec]"
                        >
                          {d.is_private ? (
                            <EyeOff size={16} strokeWidth={1.5} />
                          ) : (
                            <Eye size={16} strokeWidth={1.5} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/upload/${d.id}/edit`)}
                          aria-label="Edit design"
                          className="flex h-9 w-[50px] cursor-pointer items-center justify-center rounded-full bg-[#f5f5f5] text-[#171717] transition-colors hover:bg-[#ececec]"
                        >
                          <Pencil size={16} strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(d.id)}
                          aria-label="Delete design"
                          className="flex h-9 w-[50px] cursor-pointer items-center justify-center rounded-full bg-[#ffdede] text-[#ef4444] transition-colors hover:bg-[#ffcaca]"
                        >
                          <Trash2 size={16} strokeWidth={1.5} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Infinite-scroll sentinel — pulls in PAGE more on approach. */}
            {shown < visible.length && (
              <div ref={sentinelRef} className="h-10 w-full" />
            )}
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation — mirrors the homepage gallery modal */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-[360px] flex-col gap-2 rounded-2xl bg-white p-6 shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
          >
            <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[#09090b]">
              Are you sure?
            </h2>
            <p className="text-[14px] leading-5 tracking-[-0.03em] text-[#71717b]">
              This will permanently delete this design. This action cannot be
              undone.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="cursor-pointer rounded-lg border border-[#e4e4e7] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-[#52525b] transition-colors hover:bg-[#fafafa]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                className="cursor-pointer rounded-lg bg-[#ef4444] px-3.5 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#dc2626]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection-reason tooltip — portal'd to body so it floats above
          everything and is never clipped by a card/column. Sits above the
          rejected tag with a caret pointing down to it. */}
      {rejectTip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: rejectTip.top - 8,
              left: rejectTip.left - 24,
              transform: "translateY(-100%)",
            }}
            className="pointer-events-none z-[9999] w-[200px] rounded-[10px] bg-[#18181b] px-3 py-2 text-[13px] leading-[18px] tracking-[-0.03em] text-white shadow-[0px_8px_24px_rgba(0,0,0,0.18)]"
          >
            <span className="absolute -bottom-1 left-[25px] size-2 rotate-45 rounded-[1px] bg-[#18181b]" />
            {rejectTip.text}
          </div>,
          document.body,
        )}

      <AccountModal
        open={showAccount}
        onClose={() => setShowAccount(false)}
        onLogout={logout}
        used={used}
        onBecomeCreator={becomeCreator}
      />

      <EditProfileModal
        open={showEditProfile}
        onClose={() => {
          setShowEditProfile(false);
          // Pick up any name/bio/socials/CTA the owner just edited.
          refetchCreator();
        }}
      />
    </main>
  );
}
