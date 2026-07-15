"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useUser } from "@/contexts/user-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { THEME_OPTIONS, type ThemeOption } from "@/components/theme-provider";

function ThemeCard({
  option,
  isSelected,
  onSelect,
}: {
  option: ThemeOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isBase = option.group === "base";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        relative flex flex-col rounded-lg border p-3 text-left transition-all cursor-pointer
        ${
          isSelected
            ? "border-primary shadow-[0_0_20px_var(--glow)]"
            : "border-border hover:border-border-strong/30"
        }
      `}
    >
      {/* Selected check icon */}
      {isSelected && (
        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {isBase ? (
        /* Base theme: Mini UI preview */
        <div className="mb-2 flex h-16 w-full overflow-hidden rounded border border-border-subtle">
          {/* Mini sidebar */}
          <div
            className={`w-1/4 flex flex-col gap-1 p-1 ${
              option.value === "light"
                ? "bg-white"
                : option.value === "dark"
                  ? "bg-zinc-900"
                  : "bg-gradient-to-b from-zinc-100 to-zinc-900"
            }`}
          >
            <div
              className={`h-1 w-full rounded-sm ${
                option.value === "light" ? "bg-zinc-300" : option.value === "dark" ? "bg-zinc-700" : "bg-zinc-500"
              }`}
            />
            <div
              className={`h-1 w-3/4 rounded-sm ${
                option.value === "light" ? "bg-primary/70" : option.value === "dark" ? "bg-primary" : "bg-primary"
              }`}
            />
            <div
              className={`h-1 w-full rounded-sm ${
                option.value === "light" ? "bg-zinc-200" : option.value === "dark" ? "bg-zinc-800" : "bg-zinc-600"
              }`}
            />
          </div>
          {/* Mini content */}
          <div
            className={`flex-1 p-1.5 ${
              option.value === "light"
                ? "bg-zinc-50"
                : option.value === "dark"
                  ? "bg-zinc-950"
                  : "bg-gradient-to-b from-zinc-50 to-zinc-950"
            }`}
          >
            <div
              className={`h-1.5 w-2/3 rounded-sm mb-1 ${
                option.value === "light" ? "bg-zinc-300" : option.value === "dark" ? "bg-zinc-700" : "bg-zinc-500"
              }`}
            />
            <div
              className={`h-1 w-full rounded-sm mb-0.5 ${
                option.value === "light" ? "bg-zinc-200" : option.value === "dark" ? "bg-zinc-800" : "bg-zinc-600"
              }`}
            />
            <div
              className={`h-1 w-4/5 rounded-sm ${
                option.value === "light" ? "bg-zinc-200" : option.value === "dark" ? "bg-zinc-800" : "bg-zinc-600"
              }`}
            />
          </div>
        </div>
      ) : (
        /* Custom theme: Color swatch bar */
        <div className="mb-2 flex h-6 w-full overflow-hidden rounded">
          {option.colors.map((color, i) => (
            <div
              key={i}
              className="flex-1"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}

      <p className="text-sm font-medium text-foreground">{option.label}</p>
      {option.group === "custom" && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {option.description}
        </p>
      )}
    </button>
  );
}

export default function SettingsPage() {
  const { user, loading } = useUser();
  const { theme, setTheme } = useTheme();
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('omp-items-per-page') || '12';
    return '12';
  });
  const [defaultView, setDefaultView] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('omp-default-view') || 'grid';
    return 'grid';
  });
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [revealingToken, setRevealingToken] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const regenerateToken = async () => {
    setRegenerating(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/auth/regenerate-token", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setApiToken(data.token);
        setShowConfirm(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setTokenError(data.error || "Failed to regenerate token");
      }
    } catch {
      setTokenError("Failed to regenerate token. Please check your connection.");
    } finally {
      setRegenerating(false);
    }
  };

  const copyToken = async () => {
    if (apiToken) {
      await navigator.clipboard.writeText(apiToken);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const revealToken = async () => {
    setRevealingToken(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/auth/token", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTokenError(data.error || "Failed to reveal token");
        return;
      }
      setApiToken(data.token);
    } catch {
      setTokenError("Failed to reveal token. Please check your connection.");
    } finally {
      setRevealingToken(false);
    }
  };

  const baseThemes = THEME_OPTIONS.filter((t) => t.group === "base");
  const customThemes = THEME_OPTIONS.filter((t) => t.group === "custom");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your prompt workspace
        </p>
      </div>

      <div className="grid gap-6">
        {/* User Token Section */}
        <Card>
          <CardHeader>
            <CardTitle>API Token</CardTitle>
            <CardDescription>
              Your personal token for prompt sync and capture hooks (Claude Code supported)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="h-10 bg-skeleton rounded animate-pulse max-w-md" />
            ) : user ? (
              <>
                {apiToken ? (
                  <div className="flex gap-3">
                    <Input
                      type="text"
                      value={apiToken}
                      readOnly
                      aria-label="API token"
                      className="font-mono text-sm max-w-md"
                    />
                    <Button
                      variant="outline"
                      onClick={copyToken}
                      className="shrink-0"
                      aria-label="Copy API token"
                    >
                    {copied ? (
                      <svg
                        className="h-4 w-4 text-chart-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={revealToken}
                    disabled={revealingToken}
                  >
                    {revealingToken ? "Revealing..." : "Reveal API Token"}
                  </Button>
                )}
                <div className="bg-surface/50 rounded-lg p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-secondary-foreground mb-2">Quick Setup (Recommended)</p>
                  <p className="mb-2">
                    Run the CLI setup wizard to automatically configure your prompt capture hook:
                  </p>
                  <pre className="bg-surface p-3 rounded text-xs overflow-x-auto">
{`omp setup`}
                  </pre>
                </div>

                {tokenError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                    {tokenError}
                  </div>
                )}

                {/* Regenerate Token */}
                <div className="pt-4 border-t border-border">
                  {showConfirm ? (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                      <p className="text-destructive text-sm mb-3">
                        Are you sure? This will invalidate your current token. You&apos;ll need to update your prompt capture hook configuration.
                      </p>
                      <div className="flex gap-3">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={regenerateToken}
                          disabled={regenerating}
                        >
                          {regenerating ? "Regenerating..." : "Yes, Regenerate"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowConfirm(false)}
                          disabled={regenerating}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShowConfirm(true)}
                      className="text-destructive hover:text-destructive/80 hover:border-destructive/30"
                    >
                      <svg
                        className="h-4 w-4 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Regenerate Token
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No token available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Basic dashboard settings and preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Items per page
              </label>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(e.target.value);
                  localStorage.setItem('omp-items-per-page', e.target.value);
                }}
                className="flex h-10 w-full max-w-xs rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Default view
              </label>
              <select
                value={defaultView}
                onChange={(e) => {
                  setDefaultView(e.target.value);
                  localStorage.setItem('omp-default-view', e.target.value);
                }}
                className="flex h-10 w-full max-w-xs rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="grid">Grid</option>
                <option value="list">List</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Customize the look and feel of the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Base themes */}
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                Base
              </label>
              <div className="grid grid-cols-3 gap-3">
                {baseThemes.map((t) => (
                  <ThemeCard
                    key={t.value}
                    option={t}
                    isSelected={theme === t.value}
                    onSelect={() => setTheme(t.value)}
                  />
                ))}
              </div>
            </div>

            {/* Custom themes */}
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                Custom
              </label>
              <div className="grid grid-cols-2 gap-3">
                {customThemes.map((t) => (
                  <ThemeCard
                    key={t.value}
                    option={t}
                    isSelected={theme === t.value}
                    onSelect={() => setTheme(t.value)}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
