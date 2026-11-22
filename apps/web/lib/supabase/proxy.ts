import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    return supabaseResponse;
  }

  const appliedCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const appliedHeaders: Record<string, string> = {};

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          appliedCookies.set(name, { name, value, options });
        });
        Object.assign(appliedHeaders, headers);

        supabaseResponse = NextResponse.next({
          request,
        });

        appliedCookies.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(appliedHeaders).forEach(([headerName, headerValue]) => {
          supabaseResponse.headers.set(headerName, headerValue);
        });
      },
    },
  });

  // Refresh session cookies via verified JWT claims; never redirect unauthenticated guests.
  try {
    await supabase.auth.getClaims();
  } catch {
    // Guest-first limited mode: visitors remain on `/` even if auth refresh fails.
  }

  return supabaseResponse;
}
