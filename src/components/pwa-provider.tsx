"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaContextValue {
  isOffline: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  installPrompt: () => Promise<void>;
  swRegistration: ServiceWorkerRegistration | null;
  syncComplete: boolean;
}

const PwaContext = createContext<PwaContextValue>({
  isOffline: false,
  isInstallable: false,
  isInstalled: false,
  installPrompt: async () => {},
  swRegistration: null,
  syncComplete: false,
});

export function usePwaContext() {
  return useContext(PwaContext);
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [isOffline, setIsOffline] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [syncComplete, setSyncComplete] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          setSwRegistration(registration);
          console.log("[PWA] Service Worker registered:", registration.scope);
        })
        .catch((err) => {
          console.error("[PWA] Service Worker registration failed:", err);
        });
    }

    // Check initial online status
    setIsOffline(!navigator.onLine);

    // Check if already installed
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ((window.navigator as unknown as { standalone?: boolean }).standalone ===
        true);
    setIsInstalled(isStandalone);

    // Online/offline listeners
    const handleOnline = () => {
      setIsOffline(false);
      // Trigger background sync if available
      if (swRegistration && "sync" in swRegistration) {
        (swRegistration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("omp-sync").catch(() => {});
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Display mode changes
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsInstalled(e.matches);
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleDisplayChange);
    } else {
      mediaQuery.addListener(handleDisplayChange as EventListener);
    }

    // beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setIsInstallable(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // appinstalled
    const handleAppInstalled = () => {
      setIsInstallable(false);
      setIsInstalled(true);
      deferredPromptRef.current = null;
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    // SW messages
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "offline-status") {
        setIsOffline(e.data.data?.isOffline ?? false);
      }
      if (e.data?.type === "sync-complete") {
        setSyncComplete(true);
        setTimeout(() => setSyncComplete(false), 3000);
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleDisplayChange);
      } else {
        mediaQuery.removeListener(handleDisplayChange as EventListener);
      }
    };
  }, [swRegistration]);

  const installPrompt = useCallback(async () => {
    const deferredPrompt = deferredPromptRef.current;
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setIsInstallable(false);
    deferredPromptRef.current = null;
  }, []);

  return (
    <PwaContext.Provider
      value={{
        isOffline,
        isInstallable,
        isInstalled,
        installPrompt,
        swRegistration,
        syncComplete,
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}
