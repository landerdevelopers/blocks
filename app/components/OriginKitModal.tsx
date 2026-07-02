"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Volume2, VolumeX } from "lucide-react";

// Promo modal announcing OriginKit — a free animated component library.
// Centered card with a preview image and a CTA out to the library.
export default function OriginKitModal({
  open,
  onClose,
  href = "https://www.originkit.dev/?invite=j347usrcra",
}: {
  open: boolean;
  onClose: () => void;
  // Where "Explore the library" points.
  href?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Video starts muted (autoplay requires it); speaker toggle unmutes on click.
  const [muted, setMuted] = useState(true);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-[534px] max-w-full flex-col items-center gap-4 rounded-[18px] border border-[#e7e9ee] bg-[#f5f5f5] p-[26px] drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[26px] top-[26px] cursor-pointer text-[#71717b] transition-colors hover:text-[#09090b]"
        >
          <X size={18} strokeWidth={2.5} />
        </button>

        <div className="flex w-full flex-col gap-0.5">
          <h2 className="text-center text-[22px] font-medium tracking-[-0.66px] text-black">
            Introducing OriginKit
          </h2>
          <p className="text-center text-[16px] tracking-[-0.48px] text-[#71717b]">
            Free animated component library for modern websites.
          </p>
        </div>

        <div className="group relative aspect-video w-[482px] max-w-full overflow-hidden rounded-[12px] border border-[#e7e9ee]">
          <video
            ref={videoRef}
            src="https://cdn.originkit.dev/Originkit%20(1)%20(1)%20(1)%20(2).mp4"
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
          <button
            type="button"
            onClick={toggleMuted}
            aria-label={muted ? "Unmute" : "Mute"}
            className="absolute bottom-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            {muted ? (
              <VolumeX size={16} strokeWidth={1.75} />
            ) : (
              <Volume2 size={16} strokeWidth={1.75} />
            )}
          </button>
        </div>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-[8px] bg-[#2974ff] p-[14px] text-[14px] font-medium leading-none tracking-[-0.42px] text-white transition-colors hover:bg-[#1f63e6]"
        >
          <span className="leading-none">Explore the library</span>
          <ExternalLink size={15} strokeWidth={2.2} />
        </a>
      </div>
    </div>,
    document.body,
  );
}
