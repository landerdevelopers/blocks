"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";
import { timeUntilMidnightIST } from "@/lib/ist";

const LIMIT = 10;

export default function AccountModal({
  open,
  onClose,
  onLogout,
  used,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  used: number;
}) {
  const profile = useAuthStore((s) => s.profile);
  const email = useAuthStore((s) => s.email);
  const setProfile = useAuthStore((s) => s.setProfile);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // Avatar is the only editable field here. Upload to avatars/{uid}/… then
  // persist the public URL on the profile row.
  const onChangeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    const supabase = createClient();
    const path = `${profile.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (upErr) {
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { data: updated } = await supabase
      .from("profiles")
      .update({ avatar_url: data.publicUrl })
      .eq("id", profile.id)
      .select("*")
      .single();
    if (updated) setProfile(updated as Profile);
    setUploading(false);
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-fit w-[440px] flex-col gap-5 rounded-2xl bg-white p-[28px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Identity — avatar is changeable, name/email are not */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
              {/* Hover/upload overlay */}
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
            <div className="flex flex-col">
              <span className="text-[18px] font-semibold tracking-[-0.03em] text-[#09090b]">
                {profile?.full_name ?? "Account"}
              </span>
              <span className="text-[16px] tracking-[-0.03em] text-[#71717b]">
                {email ?? ""}
              </span>
            </div>
          </div>
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>

        {/* Daily limit */}
        <div className="flex flex-col gap-[10px]">
          <span className="text-[14px] tracking-[-0.03em] text-[#09090b]">
            Daily Limit
          </span>
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-[3px] rounded-[8px] border border-[#e4e4e7] bg-[#f9fafa] p-[4px]">
              {Array.from({ length: LIMIT }).map((_, i) => (
                <div
                  key={i}
                  className={`h-[18px] flex-1 rounded-md ${
                    i < used
                      ? used >= LIMIT
                        ? "bg-[#FF2C2C]"
                        : "bg-[#2974ff]"
                      : "bg-[#ebebef]"
                  }`}
                />
              ))}
            </div>
            <span className="text-[14px] tracking-[-0.03em] text-[#09090b]">
              {used}/{LIMIT}
            </span>
          </div>
        </div>

        {/* Notice */}
        <div className="rounded-[8px] bg-[#fff0d6] px-[8px] py-[4px] text-[14px] text-[#CA8000]">
          Design copies are temporarily limited to {LIMIT} per day while the
          platform is under development.
        </div>

        {/* Reset timer */}
        <div className="flex items-center gap-1 text-[14px] tracking-[-0.03em] text-[#71717b]">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Limit resets in {reset.h}h {reset.m}m
        </div>
      </div>
    </div>,
    document.body,
  );
}
