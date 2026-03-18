"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { THEME_OPTIONS } from "@/components/theme-provider";

const themeIcons: Record<string, React.ReactNode> = {
  light: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  dark: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
  system: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  "midnight-ocean": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
  "forest-dusk": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  ),
  "sunset-glow": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  "lavender-mist": (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  ),
};

function getThemeIcon(themeValue: string) {
  return themeIcons[themeValue] || themeIcons.dark;
}

function getThemeLabel(themeValue: string) {
  const option = THEME_OPTIONS.find((o) => o.value === themeValue);
  return option?.label ?? "Theme";
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!mounted) {
    return <div className="h-8 w-8" />;
  }

  const baseThemes = THEME_OPTIONS.filter((o) => o.group === "base");
  const customThemes = THEME_OPTIONS.filter((o) => o.group === "custom");

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors text-sm"
        title="Change theme"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {getThemeIcon(theme ?? "dark")}
        <span className="hidden sm:inline">{getThemeLabel(theme ?? "dark")}</span>
        <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-border bg-card p-1 shadow-lg"
          role="listbox"
          aria-label="Theme options"
        >
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Base</div>
          {baseThemes.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={theme === opt.value}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                theme === opt.value
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/50"
              }`}
              onClick={() => {
                setTheme(opt.value);
                setOpen(false);
              }}
            >
              {getThemeIcon(opt.value)}
              <span>{opt.label}</span>
              {theme === opt.value && (
                <svg className="ml-auto h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          <div className="my-1 border-t border-border" />

          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Custom</div>
          {customThemes.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={theme === opt.value}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                theme === opt.value
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/50"
              }`}
              onClick={() => {
                setTheme(opt.value);
                setOpen(false);
              }}
            >
              <div className="flex gap-0.5">
                {"colors" in opt &&
                  opt.colors.map((color, i) => (
                    <span
                      key={i}
                      className="inline-block h-3 w-3 rounded-full border border-border/50"
                      style={{ backgroundColor: color }}
                    />
                  ))}
              </div>
              <span>{opt.label}</span>
              {theme === opt.value && (
                <svg className="ml-auto h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
