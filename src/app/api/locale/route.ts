import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { locales, LOCALE_COOKIE, type Locale } from "@/i18n/config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Match the Secure-cookie rule used for the auth cookie (src/lib/auth.ts).
 * Plain-HTTP deployments (no TLS terminator in front) must opt out via
 * COOKIE_SECURE=false or the browser silently drops the locale cookie and
 * the language switcher appears to do nothing.
 */
const COOKIE_SECURE =
  process.env.COOKIE_SECURE != null
    ? process.env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const locale = (body as { locale?: unknown })?.locale;
  if (typeof locale !== "string" || !locales.includes(locale as Locale)) {
    return NextResponse.json(
      { error: "Unsupported locale" },
      { status: 400 }
    );
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    secure: COOKIE_SECURE,
  });

  return NextResponse.json({ success: true, locale });
}
