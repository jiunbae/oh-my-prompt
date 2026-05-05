import { Sidebar, MobileHeader, MobileSidebarProvider } from "@/components/sidebar";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MobileSidebarProvider>
      <KeyboardShortcuts />
      <div className="flex h-screen flex-col md:flex-row">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-0">
          <MobileHeader />
          <main className="flex-1 overflow-auto">
            <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </MobileSidebarProvider>
  );
}
