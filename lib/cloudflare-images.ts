// Server-side upload to Cloudflare Images. NEVER call from the browser — the
// CLOUDFLARE_IMAGES_TOKEN must stay server-only. Use the /api/upload-image
// route from the client instead.
export async function uploadToCloudflareImages(
  file: File,
): Promise<{ url: string; aspectRatio: number | null }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_IMAGES_TOKEN}`,
      },
      body: formData,
    },
  );

  const data = await response.json();
  if (!data.success)
    throw new Error(data.errors?.[0]?.message || "Upload failed");

  const imageId = data.result.id;
  const width = data.result.metadata?.width ?? null;
  const height = data.result.metadata?.height ?? null;
  const aspectRatio = width && height ? width / height : null;
  const url = `https://imagedelivery.net/${process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH}/${imageId}/${process.env.NEXT_PUBLIC_CLOUDFLARE_VARIANT}`;

  return { url, aspectRatio };
}
