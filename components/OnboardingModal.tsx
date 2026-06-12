"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";

// First-login onboarding. Cannot be dismissed — no close button, no outside
// click — until a name is submitted.
export default function OnboardingModal() {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setShowOnboarding = useAuthStore((s) => s.setShowOnboarding);

  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    profile?.avatar_url ?? null,
  );
  // Local object URL shown immediately on select, before the upload finishes.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const previewSrc = localPreview ?? avatarUrl;
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const showOnboarding = useAuthStore((s) => s.showOnboarding);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Mount the overlay into <body> via a dedicated node, and re-append it if it
  // ever gets removed from the DOM while onboarding is still required.
  const [host] = useState(() =>
    typeof document !== "undefined" ? document.createElement("div") : null,
  );
  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    const observer = new MutationObserver(() => {
      if (showOnboarding && !document.body.contains(host)) {
        document.body.appendChild(host);
      }
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      if (document.body.contains(host)) document.body.removeChild(host);
    };
  }, [host, showOnboarding]);

  const nameValid = fullName.trim().length >= 2;

  // Resolve the signed-in user id. Prefer the store profile, but fall back to
  // the auth user directly — the profile row may still be loading (or its load
  // failed) while onboarding is already open via the ?onboarding=true redirect.
  const resolveUid = async (): Promise<string | null> => {
    if (profile?.id) return profile.id;
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  };

  // Upload the chosen image to the `avatars` bucket under `{uid}/{filename}`
  // (matches the storage RLS policy) and keep its public URL.
  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Instant preview from a local object URL — independent of the upload.
    setLocalPreview(URL.createObjectURL(file));

    const uid = await resolveUid();
    if (!uid) {
      setError("Not signed in. Please retry the login link.");
      return;
    }
    setUploading(true);

    const path = `${uid}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setUploading(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid) return;
    setError(null);
    setSaving(true);

    const uid = await resolveUid();
    if (!uid) {
      setSaving(false);
      setError("Not signed in. Please retry the login link.");
      return;
    }

    const row = {
      id: uid,
      full_name: fullName.trim(),
      avatar_url: avatarUrl,
    };

    const { data, error: upErr } = await supabase
      .from("profiles")
      .upsert(row)
      .select("*")
      .single();

    setSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }

    if (data) setProfile(data as Profile);
    setShowOnboarding(false);
  };

  if (!host) return null;

  return createPortal(
    <div
      ref={overlayRef}
      style={{ zIndex: 99999 }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 font-sans backdrop-blur-sm"
    >
      <form
        onSubmit={onSubmit}
        className="flex h-fit w-[384px] flex-col gap-5 rounded-2xl bg-white p-[30px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Notice — same style as the login "Login to copy design" warning */}
        <div className="w-fit rounded-lg border border-[#FCD8AB] bg-[#fff6eb] px-2 py-1 text-[12px] capitalize tracking-[-0.03em] text-[#E09131]">
          Complete setup to continue
        </div>

        {/* Profile photo */}
        <div className="flex flex-col gap-3.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative flex size-[88px] cursor-pointer items-center justify-center overflow-hidden rounded-full text-[#ADADAD] transition-opacity hover:opacity-70"
            aria-label="Upload profile photo"
          >
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={previewSrc}
                referrerPolicy="no-referrer"
                className="size-full scale-65 object-cover"
              />
            ) : (
              <>
                {/* Dashed ring */}
                <svg className="absolute inset-0 size-full" viewBox="0 0 88 88" fill="none">
                  <circle cx="44" cy="44" r="43" stroke="#ADADAD" strokeWidth="1" pathLength={100} strokeDasharray="2 2" />
                </svg>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M7 10l5-5 5 5" />
                  <path d="M12 5v12" />
                </svg>
              </>
            )}
          </button>
          <span className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
            {uploading ? "Uploading…" : "Profile Photo"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onPickAvatar}
          />
        </div>

        {/* Name */}
        <div className="flex flex-col gap-2">
          <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
            Name <span className="text-[#ef4444]">*</span>
          </label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2.5 text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575] focus:border-[#2974ff]"
          />
        </div>

        {error && (
          <p className="-mt-2 text-[12px] tracking-[-0.03em] text-[#ef4444]">
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!nameValid || saving || uploading}
          className="w-full cursor-pointer rounded-lg bg-[#2974ff] py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Submit"}
        </button>
      </form>
    </div>,
    host,
  );
}
