"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { ScrollFadeEffect } from "@/components/scroll-fade-effect";
import { useAuthStore } from "@/store/authStore";
import { replaceAvatar } from "@/lib/avatar";
import { timeUntilMidnightIST } from "@/lib/ist";

// Read-only account view: avatar, name, email, daily-copy limit, and a single
// CTA — "Open Creator Portal" for creators, "Become Creator" for everyone else.
// Profile editing (name/username/bio/socials) lives in EditProfileModal.
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
  const profile = useAuthStore((s) => s.profile);
  const email = useAuthStore((s) => s.email);
  const setProfile = useAuthStore((s) => s.setProfile);

  // Avatar upload (the only editable field in this view).
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const onChangeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
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

  // Creators (and admins who've claimed a handle) get the portal link + higher
  // cap. Admins have NO daily cap, so their limit shows as "Unlimited".
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

  // Pending-application flag is prefetched at sign-in (AuthProvider), so the
  // "Become Creator" section renders the instant the modal opens.
  const hasPendingApplication = useAuthStore((s) => s.pendingCreatorApp);
  // True for an existing OR revoked creator (approved application) — they should
  // not see the "Become a Creator" CTA.
  const wasCreator = useAuthStore((s) => s.wasCreator);
  // Rejected within the last 7 days — CTA hidden during the cooldown.
  const rejectedRecently = useAuthStore((s) => s.creatorRejectedRecently);

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

  if (!open || typeof document === "undefined") return null;

  const avatarBlock = (
    <>
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
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onChangeAvatar}
      />
    </>
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
        {/* Identity — avatar is changeable; name + email are read-only. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {avatarBlock}
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
          {avatarError && (
            <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
              {avatarError}
            </p>
          )}
        </div>

        {dailyLimit}
        {notice}
        {!unlimited && resetTimer}

        {isCreator ? (
          // Open Creator Portal — Link (not router.push) so Next prefetches the
          // portal route + its loading skeleton while the modal is open; the
          // click then transitions instantly instead of waiting on a cold RSC.
          <Link
            href={profile?.username ? `/creators/${profile.username}` : "#"}
            prefetch
            onClick={onClose}
            className="flex min-h-[36px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#f5f5f5] px-4 py-2 text-[14px] tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#ececec]"
          >
            <ExternalLink size={16} strokeWidth={1.5} />
            Open Creator Portal
          </Link>
        ) : (
          // Become Creator — hidden while an application is in review, and while
          // the pending-check is still loading (avoids a flash).
          hasPendingApplication === false &&
          !wasCreator &&
          !rejectedRecently && (
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
          )
        )}
      </ScrollFadeEffect>
      </div>
    </div>,
    document.body,
  );
}
