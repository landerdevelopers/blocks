"use client";

import Link from "next/link";
import { useState } from "react";

type Row = {
  uid: string;
  email: string;
  name: string;
  count: number;
  components: string[];
  lastLogin: string | null;
};

type SortKey = "copies" | "login";

// Render at most this many rows before the "Show all" toggle.
const INITIAL = 50;

// ISO timestamp → readable IST string (e.g. "15 Jun 2026, 3:42 pm").
function fmtIST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function PerUserActivity({
  rows,
  day,
  categoryById,
}: {
  rows: Row[];
  day: string;
  categoryById: Record<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<SortKey>("copies");

  const sorted = [...rows].sort((a, b) => {
    if (sort === "copies") return b.count - a.count;
    // Recent login: latest first, users with no login last.
    if (!a.lastLogin && !b.lastLogin) return 0;
    if (!a.lastLogin) return 1;
    if (!b.lastLogin) return -1;
    return b.lastLogin.localeCompare(a.lastLogin); // ISO strings sort lexically
  });
  const visible = showAll ? sorted : sorted.slice(0, INITIAL);
  const moreCount = rows.length - INITIAL;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.03em] text-[#09090b]">
          Per-user activity · {day} (IST)
        </h2>
        <label className="flex items-center gap-2 text-xs tracking-[-0.03em] text-[#71717b]">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="cursor-pointer rounded-lg border border-[#e7e9ee] bg-white px-2.5 py-1.5 text-sm font-medium text-[#09090b] outline-none"
          >
            <option value="copies">Number of copies</option>
            <option value="login">Recent login</option>
          </select>
        </label>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm tracking-[-0.03em]">
          <thead>
            <tr className="border-b border-[#e7e9ee] bg-[#fafafa] text-left text-xs text-[#71717b]">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 text-right font-medium">Copies</th>
              <th className="px-5 py-3 font-medium">Last login</th>
              <th className="px-5 py-3 font-medium">Component IDs</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-[#71717b]">
                  No copies on {day}.
                </td>
              </tr>
            ) : (
              visible.map((u) => (
                <tr
                  key={u.uid}
                  className="border-b border-[#f0f1f3] align-top transition-colors last:border-0 hover:bg-[#fafafa]"
                >
                  <td className="px-5 py-3">{u.email}</td>
                  <td className="px-5 py-3">{u.name}</td>
                  <td className="px-5 py-3 text-right font-medium">{u.count}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-[#52525b]">
                    {fmtIST(u.lastLogin)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.components.map((id, idx) => (
                        <Link
                          key={`${id}-${idx}`}
                          href={`/upload/${id}/edit`}
                          title={`${categoryById[id] ?? "—"} · ${id}`}
                          className="rounded-md bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px] text-[#52525b] transition-colors hover:bg-[#e7e9ee]"
                        >
                          {id.slice(0, 8)}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {moreCount > 0 && (
          <div className="border-t border-[#f0f1f3] p-3 text-center">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm font-medium tracking-[-0.03em] text-[#52525b] underline-offset-2 hover:underline"
            >
              {showAll ? "Show less" : `Show all (${moreCount} more)`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
