import { cookies } from "next/headers";
import { locales, defaultLocale, LOCALE_COOKIE, type Locale } from "./config";

function toSupportedLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null;
}

/**
 * Resolve the active locale for a server-side request. Prefer an explicit
 * request header from client-side fetches, then fall back to the NEXT_LOCALE
 * cookie. This mirrors `./request.ts` while remaining usable from route
 * handlers and tRPC procedures.
 */
export async function getRequestLocale(headers?: Headers): Promise<Locale> {
  const headerLocale = toSupportedLocale(headers?.get("x-omp-locale"));
  if (headerLocale) return headerLocale;

  const store = await cookies();
  return toSupportedLocale(store.get(LOCALE_COOKIE)?.value) ?? defaultLocale;
}
