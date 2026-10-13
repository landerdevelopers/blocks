"use client";

import * as React from "react";

const FADE = 32; // px — fade height at each scrollable edge

// Scroll container that fades its content at whichever edge still has more to
// scroll (top once scrolled down, bottom while more remains below). Implemented
// with a CSS mask so the fade reveals the page behind it instead of painting a
// solid color. Adapted from @ncdai/scroll-fade-effect to project conventions.
function ScrollFadeEffect({
  className = "",
  showScrollbar = false,
  children,
  style,
  ...props
}: React.ComponentProps<"div"> & { showScrollbar?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [mask, setMask] = React.useState("none");

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const fadeTop = scrollTop > 0;
    const fadeBottom = scrollTop + clientHeight < scrollHeight - 1;
    if (!fadeTop && !fadeBottom) {
      setMask("none");
      return;
    }
    const top = fadeTop ? "transparent" : "black";
    const bottom = fadeBottom ? "transparent" : "black";
    setMask(
      `linear-gradient(to bottom, ${top} 0, black ${FADE}px, black calc(100% - ${FADE}px), ${bottom} 100%)`,
    );
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  return (
    <div
      ref={ref}
      data-slot="scroll-fade-effect"
      onScroll={update}
      className={`overflow-y-auto ${
        showScrollbar
          ? // Thin scrollbar that only appears while the content overflows.
            "[scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#d4d4d8] [&::-webkit-scrollbar-track]:bg-transparent"
          : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      } ${className}`}
      style={{ ...style, maskImage: mask, WebkitMaskImage: mask }}
      {...props}
    >
      {children}
    </div>
  );
}

export { ScrollFadeEffect };
