"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { replaceAvatar } from "@/lib/avatar";
import { ScrollFadeEffect } from "@/components/scroll-fade-effect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore, type Profile } from "@/store/authStore";

// Username rule mirrors set_my_username() in the DB.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Social fields accept a FULL profile link; we store the bare handle (the card
// rebuilds the public URL). Each must be an https:// URL on the matching domain.
type SocialKind = "x" | "instagram" | "linkedin";
const SOCIALS: Record<
  SocialKind,
  { label: string; keyword: string; build: (h: string) => string }
> = {
  x: { label: "X", keyword: "x.com", build: (h) => `https://x.com/${h}` },
  instagram: {
    label: "Instagram",
    keyword: "instagram.com",
    build: (h) => `https://instagram.com/${h}`,
  },
  linkedin: {
    label: "LinkedIn",
    keyword: "linkedin.com",
    build: (h) => `https://linkedin.com/in/${h}`,
  },
};

// Pull the bare handle out of a full profile URL ("" if unparseable).
const parseHandle = (url: string, kind: SocialKind): string => {
  try {
    const parts = new URL(url.trim()).pathname.split("/").filter(Boolean);
    if (kind === "linkedin") {
      const i = parts.indexOf("in");
      return ((i >= 0 ? parts[i + 1] : parts[0]) ?? "").replace(/^@/, "");
    }
    return (parts[0] ?? "").replace(/^@/, "");
  } catch {
    return "";
  }
};

// Validate a social link: empty is OK; otherwise must be https and on-domain
// with a usable handle. Returns an error string or null.
const socialUrlError = (value: string, kind: SocialKind): string | null => {
  const s = value.trim();
  if (!s) return null;
  const { label, keyword } = SOCIALS[kind];
  if (!/^https:\/\//i.test(s)) return `${label} link must start with https://`;
  if (!s.toLowerCase().includes(keyword))
    return `${label} link must be a ${keyword} URL`;
  if (!parseHandle(s, kind)) return `Add your ${label} profile to the link`;
  return null;
};
type Availability =
  | "available"
  | "invalid"
  | "checking"
  | "taken"
  | "error"
  | "idle";

// The full profile editor — name, username (with live availability check), bio,
// socials, and the Hire-Creator CTA. All writes are server-validated via the
// same RPCs the account view used (set_my_username / set_my_socials /
// update_creator_bio). Opened from the "Edit Profile" button on the portal.
export default function EditProfileModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const supabase = createClient();

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Editable fields. Seeded from the profile each time the modal opens.
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [remote, setRemote] = useState<{
    handle: string;
    result: "available" | "taken" | "error";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  // Per-section errors — each shows directly under its own field, not at the
  // bottom of the modal.
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [socialsError, setSocialsError] = useState<string | null>(null);
  // Link-validation errors stay hidden until the first Save attempt — typing a
  // half-finished URL shouldn't flash a red error on every keystroke.
  const [attempted, setAttempted] = useState(false);

  // Socials + custom CTA. X/IG/LinkedIn are edited as FULL profile links and
  // stored as bare handles; website/cta are edited WITHOUT the https:// prefix.
  const [xh, setXh] = useState("");
  const [ig, setIg] = useState("");
  const [li, setLi] = useState("");
  const [web, setWeb] = useState("");
  const [cta, setCta] = useState("");

  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.full_name ?? "");
    setUsername(profile.username ?? "");
    setBio(profile.bio ?? "");
    setXh(profile.x_handle ? SOCIALS.x.build(profile.x_handle) : "");
    setIg(
      profile.instagram_handle
        ? SOCIALS.instagram.build(profile.instagram_handle)
        : "",
    );
    setLi(
      profile.linkedin_handle
        ? SOCIALS.linkedin.build(profile.linkedin_handle)
        : "",
    );
    setWeb(profile.website_url ?? "");
    setCta(profile.cta_url ?? "");
    setRemote(null);
    setAvatarError(null);
    setUsernameError(null);
    setBioError(null);
    setSocialsError(null);
    setAttempted(false);
  }, [open, profile]);

  // Website + Hire-Creator take a full link — must be https (no domain rule).
  const httpsError = (v: string, label: string) =>
    !v.trim() || /^https:\/\//i.test(v.trim())
      ? null
      : `${label} link must start with https://`;

  // Per-field link validation (https + on-domain + has a handle). Split so each
  // message renders under its own section: the socials box (web/x/ig/li) vs the
  // separate Hire-Creator CTA field.
  const socialBoxError =
    socialUrlError(xh, "x") ??
    socialUrlError(ig, "instagram") ??
    socialUrlError(li, "linkedin") ??
    httpsError(web, "Website");
  const ctaError = httpsError(cta, "Hire Creator");
  const socialFieldError = socialBoxError ?? ctaError;

  // Bare handles parsed from the link fields — what we persist.
  const xHandle = parseHandle(xh, "x");
  const igHandle = parseHandle(ig, "instagram");
  const liHandle = parseHandle(li, "linkedin");

  // Change-detection compares the RAW link inputs against their seeded values
  // so an invalid (still-being-typed) link counts as a change — that keeps Save
  // enabled so the user can submit and see the validation error.
  const xSeed = profile?.x_handle ? SOCIALS.x.build(profile.x_handle) : "";
  const igSeed = profile?.instagram_handle
    ? SOCIALS.instagram.build(profile.instagram_handle)
    : "";
  const liSeed = profile?.linkedin_handle
    ? SOCIALS.linkedin.build(profile.linkedin_handle)
    : "";
  const socialsChanged =
    xh.trim() !== xSeed ||
    ig.trim() !== igSeed ||
    li.trim() !== liSeed ||
    web.trim() !== (profile?.website_url ?? "") ||
    cta.trim() !== (profile?.cta_url ?? "");

  const onChangeUsername = (raw: string) => {
    setUsername(
      raw
        .toLowerCase()
        .replace(/^@+/, "")
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 20),
    );
    setUsernameError(null);
  };

  const usernameChanged = username !== (profile?.username ?? "");
  const formatValid = USERNAME_RE.test(username);

  // Debounced availability probe — only when the handle actually changed and is
  // well-formed.
  useEffect(() => {
    if (!usernameChanged || !formatValid) return;
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
  }, [usernameChanged, formatValid, username, supabase]);

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
  const bioChanged = bio.trim() !== (profile?.bio ?? "");
  // Save stays disabled until there's a valid, available change to persist.
  const canSave =
    (usernameChanged || nameChanged || bioChanged || socialsChanged) &&
    nameOk &&
    avail === "available" &&
    !saving;

  const onSave = async () => {
    if (!canSave || !profile) return;
    // Reveal link errors now (kept hidden during typing) and block on them.
    setAttempted(true);
    if (socialFieldError) return;
    setSaving(true);
    setUsernameError(null);
    setBioError(null);
    setSocialsError(null);
    // Claim the new handle first (DB-validated + race-safe).
    if (usernameChanged) {
      const { data, error } = await supabase.rpc("set_my_username", {
        uname: username,
      });
      if (error || !data?.ok) {
        setSaving(false);
        if (data?.error === "taken")
          setRemote({ handle: username, result: "taken" });
        else setUsernameError("Couldn't save. Please try again.");
        return;
      }
    }
    if (nameChanged) {
      await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", profile.id);
    }
    if (bioChanged) {
      const { error } = await supabase.rpc("update_creator_bio", {
        target: profile.id,
        new_bio: bio.trim(),
      });
      if (error) {
        setSaving(false);
        setBioError(error.message || "Couldn't save bio.");
        return;
      }
    }
    if (socialsChanged) {
      const { error } = await supabase.rpc("set_my_socials", {
        p_x: xHandle,
        p_instagram: igHandle,
        p_linkedin: liHandle,
        p_website: web.trim(),
        p_cta: cta.trim(),
      });
      if (error) {
        setSaving(false);
        setSocialsError(error.message || "Couldn't save socials.");
        return;
      }
    }
    // Pull the fresh row so the store reflects every change.
    const { data: fresh } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profile.id)
      .single();
    setSaving(false);
    if (fresh) setProfile(fresh as Profile);
    onClose();
  };

  // Avatar is the only editable image here. Uploads the new file, persists it,
  // and deletes the previous avatar (see replaceAvatar).
  const onChangeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file || !profile) return;
    setAvatarError(null);
    setUploading(true);
    const { profile: updated, error } = await replaceAvatar(file, profile);
    setUploading(false);
    if (error) {
      setAvatarError(error);
      return;
    }
    if (updated) setProfile(updated);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Availability hint under the username field.
  const usernameHint = (() => {
    if (!usernameChanged) return null;
    switch (avail) {
      case "invalid":
        return {
          text: "3–20 chars: letters, numbers, or underscores.",
          color: "#71717b",
        };
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

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-[440px] flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        <ScrollFadeEffect className="flex min-h-0 flex-1 flex-col gap-6 p-7">
          {/* Header — scrolls with the content */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-[16px] font-medium tracking-[-0.03em] text-[#09090b]">
                Customize Your Profile
              </p>
              <p className="text-[14px] tracking-[-0.03em] text-[#71717b]">
                Update your bio, socials, and creator information.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[#71717b] transition-colors hover:bg-[#f5f5f5] hover:text-black"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex flex-col gap-[18px]">
            {/* Avatar + change photo */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Change profile picture"
                className="group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#f4f4f5] text-lg font-semibold text-[#09090b]"
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
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                      <circle cx="12" cy="13" r="3" />
                    </svg>
                  )}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onChangeAvatar}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex cursor-pointer items-center justify-center rounded-[10px] bg-[#f5f5f5] px-2.5 py-2 text-[14px] tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#ececec]"
              >
                Change Photo
              </button>
            </div>
            {avatarError && (
              <p className="-mt-2 text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                {avatarError}
              </p>
            )}

            <div className="flex flex-col gap-3">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="h-9"
                />
              </div>

              {/* Username */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                  Username
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] tracking-[-0.03em] text-[#757575]">
                    @
                  </span>
                  <Input
                    value={username}
                    onChange={(e) => onChangeUsername(e.target.value)}
                    placeholder="username"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 pl-[26px]"
                  />
                </div>
                {usernameHint && (
                  <p
                    className="text-[12px] tracking-[-0.03em]"
                    style={{ color: usernameHint.color }}
                  >
                    {usernameHint.text}
                  </p>
                )}
                {usernameError && (
                  <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                    {usernameError}
                  </p>
                )}
              </div>

              {/* Bio */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                  Bio
                </label>
                <Textarea
                  value={bio}
                  onChange={(e) => {
                    setBio(e.target.value);
                    setBioError(null);
                  }}
                  maxLength={100}
                  placeholder="Write a short bio…"
                  className="h-[88px] px-3 leading-5"
                />
                <span className="-mt-0.5 self-end text-[12px] tracking-[-0.03em] text-[#a1a1aa] tabular-nums">
                  {bio.length}/100
                </span>
                {bioError && (
                  <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                    {bioError}
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
                        setSocialsError(null);
                      }}
                      placeholder="https://yourwebsite.com"
                      autoComplete="off"
                      className="h-5 w-full bg-transparent text-[14px] leading-5 tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                    />
                  </div>
                  <div className="group flex items-center gap-2 border-b border-[#e7e9ee] bg-[#f9f9fa] px-2.5 py-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/x.svg"
                      alt=""
                      className={`block size-[18px] shrink-0 transition ${xh ? "opacity-100" : "grayscale opacity-50 group-focus-within:opacity-100 group-focus-within:grayscale-0"}`}
                    />
                    <input
                      value={xh}
                      onChange={(e) => {
                        setXh(e.target.value);
                        setSocialsError(null);
                      }}
                      placeholder="https://x.com/username"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-5 w-full bg-transparent text-[14px] leading-5 tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                    />
                  </div>
                  <div className="group flex items-center gap-2 border-b border-[#e7e9ee] bg-[#f9f9fa] px-2.5 py-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/insta.svg"
                      alt=""
                      className={`block size-[18px] shrink-0 transition ${ig ? "opacity-100" : "grayscale opacity-50 group-focus-within:opacity-100 group-focus-within:grayscale-0"}`}
                    />
                    <input
                      value={ig}
                      onChange={(e) => {
                        setIg(e.target.value);
                        setSocialsError(null);
                      }}
                      placeholder="https://instagram.com/username"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-5 w-full bg-transparent text-[14px] leading-5 tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                    />
                  </div>
                  <div className="group flex items-center gap-2 bg-[#f9f9fa] px-2.5 py-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/linkedin.svg"
                      alt=""
                      className={`block size-[18px] shrink-0 transition ${li ? "opacity-100" : "grayscale opacity-50 group-focus-within:opacity-100 group-focus-within:grayscale-0"}`}
                    />
                    <input
                      value={li}
                      onChange={(e) => {
                        setLi(e.target.value);
                        setSocialsError(null);
                      }}
                      placeholder="https://linkedin.com/in/username"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-5 w-full bg-transparent text-[14px] leading-5 tracking-[-0.03em] text-black outline-none placeholder:text-[#a3a3a3]"
                    />
                  </div>
                </div>
                {((attempted && socialBoxError) || socialsError) && (
                  <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                    {(attempted && socialBoxError) || socialsError}
                  </p>
                )}
              </div>

              {/* Hire Creator CTA — https:// is prepended on save. */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
                  Hire Creator
                </label>
                <Input
                  value={cta}
                  onChange={(e) => {
                    setCta(e.target.value);
                    setSocialsError(null);
                  }}
                  placeholder="https://yoursite.com/link"
                  autoComplete="off"
                  className="h-9"
                />
                {attempted && ctaError && (
                  <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
                    {ctaError}
                  </p>
                )}
              </div>
            </div>
          </div>

        </ScrollFadeEffect>

        {/* Sticky footer — Save stays visible; content above scrolls. */}
        <div className="shrink-0 border-t border-[#e7e9ee] bg-white px-7 py-4">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="w-full cursor-pointer rounded-[10px] bg-[#2974ff] py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
