export type CloudinaryUpload = {
  url: string;
  // width / height; null if the response omits dimensions.
  aspectRatio: number | null;
};

// Unsigned Cloudinary upload from the browser. Requires a cloud name and an
// unsigned upload preset configured in the Cloudinary dashboard. Returns the
// secure URL plus the image aspect ratio (from the response width/height).
export async function uploadToCloudinary(file: File): Promise<CloudinaryUpload> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !preset) {
    throw new Error("Cloudinary env vars are not configured.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error("Cloudinary upload failed.");

  const data = await res.json();
  const aspectRatio =
    data.width && data.height ? data.width / data.height : null;
  return { url: data.secure_url as string, aspectRatio };
}

// Apply on-the-fly transforms (width cap, auto quality/format) to a stored
// Cloudinary URL. No-op for non-Cloudinary URLs.
export function cloudinaryOptimize(url: string): string {
  if (!url || !url.includes('cloudinary.com')) return url
  // w_1200 + dpr_2.0 keeps cards crisp on retina / large layouts; c_limit avoids
  // upscaling past the original; q_auto:good + f_auto keep the payload reasonable.
  return url.replace(
    '/upload/',
    '/upload/w_1200,c_limit,dpr_2.0,q_auto:good,f_auto/',
  )
}
