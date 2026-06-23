// Route-segment loading UI — painted instantly during navigation (while the
// heavy client page chunk + data load) so the portal opens immediately with a
// skeleton instead of a blank delay. Mirrors the page's own first-load skeleton.
export default function CreatorPortalLoading() {
  return (
    <main className="min-h-screen bg-white font-sans">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[30px] px-6 py-10 sm:px-12 sm:py-[60px]">
        <div className="h-9 w-24 animate-pulse rounded-[10px] bg-[#ebebef]" />
        <div className="flex flex-col gap-[26px]">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="size-[90px] shrink-0 animate-pulse rounded-[20px] bg-[#ebebef]" />
              <div className="flex flex-col gap-2">
                <div className="h-6 w-40 animate-pulse rounded-md bg-[#ebebef]" />
                <div className="h-4 w-24 animate-pulse rounded-md bg-[#ebebef]" />
              </div>
            </div>
            <div className="h-4 w-[320px] max-w-full animate-pulse rounded-md bg-[#ebebef]" />
          </div>
          <div className="h-10 w-full max-w-[420px] animate-pulse rounded-[10px] bg-[#f5f5f5]" />
          <div className="columns-1 gap-[22px] sm:columns-2 lg:columns-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="mb-[22px] break-inside-avoid animate-pulse rounded-[12px] bg-[#ebebef]"
                style={{ height: 180 + (i % 3) * 70 }}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
