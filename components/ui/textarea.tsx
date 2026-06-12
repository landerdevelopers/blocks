import * as React from "react";

// shadcn/ui-style Textarea, adapted to the project palette (no theme tokens / cn
// dependency). Border + shadow per the design; scrollbar hidden; focus ring.
function Textarea({
  className = "",
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={`flex w-full resize-none rounded-[12px] border border-[#ebebeb] bg-white p-2.5 text-[14px] tracking-[-0.03em] text-black shadow-[0px_1px_2px_rgba(10,13,20,0.03)] outline-none transition-[color,box-shadow] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden placeholder:text-[#71717b] focus-visible:border-[#2974ff] focus-visible:ring-[3px] focus-visible:ring-[#2974ff]/25 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export { Textarea };
