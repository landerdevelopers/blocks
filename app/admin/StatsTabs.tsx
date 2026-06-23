"use client";

import { useState } from "react";

type Win = "today" | "7d" | "all";
const TABS: Record<Win, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  all: "All Time",
};

export type StatCard = { key: string; label: string; color: string };

// Today / 7d / All-time tabbed stat cards. `windows` is the RPC's per-window
// object ({ today, "7d", all }); `cards` defines which keys to show.
export default function StatsTabs({
  windows,
  cards,
}: {
  windows: Record<Win, Record<string, number>> | null;
  cards: StatCard[];
}) {
  const [win, setWin] = useState<Win>("today");
  const data = windows?.[win] ?? {};

  return (
    <section className="flex flex-col gap-3">
      <div className="flex w-fit gap-1 rounded-xl border border-[#e7e9ee] bg-white p-1 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        {(Object.keys(TABS) as Win[]).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWin(w)}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium tracking-[-0.03em] transition-colors ${
              win === w
                ? "bg-[#09090b] text-white"
                : "text-[#52525b] hover:bg-[#f5f5f5]"
            }`}
          >
            {TABS[w]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.key}
            className="flex flex-col gap-1.5 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]"
          >
            <span className="text-[13px] tracking-[-0.03em] text-[#71717b]">
              {c.label}
            </span>
            <span
              className="text-[28px] font-semibold leading-none tracking-[-0.04em] tabular-nums"
              style={{ color: c.color }}
            >
              {(data[c.key] ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
