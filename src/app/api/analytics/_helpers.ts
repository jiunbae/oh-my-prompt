import { resolveDateRange } from "@/lib/date-utils";

export function parseDateRange(searchParams: URLSearchParams): { from: Date; to: Date } {
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const range = resolveDateRange({ from: fromParam ?? undefined, to: toParam ?? undefined }, 30);
  return { from: range.from, to: range.to };
}
