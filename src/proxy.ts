import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type SessionCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return {
    url: url.replace(/\/rest\/v1\/?$/, ""),
    key,
  };
}

function applySession(
  response: NextResponse,
  sessionCookies: SessionCookie[],
  headers: Record<string, string>,
) {
  sessionCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
}

export async function proxy(request: NextRequest) {
  const { url, key } = supabaseEnv();
  let sessionCookies: SessionCookie[] = [];
  let sessionHeaders: Record<string, string> = {};
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        sessionCookies = cookiesToSet;
        sessionHeaders = headers;
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        applySession(supabaseResponse, sessionCookies, sessionHeaders);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  if (!user && !isLogin) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySession(redirectResponse, sessionCookies, sessionHeaders);
    return redirectResponse;
  }

  if (user && isLogin) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySession(redirectResponse, sessionCookies, sessionHeaders);
    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
