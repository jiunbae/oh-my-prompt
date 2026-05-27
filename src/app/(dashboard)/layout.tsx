import { getTranslations } from "next-intl/server";
import { Sidebar, MobileHeader, MobileSidebarProvider } from "@/components/sidebar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tCommon = await getTranslations("common");
  return (
    <MobileSidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {tCommon("skipToContent")}
      </a>
      <KeyboardShortcuts />
      <div className="flex h-screen flex-col md:flex-row">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-0">
          <MobileHeader />
          <main id="main-content" className="flex-1 overflow-auto">
            <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </MobileSidebarProvider>
  );
}
