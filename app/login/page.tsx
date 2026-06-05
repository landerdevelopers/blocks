"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = `${siteUrl}/auth/callback`;

  const signInWithGoogle = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
  };

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 font-sans">
      <div className="w-full max-w-[400px] rounded-2xl border border-[#e7e9ee] bg-white p-7 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-[#dcfce7] text-[#16a34a]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 4h16v16H4z" opacity="0" />
                <path d="M22 6 12 13 2 6" />
                <rect x="2" y="4" width="20" height="16" rx="2" />
              </svg>
            </span>
            <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
              Check your inbox
            </h1>
            <p className="text-sm tracking-[-0.03em] text-[#71717b]">
              We sent a magic link to{" "}
              <span className="font-medium text-[#09090b]">{email}</span>. Click
              it to sign in.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#09090b]">
                Sign in
              </h1>
              <p className="text-sm tracking-[-0.03em] text-[#71717b]">
                Use Google or a magic link — no password needed.
              </p>
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-[#e4e4e7] bg-white px-4 py-2.5 text-sm font-medium tracking-[-0.03em] text-[#09090b] transition-colors hover:bg-[#fafafa]"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[#e4e4e7]" />
              <span className="text-xs tracking-[-0.03em] text-[#a1a1aa]">or</span>
              <div className="h-px flex-1 bg-[#e4e4e7]" />
            </div>

            <form onSubmit={sendMagicLink} className="flex flex-col gap-2.5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-sm tracking-[-0.03em] text-[#09090b] outline-none placeholder:text-[#a1a1aa] focus:border-[#2974ff]"
              />
              <button
                type="submit"
                disabled={loading}
                className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-[#09090b] px-4 py-2.5 text-sm font-medium tracking-[-0.03em] text-white transition-colors hover:bg-[#27272a] disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send magic link"}
              </button>
            </form>

            {error && (
              <p className="text-center text-xs tracking-[-0.03em] text-[#ef4444]">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.48 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75Z" />
    </svg>
  );
}
