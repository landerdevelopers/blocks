"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Grant / revoke a creator's access. Lives inside the (linked) creator row, so
// it stops the click from navigating to the portal.
export default function CreatorAccessButton({
  userId,
  isCreator,
}: {
  userId: string;
  isCreator: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/creator-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: isCreator ? "revoke" : "grant" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium tracking-[-0.03em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        isCreator
          ? "border-[#ffd5d5] bg-[#ffe9e9] text-[#ef4444] hover:bg-[#ffdede]"
          : "border-[#cfe6d4] bg-[#e7f8ec] text-[#16a34a] hover:bg-[#d9f4e0]"
      }`}
    >
      {busy ? "…" : isCreator ? "Remove access" : "Give access"}
    </button>
  );
}
