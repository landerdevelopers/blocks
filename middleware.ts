import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Gates the creator/admin routes server-side. /upload and /creators are open to
// creators and admins; /analytics and /admin are admin-only. Everyone else is
// redirected to /. Role comes from the JWT app_metadata (fast, no DB round trip)
// with a profiles fallback.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect home while CARRYING the auth cookies Supabase just refreshed onto
  // `response`. A bare NextResponse.redirect drops them, so the browser keeps
  // the old (already-rotated) refresh token → the next getUser() can't refresh
  // → null → bounced again, stuck until a full re-login. Copying the cookies
  // over keeps the session consistent.
  const home = () => {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user) return home();

  // Role from the JWT app_metadata — getUser() already returns it (server-fresh,
  // synced from profiles.role by a DB trigger), so the common case needs NO
  // extra DB round trip. That second sequential query was what blocked the
  // response (incl. the loading skeleton) for 2-3s on cold serverless. Fall back
  // to a profiles read only when the claim is absent (e.g. a user predating the
  // sync), so access stays correct.
  let role = (user.app_metadata as { role?: string } | undefined)?.role;
  if (role !== "admin" && role !== "creator") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = profile?.role ?? role;
  }

  const path = request.nextUrl.pathname;
  // /upload and /creators are open to admins and creators; everything else here
  // (/analytics, /admin) is admin-only.
  const allowed =
    role === "admin" ||
    (role === "creator" &&
      (path.startsWith("/upload") || path.startsWith("/creators")));

  if (!allowed) return home();

  return response;
}

// Only run on the admin-gated routes.
export const config = {
  matcher: [
    "/upload",
    "/upload/:path*",
    "/analytics",
    "/analytics/:path*",
    "/admin",
    "/admin/:path*",
    "/creators",
    "/creators/:path*",
  ],
};
