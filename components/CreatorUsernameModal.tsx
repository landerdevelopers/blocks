"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore, type Profile } from "@/store/authStore";

// Post-approval onboarding for new creators. Forced (no close button, no
// outside-click) until the creator claims a unique username. Mirrors
// OnboardingModal's self-healing portal so it can't be dismissed by removing
// the node from the DOM.
type Availability =
  | { state: "idle" }
  | { state: "invalid" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken" }
  | { state: "error" };

// Same rule as set_my_username() in the DB: 3–20 chars, a-z 0-9 underscore.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function CreatorUsernameModal() {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  const [username, setUsername] = useState("");
  // Result of the most recent network probe, tagged with the handle it was for
  // so a stale result for an older handle is ignored when deriving `avail`.
  const [remote, setRemote] = useState<{
    handle: string;
    result: "available" | "taken" | "error";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatValid = USERNAME_RE.test(username);

  // Normalize as the user types — lowercase, strip a leading @, keep only the
  // allowed charset. Keeps the input in lockstep with what the DB will accept.
  const onChange = (raw: string) => {
    const next = raw
      .toLowerCase()
      .replace(/^@+/, "")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 20);
    setUsername(next);
    setError(null);
  };

  // Debounced availability check. Only fires for well-formed handles; probes
  // is_username_available 400ms after the last keystroke. The `active` flag
  // drops out-of-order responses. All setState happens inside the timeout
  // (deferred, never synchronous in the effect body).
  useEffect(() => {
    if (!formatValid) return;
    let active = true;
    const id = setTimeout(async () => {
      const { data, error: rpcErr } = await supabase.rpc(
        "is_username_available",
        { uname: username },
      );
      if (!active) return;
      setRemote({
        handle: username,
        result: rpcErr ? "error" : data ? "available" : "taken",
      });
    }, 400);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [username, formatValid, supabase]);

  // Availability is derived: empty/invalid resolve synchronously; otherwise show
  // the network result for the current handle, or "checking" while it's pending.
  const avail: Availability =
    username.length === 0
      ? { state: "idle" }
      : !formatValid
        ? { state: "invalid" }
        : remote?.handle === username
          ? { state: remote.result }
          : { state: "checking" };

  const canSubmit = avail.state === "available" && !saving;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("set_my_username", {
      uname: username,
    });
    setSaving(false);
    if (rpcErr) {
      setError("Something went wrong. Please try again.");
      return;
    }
    if (!data?.ok) {
      if (data?.error === "taken")
        setRemote({ handle: username, result: "taken" });
      else if (data?.error === "invalid")
        setError("That username isn't valid. Try another.");
      else setError("Something went wrong. Please try again.");
      return;
    }
    // Reflect the claimed handle locally so the modal's trigger condition
    // (role === 'creator' && !creator_onboarded) flips off immediately.
    if (profile) {
      setProfile({
        ...profile,
        username: data.username as string,
        creator_onboarded: true,
      } as Profile);
    }
  };

  // Self-healing portal host — re-append if anything detaches it while the modal
  // is still required.
  const [host] = useState(() =>
    typeof document !== "undefined" ? document.createElement("div") : null,
  );
  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    const observer = new MutationObserver(() => {
      if (!document.body.contains(host)) document.body.appendChild(host);
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      if (document.body.contains(host)) document.body.removeChild(host);
    };
  }, [host]);

  if (!host) return null;

  // Helper text below the input, colored by availability state.
  const hint = (() => {
    switch (avail.state) {
      case "invalid":
        return {
          text: "3–20 characters: letters, numbers, or underscores.",
          color: "#71717b",
        };
      case "checking":
        return { text: "Checking availability…", color: "#71717b" };
      case "available":
        return { text: `@${username} is available`, color: "#16a34a" };
      case "taken":
        return { text: `@${username} is already taken`, color: "#ff2f2f" };
      case "error":
        return { text: "Couldn't check right now. Try again.", color: "#ff2f2f" };
      default:
        return null;
    }
  })();

  return createPortal(
    <div
      style={{ zIndex: 99999 }}
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 font-sans backdrop-blur-sm"
    >
      <form
        onSubmit={onSubmit}
        className="flex h-fit w-[384px] flex-col gap-5 rounded-[20px] bg-white p-[24px] shadow-[0px_12px_40px_rgba(0,0,0,0.2)]"
      >
        {/* Header — badge icon + title + subtitle, centered */}
        <div className="flex flex-col items-center gap-4 px-[6px] pt-[10px]">
          <div className="flex items-center justify-center rounded-[10px] bg-[#e3f7ec] p-2">
            <BadgeCheck size={22} strokeWidth={2} className="text-[#16a34a]" />
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[18px] font-medium tracking-[-0.03em] text-[#09090b]">
              You&rsquo;re Now a Creator
            </p>
            <p className="text-[16px] tracking-[-0.03em] text-[#71717b]">
              Choose a unique username to complete your creator profile and start
              publishing designs.
            </p>
          </div>
        </div>

        {/* Username field with a fixed @ prefix */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[14px] font-medium tracking-[-0.03em] text-black">
            Username <span className="text-[#ff2f2f]">*</span>
          </label>
          <div className="flex h-[36px] items-center overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] focus-within:border-[#2974ff]">
            <span className="pl-[9px] text-[14px] tracking-[-0.03em] text-[#757575]">
              @
            </span>
            <input
              value={username}
              onChange={(e) => onChange(e.target.value)}
              placeholder="username"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="h-full w-full bg-transparent pl-[2px] pr-[9px] text-[14px] tracking-[-0.03em] text-black outline-none placeholder:text-[#757575]"
            />
          </div>
          {hint && (
            <p
              className="text-[12px] tracking-[-0.03em]"
              style={{ color: hint.color }}
            >
              {hint.text}
            </p>
          )}
          {error && (
            <p className="text-[12px] tracking-[-0.03em] text-[#ff2f2f]">
              {error}
            </p>
          )}
        </div>

        {/* Complete */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full cursor-pointer rounded-[10px] bg-[#2974ff] py-2 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#1b63e6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Complete"}
        </button>
      </form>
    </div>,
    host,
  );
}
