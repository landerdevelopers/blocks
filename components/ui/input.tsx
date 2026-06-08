import * as React from "react";

// shadcn/ui-style Input, adapted to the project palette (no theme tokens / cn
// dependency). Adds a focus ring + border highlight for a polished feel.
function Input({ className = "", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={`flex h-10 w-full min-w-0 rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-[14px] tracking-[-0.03em] text-black shadow-xs outline-none transition-[color,box-shadow] placeholder:text-[#757575] focus-visible:border-[#2974ff] focus-visible:ring-[3px] focus-visible:ring-[#2974ff]/25 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export { Input };
