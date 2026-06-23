"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ExternalLink, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ScrollFadeEffect } from "@/components/scroll-fade-effect";
import { XIcon, InstagramIcon, LinkedinIcon } from "@/components/social-icons";
import { useAuthStore, type Profile } from "@/store/authStore";
import { timeUntilMidnightIST } from "@/lib/ist";

// Username rule mirrors set_my_username() in the DB.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
type Availability =
  | "available"
  | "invalid"
  | "checking"
  | "taken"
  | "error"
  | "idle";

export default function AccountModal({
  open,
  onClose,
  onLogout,
  used,
  onBecomeCreator,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  used: number;
  // Generate/resolve the user's creator handle and navigate to their page.
  onBecomeCreator?: () => void;
}) {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const email = useAuthStore((s) => s.email);
  const setProfile = useAuthStore((s) => s.setProfile);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The richer account modal (editable name + handle, portal link) is shown to
  // creators AND to admins who've claimed a handle. Admins have NO daily cap, so
  // their limit shows as "Unlimited".
  const isAdmin = profile?.role === "admin";
  const isCreator =
    profile?.role === "creator" || (isAdmin && !!profile?.username);
  const unlimited = isAdmin;
  const LIMIT = isCreator && !unlimited ? 50 : 10;
  // The indicator is always 10 blocks; each block stands for LIMIT/10 copies
  // (1 for a regular user, 5 for a creator). Admins fill every block.
  const perBlock = LIMIT / 10;
  const filledBlocks = unlimited
    ? 10
    : Math.min(10, Math.floor(used / perBlock));

  // Editable creator fields. Seeded from the profile each time the modal opens.
  const supabase = createClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [remote, setRemote] = useState<{
    handle: string;
    result: "available" | "taken" | "error";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Socials + custom CTA. Handles are usernames (stored bare); website/cta are
  // edited WITHOUT the https:// prefix (prepended on save).
  const [xh, setXh] = useState("");
  const [ig, setIg] = useState("");
  const [li, setLi] = useState("");
  const [web, setWeb] = useState("");
  const [cta, setCta] = useState("");
  const stripScheme = (v: string | null | undefined) =>
    (v ?? "").replace(/^https?:\/\//i, "");
  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.full_name ?? "");
    setUsername(profile.username ?? "");
    setXh(profile.x_handle ?? "");
    setIg(profile.instagram_handle ?? "");
    setLi(profile.linkedin_handle ?? "");
    setWeb(stripScheme(profile.website_url));
    setCta(stripScheme(profile.cta_url));
    setRemote(null);
    setSaveError(null);
  }, [open, profile]);

  // A pasted link in a username field — usernames never contain / : or spaces.
  const looksLikeLink = (v: string) => /[/\s:]/.test(v) || /https?/i.test(v);
  const socialFieldError = looksLikeLink(xh)
    ? "X (Twitter) must be a username, not a link"
    : looksLikeLink(ig)
      ? "Instagram must be a username, not a link"
      : looksLikeLink(li)
        ? "LinkedIn must be a username, not a link"
        : null;
  // Normalize a url field to a full https:// link (or empty).
  const normUrl = (v: string) => {
    const s = v.trim().replace(/^https?:\/\//i, "");
    return s ? `https://${s}` : "";
  };
  const socialsChanged =
    xh !== (profile?.x_handle ?? "") ||
    ig !== (profile?.instagram_handle ?? "") ||
    li !== (profile?.linkedin_handle ?? "") ||
    normUrl(web) !== (profile?.website_url ?? "") ||
    normUrl(cta) !== (profile?.cta_url ?? "");

  const onChangeUsername = (raw: string) => {
    setUsername(
      raw
        .toLowerCase()
        .replace(/^@+/, "")
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 20),
    );
    setSaveError(null);
  };

  const usernameChanged = username !== (profile?.username ?? "");
  const formatValid = USERNAME_RE.test(username);

  // Debounced availability probe — only for creators, only when the handle
  // actually changed and is well-formed.
  useEffect(() => {
    if (!isCreator || !usernameChanged || !formatValid) return;
    let active = true;
    const id = setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_username_available", {
        uname: username,
      });
      if (!active) return;
      setRemote({
        handle: username,
        result: error ? "error" : data ? "available" : "taken",
      });
    }, 400);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [isCreator, usernameChanged, formatValid, username, supabase]);

  // Availability state, derived. Unchanged handle never gates the Save button.
  const avail: Availability = !usernameChanged
    ? "available"
    : username.length === 0
      ? "idle"
      : !formatValid
        ? "invalid"
        : remote?.handle === username
          ? remote.result
          : "checking";

  const nameChanged = name.trim() !== (profile?.full_name ?? "");
  const nameOk = name.trim().length >= 2;
  // Save stays disabled until there's a valid, available change to persist.
  const canSave =
    (usernameChanged || nameChanged || socialsChanged) &&
    nameOk &&
    avail === "available" &&
    !socialFieldError &&
    !saving;

  const onSave = async () => {
    if (!canSave || !profile) return;
    setSaving(true);
    setSaveError(null);
    // Claim the new handle first (DB-validated + race-safe).
    if (usernameChanged) {
      const { data, error } = await supabase.rpc("set_my_username", {
        uname: username,
      });
      if (error || !data?.ok) {
        setSaving(false);
        if (data?.error === "taken")
          setRemote({ handle: username, result: "taken" });
        else setSaveError("Couldn't save. Please try again.");
        return;
      }
    }
    if (nameChanged) {
      await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", profile.id);
    }
    if (socialsChanged) {
      const { error } = await supabase.rpc("set_my_socials", {
        p_x: xh,
        p_instagram: ig,
        p_linkedin: li,
        p_website: normUrl(web),
        p_cta: normUrl(cta),
      });
      if (error) {
        setSaving(false);
        setSaveError(error.message || "Couldn't save socials.");
        return;
      }
    }
    // Pull the fresh row so the store reflects both changes.
    const { data: fresh } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profile.id)
      .single();
    setSaving(false);
    if (fresh) setProfile(fresh as Profile);
    onClose();
  };

  // Pending-application flag is prefetched at sign-in (AuthProvider), so the
  // "Become Creator" section renders the instant the modal opens.
  const hasPendingApplication = useAuthStore((s) => s.pendingCreatorApp);
  // True for an existing OR revoked creator (approved application) — they should
  // not see the "Become a Creator" CTA.
  const wasCreator = useAuthStore((s) => s.wasCreator);

  // Live countdown to midnight IST — recalculated immediately and every 60s.
  const [reset, setReset] = useState(timeUntilMidnightIST());
  useEffect(() => {
    const tick = () => setReset(timeUntilMidnightIST());
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Avatar is the only editable image here. Upload to avatars/{uid}/… then
  // persist the public URL on the profile row.
  const onChangeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    const sb = createClient();
    const path = `${profile.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await sb.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (upErr) {
      setUploading(false);
      return;
    }
    const { data } = sb.storage.from("avatars").getPublicUrl(path);
    const { data: updated } = await sb
      .from("profiles")
      .update({ avatar_url: data.publicUrl })
      .eq("id", profile.id)
      .select("*")
      .single();
    if (updated) setProfile(updated as Profile);
    setUploading(false);
  };

  if (!open || typeof document === "undefined") return null;

  // Availability hint under the username field (creator view only).
  const usernameHint = (() => {
    if (!usernameChanged) return null;
    switch (avail) {
      case "invalid":
        return { text: "3–20 chars: letters, numbers, or underscores.", color: "#71717b" };
      case "checking":
        return { text: "Checking availability…", color: "#71717b" };
      case "available":
        return { text: `@${username} is available`, color: "#16a34a" };
      case "taken":
        return { text: `@${username} is already taken`, color: "#ff2f2f" };
      case "error":
        return { text: "Couldn't check right now. Try again.", color: "#ff2f2f" };
      default:
        return null;
    }
  })();

  const avatarBlock = (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      aria-label="Change profile picture"
      className="group relative flex size-14 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-[#f4f4f5] text-lg font-semibold text-[#09090b]"
    >
      {profile?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          src={profile.avatar_url}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        (profile?.full_name ?? "?").charAt(0).toUpperCase()
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
        {uploading ? (
          <span className="text-[10px] font-medium">…</span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        )}
      </span>
    </button>
  );

  const logoutBtn = (
    <button
      type="button"
      onClick={onLogout}
      aria-label="Log out"
      className="group relative flex size-10 cursor-pointer items-center justify-center rounded-full bg-[#FFE2E2] text-[#FF1313] transition-colors hover:bg-[#ffd0d0]"
    >
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#09090b] px-2 py-1 text-[12px] font-medium tracking-[-0.03em] text-white opacity-0 transition-opacity group-hover:opacity-100">
        Logout
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-[6px] border-transparent border-t-[#09090b]" />
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    </button>
  );

  const dailyLimit = (
    <div className="flex flex-col gap-[10px]">
      <span className="text-[16px] tracking-[-0.03em] text-[#09090b]">
        Daily Limit
      </span>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-[3px] rounded-[8px] border border-[#e4e4e7] bg-[#f9fafa] p-[4px]">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className={`h-[18px] flex-1 rounded-md ${
                i < filledBlocks
                  ? used >= LIMIT && !unlimited
                    ? "bg-[#FF2C2C]"
                    : "bg-[#2974ff]"
                  : "bg-[#ebebef]"
              }`}
            />
          ))}
        </div>
        <span className="whitespace-nowrap text-[14px] tracking-[-0.03em] text-[#09090b]">
          {unlimited ? "Unlimited" : `${used}/${LIMIT}`}
        </span>
      </div>
    </div>
  );

  const notice = (
    <div className="rounded-[8px] bg-[#fff0d6] px-[8px] py-[4px] text-[14px] text-[#CA8000]">
      {unlimited
        ? "Admin accounts have unlimited daily copies."
        : isCreator
          ? "Creator accounts include up to 50 daily copies, allowing you to create, test, and iterate more freely."
          : `Design copies are temporarily limited to ${LIMIT} per day while the platform is under development.`}
    </div>
  );

  const resetTimer = (
    <div className="flex items-center gap-1 text-[14px] tracking-[-0.03em] text-[#71717b]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      Limit resets in {reset.h}h {reset.m}m
    </div>
  );

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[440px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
      <ScrollFadeEffect className="flex flex-col gap-5 p-[28px]">
        {/* Identity — avatar is changeable */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {avatarBlock}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onChangeAvatar}
            />
            <div className="flex flex-col">
              <span className="text-[18px] font-semibold tracking-[-0.03em] text-[#09090b]">
                {profile?.full_name ?? "Account"}
              </span>
              <span className="text-[16px] tracking-[-0.03em] text-[#71717b]">
                {email ?? ""}
              </span>
            </div>
          </div>
          {logoutBtn}
        </div>

        {isCreator ? (
          <>
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaveError(null);
                }}
                placeholder="Your name"
                className="h-[36px] w-full rounded-[8px] border border-[#e5e5e5] px-[9px] text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575] focus:border-[#2974ff]"
              />
            </div>

            {/* Username */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                Username
              </label>
              <div className="flex h-[36px] items-center overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white focus-within:border-[#2974ff]">
                <span className="pl-[9px] text-[14px] tracking-[-0.03em] text-[#757575]">
                  @
                </span>
                <input
                  value={username}
                  onChange={(e) => onChangeUsername(e.target.value)}
                  placeholder="username"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-full w-full bg-transparent pl-[2px] pr-[9px] text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575]"
                />
              </div>
              {usernameHint && (
                <p className="text-[12px] tracking-[-0.03em]" style={{ color: usernameHint.color }}>
                  {usernameHint.text}
                </p>
              )}
            </div>

            {/* Socials — usernames only (X / Instagram / LinkedIn); website is a
                full link. Stored bare; the portal builds the public URLs. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                Socials
              </label>
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-[#e7e9ee]">
                <div className="group flex items-center gap-2 border-b border-[#e7e9ee] bg-[#f9f9fa] px-2.5 py-2">
                  <Globe
                    size={18}
                    className={`shrink-0 group-focus-within:text-black ${web ? "text-black" : "text-[#a3a3a3]"}`}
                  />
                  <input
                    value={web}
                    onChange={(e) => {
                      setWeb(e.target.value);
                      setSaveError(null);
                    }}
                    placeholder="yourwebsite.com"
                    autoComplete="off"
                    className="w-full bg-transparent text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                  />
                </div>
                <div className="group flex items-center gap-2 border-b border-[#e7e9ee] bg-[#f9f9fa] px-2.5 py-2">
                  <XIcon
                    size={17}
                    className={`shrink-0 group-focus-within:text-black ${xh ? "text-black" : "text-[#a3a3a3]"}`}
                  />
                  <input
                    value={xh}
                    onChange={(e) => {
                      setXh(e.target.value.replace(/^@+/, ""));
                      setSaveError(null);
                    }}
                    placeholder="username"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-transparent text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                  />
                </div>
                <div className="group flex items-center gap-2 border-b border-[#e7e9ee] bg-[#f9f9fa] px-2.5 py-2">
                  <InstagramIcon
                    size={17}
                    className={`shrink-0 group-focus-within:text-black ${ig ? "text-black" : "text-[#a3a3a3]"}`}
                  />
                  <input
                    value={ig}
                    onChange={(e) => {
                      setIg(e.target.value.replace(/^@+/, ""));
                      setSaveError(null);
                    }}
                    placeholder="username"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-transparent text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                  />
                </div>
                <div className="group flex items-center gap-2 bg-[#f9f9fa] px-2.5 py-2">
                  <LinkedinIcon
                    size={17}
                    className={`shrink-0 group-focus-within:text-black ${li ? "text-black" : "text-[#a3a3a3]"}`}
                  />
                  <input
                    value={li}
                    onChange={(e) => {
                      setLi(e.target.value.replace(/^@+/, ""));
                      setSaveError(null);
                    }}
                    placeholder="username"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-transparent text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                  />
                </div>
              </div>
              {socialFieldError && (
                <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                  {socialFieldError}
                </p>
              )}
            </div>

            {/* Custom CTA Link — https:// is fixed, user types the rest. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                Custom CTA Link
              </label>
              <div className="flex h-[36px] items-stretch overflow-hidden rounded-[8px] border border-[#e5e5e5] focus-within:border-[#2974ff]">
                <span className="flex items-center bg-white px-3 text-[14px] tracking-[-0.03em] text-[#a3a3a3]">
                  https://
                </span>
                <input
                  value={cta}
                  onChange={(e) => {
                    setCta(e.target.value);
                    setSaveError(null);
                  }}
                  placeholder="yoursite.com/link"
                  autoComplete="off"
                  className="w-full border-l border-[#ebebeb] bg-white px-3 text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                />
              </div>
            </div>

            {dailyLimit}
            {notice}
            {!unlimited && resetTimer}
            {saveError && (
              <p className="-mt-2 text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                {saveError}
              </p>
            )}

            {/* Save */}
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="w-full cursor-pointer rounded-[10px] bg-[#2974ff] py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>

            <div className="h-px w-full shrink-0 bg-[#e7e9ee]" />

            {/* Open Creator Portal */}
            <button
              type="button"
              onClick={() => {
                if (profile?.username) {
                  onClose();
                  router.push(`/creators/${profile.username}`);
                }
              }}
              className="flex min-h-[36px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#f5f5f5] px-4 py-2 text-[14px] tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#ececec]"
            >
              <ExternalLink size={16} strokeWidth={1.5} />
              Open Creator Portal
            </button>
          </>
        ) : (
          <>
            {dailyLimit}
            {notice}
            {resetTimer}

            {/* Become Creator — hidden while an application is in review, and
                while the pending-check is still loading (avoids a flash). */}
            {hasPendingApplication === false && !wasCreator && (
              <div className="flex flex-col gap-[6px]">
                <button
                  type="button"
                  onClick={onBecomeCreator}
                  className="flex min-h-[36px] w-fit cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#f5f5f5] px-4 py-2 text-[16px] tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#ececec]"
                >
                  <ExternalLink size={18} strokeWidth={1.5} />
                  Become Creator
                </button>
                <p className="text-[14px] text-[#1c9a00]">
                  Publish your own designs, earn creator perks, and unlock up to 50
                  daily copies.
                </p>
              </div>
            )}
          </>
        )}
      </ScrollFadeEffect>
      </div>
    </div>,
    document.body,
  );
}
