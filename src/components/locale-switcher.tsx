"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Globe, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { locales, localeLabels, type Locale } from "@/i18n/config";

interface LocaleSwitcherProps {
  className?: string;
  align?: "start" | "end";
  variant?: "default" | "compact";
}

export function LocaleSwitcher({
  className,
  align = "end",
  variant = "default",
}: LocaleSwitcherProps) {
  const router = useRouter();
  const currentLocale = useLocale() as Locale;
  const t = useTranslations("locale");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectLocale = (locale: Locale) => {
    setOpen(false);
    if (locale === currentLocale) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale }),
        });
        if (res.ok) {
          router.refresh();
        }
      } catch {
        // swallow — UI stays on previous locale
      }
    });
  };

  const isCompact = variant === "compact";

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-left", className)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("switchLocale")}
        disabled={pending}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent text-foreground transition-colors duration-150",
          "hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          isCompact ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm"
        )}
      >
        <Globe className={isCompact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
        <span className="font-medium">{localeLabels[currentLocale]}</span>
        <ChevronDown
          className={cn(
            isCompact ? "h-3.5 w-3.5" : "h-4 w-4",
            "opacity-70 transition-transform duration-150",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 mt-2 min-w-[10rem] rounded-md border border-border bg-card text-card-foreground shadow-md py-1",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {locales.map((locale) => {
            const active = locale === currentLocale;
            return (
              <button
                key={locale}
                role="menuitemradio"
                aria-checked={active}
                type="button"
                onClick={() => selectLocale(locale)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm transition-colors duration-150",
                  "hover:bg-accent hover:text-foreground",
                  active && "font-medium"
                )}
              >
                <span>{localeLabels[locale]}</span>
                {active && <Check className="h-4 w-4" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LocaleSwitcher;
