import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UserProvider } from "@/contexts/user-context";
import { TeamProvider } from "@/contexts/team-context";
import { ThemeProvider } from "@/components/theme-provider";
import { OnboardingGuard } from "@/components/onboarding-guard";
import { PwaProvider } from "@/components/pwa-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Oh My Prompt — AI Coding Session Analytics",
  description:
    "Track, analyze, and share your Claude Code, Codex, and Gemini CLI sessions. Self-hosted prompt journal with quality scoring, token analytics, and session sharing. Free and open source.",
  keywords: [
    "claude code",
    "prompt engineering",
    "ai coding",
    "token usage tracking",
    "prompt analytics",
    "coding sessions",
    "ai assistant",
    "codex",
    "gemini cli",
    "prompt journal",
    "self-hosted",
    "developer tools",
    "session sharing",
    "quality scoring",
  ],
  openGraph: {
    title: "Oh My Prompt — AI Coding Session Analytics",
    description:
      "Track, analyze, and share your Claude Code, Codex, and Gemini CLI sessions. Self-hosted prompt journal with quality scoring and token analytics.",
    siteName: "Oh My Prompt",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oh My Prompt — AI Coding Session Analytics",
    description:
      "Track, analyze, and share your Claude Code, Codex, and Gemini CLI sessions. Free and open source.",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Oh My Prompt",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#3b82f6" },
    { media: "(prefers-color-scheme: dark)", color: "#3b82f6" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <PwaProvider>
          <ThemeProvider>
            <UserProvider>
              <TeamProvider>
                <OnboardingGuard>{children}</OnboardingGuard>
              </TeamProvider>
            </UserProvider>
          </ThemeProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
