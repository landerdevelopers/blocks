// Full-screen gate shown only below 1024px (lg). CSS-only (lg:hidden) so it
// needs no JS and causes no hydration mismatch.
export default function MobileGate() {
  return (
    <div className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-1 bg-white px-8 text-center lg:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/Desktop.webp" alt="" className="mb-2 w-40 object-contain" />
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#09090b]">
        Switch to Desktop
      </h1>
      <p className="max-w-sm text-base leading-6 tracking-[-0.03em] text-[#71717b]">
        This application is optimized for larger screens. Please switch to a
        desktop or laptop.
      </p>
    </div>
  );
}
