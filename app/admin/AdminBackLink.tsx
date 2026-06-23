import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Top-left "Go Back" link shared across the admin pages — returns to the
// homepage. Server-safe (plain Link, no client state).
export default function AdminBackLink() {
  return (
    <Link
      href="/"
      className="flex w-fit items-center gap-1 rounded-[10px] border border-[#e7e9ee] bg-white px-2 py-2 text-sm tracking-[-0.03em] text-[#71717b] shadow-[0px_1px_2px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#fafafa]"
    >
      <ArrowLeft size={18} strokeWidth={1.5} />
      <span className="px-1">Go Back</span>
    </Link>
  );
}
