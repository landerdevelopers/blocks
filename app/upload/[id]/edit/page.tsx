"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import UploadForm, { type UploadInitialValues } from "@/components/UploadForm";

export default function EditComponentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [initial, setInitial] = useState<UploadInitialValues | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await createClient()
        .from("components")
        .select("preview_url, figma_url, category, section, filters, colors")
        .eq("id", id)
        .single();

      if (!data) {
        setNotFound(true);
        return;
      }

      setInitial({
        previewUrl: data.preview_url,
        figmaUrl: data.figma_url,
        category: data.category,
        section: data.section,
        filters: data.filters,
        colors: data.colors,
      });
    };
    load();
  }, [id]);

  return (
    <main className="flex min-h-screen justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
      {notFound ? (
        <div className="flex w-full max-w-[628px] flex-col items-center gap-4 rounded-2xl border border-[#e7e9ee] bg-[#f9fafa] p-10 text-center shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-sm tracking-[-0.03em] text-[#71717b]">
            Component not found.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-xl bg-[#09090b] px-5 py-2.5 text-sm font-medium tracking-[-0.03em] text-white hover:bg-[#27272a]"
          >
            Back home
          </button>
        </div>
      ) : initial ? (
        <UploadForm
          componentId={id}
          heading="Edit Component"
          subheading="Update assets, Figma data, and color weights."
          initialValues={initial}
          onSuccess={() => router.push("/")}
        />
      ) : (
        <p className="mt-10 text-sm tracking-[-0.03em] text-[#71717b]">Loading…</p>
      )}
    </main>
  );
}
