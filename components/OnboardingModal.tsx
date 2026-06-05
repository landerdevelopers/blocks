"use client";

import { useRef, useState } from "react";
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
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload the chosen image to the `avatars` bucket under `{uid}/{filename}`
  // (matches the storage RLS policy) and keep its public URL.
  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setError(null);
    setUploading(true);

    const path = `${profile.id}/${Date.now()}-${file.name}`;
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
    if (!profile || !fullName.trim()) return;
    setError(null);
    setSaving(true);

    const row = {
      id: profile.id,
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

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 font-sans backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-[0px_12px_40px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
            Complete your profile
          </h1>
          <p className="text-sm tracking-[-0.03em] text-[#71717b]">
            Tell us your name to finish setting up your account.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          {/* Avatar (optional) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex size-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[#e4e4e7] bg-[#fafafa] text-[#a1a1aa]"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={avatarUrl} className="size-full object-cover" />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              )}
            </button>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="cursor-pointer text-left text-sm font-medium tracking-[-0.03em] text-[#2974ff]"
              >
                {uploading ? "Uploading…" : "Upload photo"}
              </button>
              <span className="text-xs tracking-[-0.03em] text-[#a1a1aa]">
                Optional. PNG or JPG.
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickAvatar}
            />
          </div>

          {/* Full name (required) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-[0.04em] text-[#71717b]">
              Full name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-sm tracking-[-0.03em] text-[#09090b] outline-none placeholder:text-[#a1a1aa] focus:border-[#2974ff]"
            />
          </div>

          {error && (
            <p className="text-xs tracking-[-0.03em] text-[#ef4444]">{error}</p>
          )}

          <button
            type="submit"
            disabled={!fullName.trim() || saving || uploading}
            className="flex w-full items-center justify-center rounded-lg bg-[#09090b] px-4 py-2.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
