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
}

const PwaContext = createContext<PwaContextValue>({
  isOffline: false,
  isInstallable: false,
  isInstalled: false,
  installPrompt: async () => {},
  swRegistration: null,
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
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;

    // Keep the server and initial client render identical, then synchronize
    // browser-only state after hydration.
    queueMicrotask(() => {
      if (!active) return;
      setIsOffline(!navigator.onLine);
      setIsInstalled(
        window.matchMedia("(display-mode: standalone)").matches ||
          ((window.navigator as unknown as { standalone?: boolean }).standalone === true),
      );
    });

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

    // Online/offline listeners
    const handleOnline = () => {
      setIsOffline(false);
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
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
      active = false;
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
  }, []);

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
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}
