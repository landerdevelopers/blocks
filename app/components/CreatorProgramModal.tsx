"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardClock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";

// A valid https link (http and other schemes rejected).
function isValidUrl(s: string): boolean {
  try {
    return new URL(s.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

// "Join the Creator Program" application modal. Opened from the "Become a
// Creator" actions (sidebar popup + account modal). Design only for now —
// Apply Now just closes; wire submission later.
export default function CreatorProgramModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  // Called when the success view is dismissed (Continue Exploring / backdrop),
  // e.g. to redirect home. The success popup is always shown first.
  onApplied?: () => void;
}) {
  const profile = useAuthStore((s) => s.profile);
  const setPendingCreatorApp = useAuthStore((s) => s.setPendingCreatorApp);
  const [role, setRole] = useState("");
  const [social, setSocial] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Set when Apply is pressed with a missing/invalid social link — surfaces the
  // error under the social input (not the bottom generic error slot).
  const [socialTouched, setSocialTouched] = useState(false);

  // Close + reset everything (form fields and the success view).
  const close = () => {
    setSubmitted(false);
    onClose();
  };

  // Dismiss the success popup — hand back to the caller (e.g. redirect home) if
  // it wants to take over, else just close.
  const finishSuccess = () => {
    setSubmitted(false);
    if (onApplied) onApplied();
    else onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live (while typing) OR after an Apply attempt — show the social error under
  // its own input. `canApply` no longer gates on the link so Apply is clickable
  // and can surface the validation message there.
  const socialInvalid =
    (social.trim().length > 0 || socialTouched) && !isValidUrl(social);
  const canApply = role.trim().length > 0 && !submitting;

  const apply = async () => {
    if (!canApply) return;
    if (!isValidUrl(social)) {
      setSocialTouched(true);
      return;
    }
    if (!profile) {
      setError("Please sign in to apply.");
      return;
    }
    setSubmitting(true);
    setError(null);
    // Submit through the API route, which re-validates the https link and the
    // session server-side before inserting.
    const res = await fetch("/api/creator-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: role.trim(),
        social: social.trim(),
        reason: reason.trim(),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({}));
      setError(msg || "Something went wrong. Please try again.");
      return;
    }
    // Application is now pending — hide the "Become a Creator" CTA everywhere.
    setPendingCreatorApp(true);
    // Clear the form.
    setRole("");
    setSocial("");
    setReason("");
    // Always show the success popup; the caller's onApplied (e.g. redirect) runs
    // only once the user dismisses it.
    setSubmitted(true);
  };

  if (!open || typeof document === "undefined") return null;

  // Success view — shown after a submission goes through.
  if (submitted) {
    return createPortal(
      <div
        onClick={finishSuccess}
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-[440px] max-w-full flex-col items-center gap-4 rounded-[20px] border border-[#e7e9ee] bg-white px-[30px] py-10 text-center shadow-[0px_16px_32px_-12px_rgba(14,18,27,0.1)]"
        >
          <span className="flex items-center justify-center rounded-[10px] bg-[#fff6e0] p-2 text-[#ca8000]">
            <ClipboardClock size={22} strokeWidth={1.5} />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
              Application Submitted 🎉
            </h2>
            <p className="text-[16px] tracking-[-0.03em] text-[#71717b]">
              Your creator application is now under review. <br />We&apos;ll reach out
              once a decision has been made.
            </p>
          </div>
          <button
            type="button"
            onClick={finishSuccess}
            className="mt-2 w-full cursor-pointer rounded-[8px] bg-[#2974ff] px-3 py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6]"
          >
            Continue Exploring
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      onClick={close}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-[440px] max-w-full flex-col gap-5 rounded-[20px] bg-white p-6 shadow-[0px_5px_5px_-2.5px_rgba(51,51,51,0.08),0px_1px_3px_-1.5px_rgba(51,51,51,0.16),0px_0px_0px_1px_rgba(51,51,51,0.04)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-5 top-5 cursor-pointer text-[#71717b] transition-colors hover:text-[#09090b]"
        >
          <X size={18} strokeWidth={1.5} />
        </button>

        <div className="flex flex-col gap-1">
          <h2 className="text-[16px] font-medium tracking-[-0.03em] text-[#09090b]">
            Join the Creator Program
          </h2>
          <p className="text-[14px] tracking-[-0.03em] text-[#71717b]">
            Publish designs, gain visibility, and help inspire thousands of
            designers while unlocking creator-only benefits.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
              What do you do?
            </label>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g, Product Designer"
              className="placeholder:text-[#a1a1aa]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
              Social Profile{" "}
              <span className="font-normal text-[#71717b]">(X, Linkedin, etc)</span>
            </label>
            <Input
              value={social}
              onChange={(e) => {
                setSocial(e.target.value);
                setSocialTouched(false);
              }}
              placeholder="https://x.com/Praha37v"
              aria-invalid={socialInvalid}
              className={`placeholder:text-[#a1a1aa] ${
                socialInvalid
                  ? "border-[#ef4444] focus-visible:border-[#ef4444] focus-visible:ring-[#ef4444]/25"
                  : ""
              }`}
            />
            {socialInvalid && (
              <p className="text-[12px] tracking-[-0.03em] text-[#ef4444]">
                Enter a valid link (https://...)
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[14px] font-medium tracking-[-0.03em] text-[#09090b]">
              Why do you want to become a creator?
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us why you'd like to join…"
              className="h-[120px] placeholder:text-[#a1a1aa]"
            />
          </div>
        </div>

        {error && (
          <p className="text-[13px] tracking-[-0.03em] text-[#ef4444]">{error}</p>
        )}

        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="flex w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#2974ff] px-3 py-2 text-[14px] tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Applying…" : "Apply Now"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
