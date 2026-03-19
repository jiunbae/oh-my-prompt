import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <Skeleton className="h-8 w-28 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Search bar */}
      <div className="space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-8 w-56 rounded-lg" />
        </div>
      </div>

      {/* Placeholder content area */}
      <div className="flex flex-col items-center py-12">
        <Skeleton className="h-12 w-12 rounded-full mb-4" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-72 mt-2" />
      </div>
    </div>
  );
}
