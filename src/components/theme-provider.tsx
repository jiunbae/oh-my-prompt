"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

type BaseThemeOption = {
  value: "light" | "dark" | "system";
  label: string;
  group: "base";
};

type CustomThemeOption = {
  value: "midnight-ocean" | "forest-dusk" | "sunset-glow" | "lavender-mist";
  label: string;
  group: "custom";
  colors: readonly string[];
  description: string;
};

export type ThemeOption = BaseThemeOption | CustomThemeOption;

export const THEME_OPTIONS = [
  { value: "light", label: "Light", group: "base" },
  { value: "dark", label: "Dark", group: "base" },
  { value: "system", label: "System", group: "base" },
  {
    value: "midnight-ocean",
    label: "Midnight Ocean",
    group: "custom",
    colors: ["#0a0e1a", "#06b6d4", "#3b82f6", "#164e63"],
    description: "Deep navy with cyan accents",
  },
  {
    value: "forest-dusk",
    label: "Forest Dusk",
    group: "custom",
    colors: ["#0c1208", "#d97706", "#65a30d", "#365314"],
    description: "Warm greens with amber glow",
  },
  {
    value: "sunset-glow",
    label: "Sunset Glow",
    group: "custom",
    colors: ["#150a0a", "#f97316", "#ef4444", "#7c2d12"],
    description: "Warm coral and orange tones",
  },
  {
    value: "lavender-mist",
    label: "Lavender Mist",
    group: "custom",
    colors: ["#0f0a1a", "#a78bfa", "#ec4899", "#4c1d95"],
    description: "Cool purple and violet hues",
  },
] as const satisfies readonly ThemeOption[];

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      themes={[
        "light",
        "dark",
        "midnight-ocean",
        "forest-dusk",
        "sunset-glow",
        "lavender-mist",
      ]}
    >
      {children}
    </NextThemesProvider>
  );
}
