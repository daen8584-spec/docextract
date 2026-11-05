import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/cookies";

/**
 * Optimistic redirect for pages: requests without a session cookie go to the
 * login page. This is a UX shortcut only. Every page and API route still
 * validates the session against the database.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
