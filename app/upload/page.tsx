"use client";

import { useState } from "react";
import UploadForm from "@/components/UploadForm";
import { useAuthStore } from "@/store/authStore";

export default function UploadPage() {
  const [uploaded, setUploaded] = useState(false);
  // Admins publish curated gallery content; everyone else here is a creator
  // (middleware only lets admins + creators in) → submit as a pending review.
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const ownerMode = !isAdmin;

  if (uploaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
        <div className="flex w-full max-w-[628px] flex-col items-center gap-4 rounded-2xl border border-[#e7e9ee] bg-[#f9fafa] p-10 text-center shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#dcfce7] text-[#16a34a]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
              Uploaded Successfully
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              Your component has been uploaded.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUploaded(false)}
            className="mt-2 flex items-center justify-center rounded-xl bg-[#09090b] px-5 py-2.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a]"
          >
            Upload Another
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
      {/* key remounts the form for a clean slate after "Upload Another". */}
      <UploadForm
        key="upload"
        ownerMode={ownerMode}
        heading={ownerMode ? "Publish New Design" : undefined}
        subheading={
          ownerMode
            ? "Submit your design for review. Approved designs go live."
            : undefined
        }
        submitLabel={ownerMode ? "Submit for Review" : undefined}
        onSuccess={() => setUploaded(true)}
      />
    </main>
  );
}
