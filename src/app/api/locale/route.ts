import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { locales, LOCALE_COOKIE, type Locale } from "@/i18n/config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ success: true, locale });
}
