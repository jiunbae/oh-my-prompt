"use client";

import { useState, useEffect } from "react";
import { usePwaContext } from "@/components/pwa-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PwaSettingsPage() {
  const { isOffline, isInstallable, isInstalled, installPrompt } = usePwaContext();
  const [cacheInfo, setCacheInfo] = useState<{ static: number; api: number }>({ static: 0, api: 0 });
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    async function getCacheInfo() {
      try {
        const staticKeys = await caches.keys();
        const staticCount = staticKeys.filter((n) => n.startsWith("omp-static")).length;

        const apiCache = await caches.open("omp-api-cache");
        const apiRequests = await apiCache.keys();

        setCacheInfo({ static: staticCount, api: apiRequests.length });
      } catch {
        // Cache API not available
      }
    }
    getCacheInfo();
  }, [clearing]);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((name) => caches.delete(name)));
      setCacheInfo({ static: 0, api: 0 });
    } catch {
      // Ignore
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">PWA &amp; Offline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Progressive Web App settings and offline cache management
        </p>
      </div>

      {/* Install Status */}
      <Card>
        <CardHeader>
          <CardTitle>App Installation</CardTitle>
          <CardDescription>
            Install Oh My Prompt as a standalone app on your device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isInstalled ? (
            <div className="flex items-center gap-3 p-3 bg-chart-2/10 border border-chart-2/20 rounded-lg">
              <svg className="h-5 w-5 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-chart-2 font-medium">
                Oh My Prompt is installed as a standalone app
              </span>
            </div>
          ) : isInstallable ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You can install Oh My Prompt for quick access from your home screen or taskbar.
              </p>
              <Button onClick={installPrompt}>
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Install App
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Installation is available through your browser menu. Look for &quot;Install Oh My Prompt&quot; or &quot;Add to Home Screen&quot; in the browser settings.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Chrome, Edge, and Safari on mobile support PWA installation
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offline Status */}
      <Card>
        <CardHeader>
          <CardTitle>Network Status</CardTitle>
          <CardDescription>
            Current connectivity and offline capability
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                isOffline ? "bg-destructive" : "bg-chart-2"
              }`}
            />
            <span className="text-sm font-medium text-secondary-foreground">
              {isOffline ? "Offline" : "Online"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {isOffline
              ? "You are currently offline. Cached prompts and sessions are available for browsing."
              : "You are connected. Recent data is cached automatically for offline access."}
          </p>
        </CardContent>
      </Card>

      {/* Cache Management */}
      <Card>
        <CardHeader>
          <CardTitle>Offline Cache</CardTitle>
          <CardDescription>
            Manage locally cached data for offline browsing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-border bg-surface/50">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-1">
                Static Assets
              </p>
              <p className="text-2xl font-semibold text-foreground">
                {cacheInfo.static > 0 ? "Cached" : "Empty"}
              </p>
            </div>
            <div className="p-4 rounded-lg border border-border bg-surface/50">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-1">
                API Responses
              </p>
              <p className="text-2xl font-semibold text-foreground">
                {cacheInfo.api}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleClearCache}
            disabled={clearing}
            className="text-destructive hover:text-destructive/80 hover:border-destructive/30"
          >
            <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {clearing ? "Clearing..." : "Clear All Caches"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
