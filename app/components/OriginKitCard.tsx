"use client";

import { useRef, useState } from "react";
import { ExternalLink, Volume2, VolumeX } from "lucide-react";

// Floating bottom-right promo card teasing OriginKit. Only the video and the CTA
// open the full OriginKitModal. Replaces the old "Suggest Improvements" button.
export default function OriginKitCard({ onOpen }: { onOpen: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Video starts muted (autoplay requires it); speaker toggle unmutes on click.
  const [muted, setMuted] = useState(true);

  const toggleMuted = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't open the modal when toggling sound
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  return (
    <div className="fixed bottom-6 right-8 z-50 flex w-[300px] flex-col items-start gap-2.5 overflow-hidden rounded-[16px] border border-[#e7e9ee] bg-[#fafafa] p-1 pb-1.5 text-left shadow-[0px_0px_0px_1px_rgba(14,18,27,0.04),0px_1px_2px_0px_rgba(14,18,27,0.06),0px_6px_12px_-4px_rgba(14,18,27,0.10),0px_16px_28px_-8px_rgba(14,18,27,0.14),0px_36px_60px_-16px_rgba(14,18,27,0.16)]">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        aria-label="Introducing OriginKit — explore the library"
        className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-[12px]"
      >
        <video
          ref={videoRef}
          src="https://cdn.originkit.dev/Originkit%20(1)%20(2).mp4"
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
          className="absolute bottom-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
        >
          {muted ? (
            <VolumeX size={14} strokeWidth={1.75} />
          ) : (
            <Volume2 size={14} strokeWidth={1.75} />
          )}
        </button>
      </div>
      <div className="flex w-full flex-col gap-2.5 px-1.5 pb-1.5">
        <div className="flex flex-col gap-0.5">
          <p className="text-[16px] font-medium tracking-[-0.48px] text-black">
            Introducing OriginKit
          </p>
          <p className="text-[14px] tracking-[-0.42px] text-[#71717b]">
            Free animated component library for modern websites.
          </p>
        </div>
        <a
          href="https://www.originkit.dev/?invite=j347usrcra"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-fit cursor-pointer items-center gap-1.5 text-[14px] tracking-[-0.42px] text-[#2974ff] hover:underline"
        >
          Explore the Library
          <ExternalLink size={12} strokeWidth={1.75} />
        </a>
      </div>
    </div>
  );
}
