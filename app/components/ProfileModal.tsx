"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ProfileModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

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
        className="flex h-fit w-[384px] flex-col gap-5 rounded-2xl bg-white p-[30px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Profile photo */}
        <div className="flex flex-col gap-3.5">
          <button
            type="button"
            className="relative flex size-[88px] cursor-pointer items-center justify-center rounded-full text-[#ADADAD] transition-colors hover:bg-[#fafafa]"
            aria-label="Upload profile photo"
          >
            {/* Dashed ring — fewer, bigger dots */}
            <svg
              className="absolute inset-0 size-full"
              viewBox="0 0 88 88"
              fill="none"
            >
              <circle
                cx="44"
                cy="44"
                r="43"
                stroke="#ADADAD"
                strokeWidth="1"
                pathLength={100}
                strokeDasharray="2 2"
              />
            </svg>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5-5 5 5" />
              <path d="M12 5v12" />
            </svg>
          </button>
          <span className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
            Profile Photo
          </span>
        </div>

        {/* Name */}
        <div className="flex flex-col gap-2">
          <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
            Name <span className="text-[#ef4444]">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2.5 text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575] focus:border-[#2974ff]"
          />
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={onClose}
          className="w-full cursor-pointer rounded-lg bg-[#2974ff] py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6]"
        >
          Submit
        </button>
      </div>
    </div>,
    document.body,
  );
}
