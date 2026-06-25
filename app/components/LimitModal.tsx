"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function LimitModal({
  open,
  onClose,
  limit,
  reason = "user",
}: {
  open: boolean;
  onClose: () => void;
  limit: number;
  // "user" = the signed-in account's own daily cap; "ip" = the per-network cap
  // (too many copies from this connection across accounts). Different copy so an
  // IP-capped user isn't told their personal number, which they may not have hit.
  reason?: "user" | "ip";
}) {
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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-fit w-[436px] flex-col items-center gap-3 rounded-2xl bg-white p-[30px] text-center shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        <span className="w-fit rounded-[8px] bg-[#fdecec] px-2.5 py-2 text-[18px] tracking-[-0.03em] text-[#e5484d] mb-[14px] border border-[#FBDFDB]">
          Copy Limit Reached
        </span>
        <p className="text-[22px] font-semibold tracking-[-0.03em] text-[#09090b]">
          You&apos;ve reached today&apos;s limit
        </p>
        <p className="text-[18px] leading-5 tracking-[-0.03em] text-[#71717b]">
          {reason === "ip"
            ? "Too many copies from this network today. Please try again tomorrow."
            : `As we continue building the platform, design copies are currently limited to ${limit} per day.`}
        </p>
      </div>
    </div>,
    document.body,
  );
}
