import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <Skeleton className="h-8 w-28 mb-2" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="grid gap-6">
        {/* API Token card */}
        <div className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-5 w-24 mb-2" />
          <Skeleton className="h-4 w-80 mb-4" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>

        {/* General card */}
        <div className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-5 w-20 mb-2" />
          <Skeleton className="h-4 w-64 mb-4" />
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full max-w-xs" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full max-w-xs" />
            </div>
          </div>
        </div>

        {/* Appearance card */}
        <div className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-5 w-28 mb-2" />
          <Skeleton className="h-4 w-72 mb-6" />
          <div className="space-y-6">
            <div className="space-y-3">
              <Skeleton className="h-3 w-12" />
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Skeleton className="h-3 w-16" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
