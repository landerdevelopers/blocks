"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

const imgLanderBlack = "/Lander_black.png";
const imgGoogle = "/Google.png";

export default function LoginModal({
  open,
  onClose,
  notice,
  onSubmit,
  onGoogle,
}: {
  open: boolean;
  onClose: () => void;
  notice?: boolean;
  onSubmit: () => void;
  onGoogle: () => void;
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
        className="flex h-fit w-[384px] flex-col gap-[23px] rounded-2xl bg-white p-[18px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Header */}
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            src={imgLanderBlack}
            className="mx-auto h-[28px] w-[22px]"
          />
          <p className="mt-3 text-center text-[20px] font-medium leading-7 tracking-[-0.03em] text-[#09090b]">
            Figma Blocks
            <br />
            by Lander Studio
          </p>
        </div>

        {/* Notice — shown when a copy was attempted while logged out */}
        {notice && (
          <div className="mx-auto -mt-[15px] w-fit rounded-lg border border-[#FCD8AB] bg-[#fff6eb] px-1.5 py-1 text-center text-[12px] tracking-[-0.03em] text-[#E09131]">
            Login to copy design
          </div>
        )}

        {/* Email */}
        <div className="flex flex-col gap-2">
          <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
            Email
          </label>
          <input
            type="email"
            placeholder="m@example.com"
            className="w-full rounded-lg border border-[#E5E5E5] px-3 py-2.5 text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575] focus:border-[#2974ff]"
          />
        </div>

        {/* Login */}
        <button
          type="button"
          onClick={onSubmit}
          className="w-full cursor-pointer rounded-lg bg-[#2974ff] py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6]"
        >
          Login
        </button>

        {/* OR divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-[#e5e5e5]" />
          <span className="text-[14px] tracking-[-0.03em] text-[#757575]">
            OR
          </span>
          <div className="h-px flex-1 bg-[#e5e5e5]" />
        </div>

        {/* Continue with Google */}
        <button
          type="button"
          onClick={onGoogle}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#E5E5E5] py-2.5 text-[14px] font-medium leading-none tracking-[-0.03em] text-black transition-colors hover:bg-[#fafafa]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={imgGoogle} className="size-[18px]" />
          Continue with Google
        </button>
      </div>
    </div>,
    document.body,
  );
}
