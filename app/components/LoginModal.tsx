"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { signInWithGoogle } from "@/lib/auth";
import { Input } from "@/components/ui/input";

const imgLanderBlack = "/Lander_black.png";
const imgGoogle = "/Google.png";
const imgMail = "/Mail.png";

export default function LoginModal({
  open,
  onClose,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  notice?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      setSent(false);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const onGoogle = async () => {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  };

  const sendMagicLink = async () => {
    if (!email) return;
    setError(null);
    setLoading(true);
    try {
      // Routed through /api/magic-link so disposable / temp-mail domains are
      // rejected before any email is sent.
      const res = await fetch("/api/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  // Magic link sent — dedicated confirmation modal (Mail.png + message).
  if (sent) {
    return createPortal(
      <div
        onClick={onClose}
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex h-fit w-[440px] flex-col items-center gap-1 rounded-2xl bg-white px-12 py-10 text-center shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={imgMail} className="size-[160px] object-contain" />
          <p className="text-[26px] font-semibold tracking-[-0.03em] text-[#09090b]">
            Email Sent
          </p>
          <p className="text-[16px] leading-6 tracking-[-0.03em] text-[#71717b]">
            We&apos;ve sent a verification link to your email. Please check your
            inbox and verify your account.
          </p>
        </div>
      </div>,
      document.body,
    );
  }

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

        {(
          <>
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
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
                placeholder="m@example.com"
              />
            </div>

            {/* Login (send magic link) */}
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={loading || !email}
              className="w-full cursor-pointer rounded-lg bg-[#2974ff] py-2.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6] disabled:opacity-50"
            >
              {loading ? "Sending…" : "Login"}
            </button>

            {error && (
              <p className="-mt-3 text-center text-[12px] tracking-[-0.03em] text-[#ef4444]">
                {error}
              </p>
            )}

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
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
