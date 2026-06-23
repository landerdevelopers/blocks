// Route-segment loading UI — painted instantly during navigation while the
// server page runs its (force-dynamic) analytics aggregates, so the route opens
// immediately with a skeleton instead of hanging on the previous page.
export default function AnalyticsLoading() {
  return (
    <main className="min-h-screen bg-[#f5f5f5] px-6 py-9 text-[#09090b]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
        <div className="h-7 w-44 animate-pulse rounded-md bg-[#ebebef]" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-[#e7e9ee] bg-white"
            />
          ))}
        </div>
        <div className="h-80 w-full animate-pulse rounded-2xl border border-[#e7e9ee] bg-white" />
      </div>
    </main>
  );
}
