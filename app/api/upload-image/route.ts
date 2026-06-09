import { uploadToCloudflareImages } from "@/lib/cloudflare-images";

// Server-side upload endpoint — keeps the Cloudflare Images token off the
// browser. Receives the file as multipart FormData, returns { url, aspectRatio }.
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File;
  if (!file) return Response.json({ error: "No file" }, { status: 400 });

  const result = await uploadToCloudflareImages(file);
  return Response.json(result);
}
