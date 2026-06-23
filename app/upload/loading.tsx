// Route-segment loading UI — shown instantly while the heavy UploadForm chunk
// loads, so the page opens immediately with a skeleton instead of a blank gap.
export default function UploadLoading() {
  return (
    <main className="flex min-h-screen justify-center bg-[#f5f5f5] px-4 py-10 font-sans">
      <div className="flex w-full max-w-[628px] flex-col gap-5 rounded-2xl border border-[#e7e9ee] bg-white p-7 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 animate-pulse rounded-md bg-[#ebebef]" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded-md bg-[#ebebef]" />
        </div>
        <div className="h-40 w-full animate-pulse rounded-xl bg-[#ebebef]" />
        <div className="h-11 w-full animate-pulse rounded-xl bg-[#ebebef]" />
        <div className="h-11 w-full animate-pulse rounded-xl bg-[#ebebef]" />
        <div className="h-11 w-40 animate-pulse rounded-xl bg-[#ebebef]" />
      </div>
    </main>
  );
}
