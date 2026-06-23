import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/store/authStore";

// Avatars live in the Supabase Storage `avatars` bucket under `{uid}/…`.
// Uploads are unlimited, but each new upload deletes the user's previous file
// so storage never accumulates one row per change.
export const MAX_AVATAR_MB = 5;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

// Map a public avatar URL back to its in-bucket path, but ONLY for files we
// host. OAuth/provider avatars (Google, etc.) live on external domains and
// return null, so we never try to delete something that isn't ours.
function bucketPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/public\/avatars\/(.+)$/);
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

// Upload a new avatar, persist it on the profile row, then best-effort delete
// the previous file. Returns the refreshed profile or a user-facing error.
export async function replaceAvatar(
  file: File,
  profile: Profile,
): Promise<{ profile?: Profile; error?: string }> {
  if (!ACCEPTED.includes(file.type))
    return { error: "Use a PNG, JPG, or WEBP image." };
  if (file.size > MAX_AVATAR_MB * 1024 * 1024)
    return { error: `Image must be under ${MAX_AVATAR_MB}MB.` };

  const sb = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${profile.id}/${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage
    .from("avatars")
    .upload(path, file, { upsert: true });
  if (upErr) return { error: "Upload failed. Please try again." };

  const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
  const { data: updated, error: dbErr } = await sb
    .from("profiles")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (dbErr || !updated) return { error: "Couldn't save. Please try again." };

  // Delete the old file (ignore failures — a leftover file is harmless and the
  // new avatar is already live).
  const oldPath = bucketPath(profile.avatar_url);
  if (oldPath && oldPath !== path) {
    await sb.storage
      .from("avatars")
      .remove([oldPath])
      .catch(() => {});
  }

  return { profile: updated as Profile };
}
