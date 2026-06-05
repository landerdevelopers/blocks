"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

const imgLanderBlack = "/Lander_black.png";
const LIMIT = 10;

export default function AccountModal({
  open,
  onClose,
  onLogout,
  used,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  used: number;
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
        className="flex h-fit w-[400px] flex-col gap-5 rounded-2xl bg-white p-[28px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Identity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-xl bg-[#f4f4f5]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={imgLanderBlack} className="h-7 w-[22px]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[16px] font-semibold tracking-[-0.03em] text-[#09090b]">
                Lander Studio
              </span>
              <span className="text-[14px] tracking-[-0.03em] text-[#71717b]">
                hello@lander.studio
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            className="group relative flex size-8 cursor-pointer items-center justify-center rounded-full bg-[#FFE2E2] text-[#FF1313] transition-colors hover:bg-[#ffd0d0]"
          >
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#09090b] px-2 py-1 text-[12px] font-medium tracking-[-0.03em] text-white opacity-0 transition-opacity group-hover:opacity-100">
              Logout
              <span className="absolute left-1/2 top-full -translate-x-1/2 border-[6px] border-transparent border-t-[#09090b]" />
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>

        {/* Daily limit */}
        <div className="flex flex-col gap-[10px]">
          <span className="text-[14px] tracking-[-0.03em] text-[#09090b]">
            Daily Limit
          </span>
          <div className="flex items-center gap-3">
            <div className="flex w-fit items-center gap-[3px] rounded-[8px] border border-[#e4e4e7] bg-[#f9fafa] p-[4px]">
              {Array.from({ length: LIMIT }).map((_, i) => (
                <div
                  key={i}
                  className={`h-[18px] w-[25.5px] rounded-md ${
                    i < used
                      ? used >= LIMIT
                        ? "bg-[#FF2C2C]"
                        : "bg-[#2974ff]"
                      : "bg-[#ebebef]"
                  }`}
                />
              ))}
            </div>
            <span className="text-[14px] tracking-[-0.03em] text-[#09090b]">
              {used}/{LIMIT}
            </span>
          </div>
        </div>

        {/* Notice */}
        <div className="rounded-[6px] bg-[#fff0d6] px-[8px] py-[4px] text-[12px] text-[#CA8000]">
          Design copies are temporarily limited to {LIMIT} per day while the
          platform is under development.
        </div>

        {/* Reset timer */}
        <div className="flex items-center gap-1 text-[12px] tracking-[-0.03em] text-[#71717b]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Limit resets in 14h 23m
        </div>
      </div>
    </div>,
    document.body,
  );
}
