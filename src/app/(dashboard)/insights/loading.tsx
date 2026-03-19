import { Skeleton } from "@/components/ui/skeleton";

export default function InsightsLoading() {
  return (
    <div className="space-y-8">
      {/* Page title */}
      <div>
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Ask Your Data section */}
      <div className="rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-10 w-full rounded-md mb-3" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Recent Insights section */}
      <div className="rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-5 w-36 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>

      {/* Session Stories section */}
      <div className="rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-5 w-36 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <Skeleton className="h-5 w-48 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
