"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchMode = "keyword" | "semantic" | "hybrid";

interface SearchResult {
  id: string;
  timestamp: string;
  projectName: string | null;
  promptText: string;
  source: string | null;
  sessionId: string | null;
  score: number;
  matchType: SearchMode;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  mode: SearchMode;
  query: string;
}

interface FilterOption {
  name: string;
  count: number;
}

interface FiltersResponse {
  projects: FilterOption[];
  sources: FilterOption[];
}

const modeLabels: Record<SearchMode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
};

const modeDescriptions: Record<SearchMode, string> = {
  keyword: "Full-text search using PostgreSQL tsvector. Best for exact keyword matches.",
  semantic: "Trigram similarity search. Finds prompts with similar character patterns, even with typos.",
  hybrid: "Combines keyword ranking (40%) with trigram similarity (60%) for best overall results.",
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatScore(score: number): string {
  return (score * 100).toFixed(1) + "%";
}

function PaginationNav({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const getPageNumbers = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("ellipsis");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Search results pagination">
      {currentPage > 1 && (
        <button
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Go to previous page"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {getPageNumbers().map((pg, idx) =>
        pg === "ellipsis" ? (
          <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground text-sm">
            ...
          </span>
        ) : (
          <button
            key={pg}
            onClick={() => onPageChange(pg)}
            className={`inline-flex items-center justify-center h-9 min-w-9 px-3 rounded-lg text-sm font-medium transition-colors ${
              pg === currentPage
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            aria-label={`Go to page ${pg}`}
            aria-current={pg === currentPage ? "page" : undefined}
          >
            {pg}
          </button>
        )
      )}

      {currentPage < totalPages && (
        <button
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Go to next page"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </nav>
  );
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL
  const urlQuery = searchParams.get("q") ?? "";
  const urlMode = (searchParams.get("mode") as SearchMode) || "hybrid";
  const urlPage = parseInt(searchParams.get("page") ?? "1", 10);
  const urlProject = searchParams.get("project") ?? "";
  const urlSource = searchParams.get("source") ?? "";
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";

  const [query, setQuery] = useState(urlQuery);
  const [mode, setMode] = useState<SearchMode>(urlMode);
  const [project, setProject] = useState(urlProject);
  const [source, setSource] = useState(urlSource);
  const [fromDate, setFromDate] = useState(urlFrom);
  const [toDate, setToDate] = useState(urlTo);
  const [showFilters, setShowFilters] = useState(!!(urlProject || urlSource || urlFrom || urlTo));

  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(urlPage);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(!!urlQuery);
  const [error, setError] = useState<string | null>(null);

  const [filterOptions, setFilterOptions] = useState<FiltersResponse>({ projects: [], sources: [] });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch filter options on mount
  useEffect(() => {
    fetch("/api/search/filters")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FiltersResponse | null) => {
        if (data) setFilterOptions(data);
      })
      .catch(() => {});
  }, []);

  const buildUrl = useCallback(
    (overrides: Record<string, string | undefined> = {}) => {
      const p: Record<string, string> = {};
      const q = overrides.q !== undefined ? overrides.q : query.trim();
      const m = overrides.mode !== undefined ? overrides.mode : mode;
      const pg = overrides.page !== undefined ? overrides.page : String(page);
      const proj = overrides.project !== undefined ? overrides.project : project;
      const src = overrides.source !== undefined ? overrides.source : source;
      const f = overrides.from !== undefined ? overrides.from : fromDate;
      const t = overrides.to !== undefined ? overrides.to : toDate;

      if (q) p.q = q;
      if (m && m !== "hybrid") p.mode = m;
      if (pg && pg !== "1") p.page = pg;
      if (proj) p.project = proj;
      if (src) p.source = src;
      if (f) p.from = f;
      if (t) p.to = t;

      const qs = new URLSearchParams(p).toString();
      return `/search${qs ? `?${qs}` : ""}`;
    },
    [query, mode, page, project, source, fromDate, toDate]
  );

  const doSearch = useCallback(
    async (opts: {
      searchPage?: number;
      searchProject?: string;
      searchSource?: string;
      searchFrom?: string;
      searchTo?: string;
    } = {}) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      setSearched(true);
      setResults([]);
      setTotal(0);

      const searchPage = opts.searchPage ?? 1;
      const searchProject = opts.searchProject ?? project;
      const searchSource = opts.searchSource ?? source;
      const searchFrom = opts.searchFrom ?? fromDate;
      const searchTo = opts.searchTo ?? toDate;

      try {
        const fetchParams = new URLSearchParams({
          q: trimmed,
          mode,
          limit: "50",
          page: String(searchPage),
        });
        if (searchProject) fetchParams.set("project", searchProject);
        if (searchSource) fetchParams.set("source", searchSource);
        if (searchFrom) fetchParams.set("from", searchFrom);
        if (searchTo) fetchParams.set("to", searchTo);

        const res = await fetch(`/api/search?${fetchParams.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Search failed");
        }
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTotal(data.total);
        setPage(data.page);
        setPageSize(data.pageSize);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
        setTotal(0);
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [query, mode, project, source, fromDate, toDate]
  );

  const handleSearch = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;

      setPage(1);
      const url = buildUrl({ page: "1" });
      router.replace(url, { scroll: false });
      doSearch({ searchPage: 1 });
    },
    [query, buildUrl, router, doSearch]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      const url = buildUrl({ page: String(newPage) });
      router.replace(url, { scroll: false });
      doSearch({ searchPage: newPage });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [buildUrl, router, doSearch]
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const newProject = key === "project" ? value : project;
      const newSource = key === "source" ? value : source;
      const newFrom = key === "from" ? value : fromDate;
      const newTo = key === "to" ? value : toDate;

      if (key === "project") setProject(value);
      if (key === "source") setSource(value);
      if (key === "from") setFromDate(value);
      if (key === "to") setToDate(value);
      setPage(1);

      const url = buildUrl({
        page: "1",
        project: newProject || undefined,
        source: newSource || undefined,
        from: newFrom || undefined,
        to: newTo || undefined,
      });
      router.replace(url, { scroll: false });

      if (query.trim() && searched) {
        doSearch({
          searchPage: 1,
          searchProject: newProject,
          searchSource: newSource,
          searchFrom: newFrom,
          searchTo: newTo,
        });
      }
    },
    [project, source, fromDate, toDate, query, searched, buildUrl, router, doSearch]
  );

  const handleClearFilters = useCallback(() => {
    setProject("");
    setSource("");
    setFromDate("");
    setToDate("");
    setPage(1);

    const url = buildUrl({
      project: undefined,
      source: undefined,
      from: undefined,
      to: undefined,
      page: "1",
    });
    router.replace(url, { scroll: false });

    if (query.trim() && searched) {
      doSearch({
        searchPage: 1,
        searchProject: "",
        searchSource: "",
        searchFrom: "",
        searchTo: "",
      });
    }
  }, [query, searched, buildUrl, router, doSearch]);

  // Run search on mount if URL has a query
  useEffect(() => {
    if (urlQuery) {
      doSearch({ searchPage: urlPage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.ceil(total / pageSize);
  const hasFilters = !!(project || source || fromDate || toDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find prompts by keyword, similarity, or both
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <Input
              type="search"
              placeholder="Search your prompts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching..." : "Search"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
          >
            <svg
              className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="ml-2">Filters</span>
          </Button>
        </div>

        {/* Search mode selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Mode:</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(["keyword", "semantic", "hybrid"] as SearchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={modeDescriptions[m]}
              >
                {modeLabels[m]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {modeDescriptions[mode]}
          </span>
        </div>
      </form>

      {/* Filters panel */}
      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-surface/50 rounded-lg border border-border">
          <div className="space-y-1">
            <label htmlFor="search-project-filter" className="text-xs text-muted-foreground font-medium">Project</label>
            <select
              id="search-project-filter"
              value={project}
              onChange={(e) => handleFilterChange("project", e.target.value)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All projects</option>
              {filterOptions.projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="search-source-filter" className="text-xs text-muted-foreground font-medium">Agent</label>
            <select
              id="search-source-filter"
              value={source}
              onChange={(e) => handleFilterChange("source", e.target.value)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            >
              <option value="">All agents</option>
              {filterOptions.sources.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="search-from-filter" className="text-xs text-muted-foreground font-medium">From Date</label>
            <input
              id="search-from-filter"
              type="date"
              value={fromDate}
              onChange={(e) => handleFilterChange("from", e.target.value)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="search-to-filter" className="text-xs text-muted-foreground font-medium">To Date</label>
            <input
              id="search-to-filter"
              type="date"
              value={toDate}
              onChange={(e) => handleFilterChange("to", e.target.value)}
              className="w-full px-3 py-2 bg-input-bg border border-border rounded-md text-foreground text-sm"
            />
          </div>
        </div>
      )}

      {/* Active filter badges */}
      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Active filters:</span>
          {project && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-chart-2/20 text-chart-2 rounded-full text-xs">
              Project: {project}
              <button type="button" onClick={() => handleFilterChange("project", "")} className="hover:text-foreground">x</button>
            </span>
          )}
          {source && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-chart-3/20 text-chart-3 rounded-full text-xs">
              Agent: {source}
              <button type="button" onClick={() => handleFilterChange("source", "")} className="hover:text-foreground">x</button>
            </span>
          )}
          {(fromDate || toDate) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-chart-4/20 text-chart-4 rounded-full text-xs">
              Date: {fromDate || "..."} - {toDate || "..."}
              <button
                type="button"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                  const url = buildUrl({ from: undefined, to: undefined, page: "1" });
                  router.replace(url, { scroll: false });
                  if (query.trim() && searched) {
                    doSearch({ searchPage: 1, searchFrom: "", searchTo: "" });
                  }
                }}
                className="hover:text-foreground"
              >
                x
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <p className="font-medium">Search error</p>
          <p className="mt-1 text-destructive/80">{error}</p>
        </div>
      )}

      {searched && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          {total} result{total !== 1 ? "s" : ""} found
          {total > 0 && (
            <span> using <span className="font-medium text-foreground">{modeLabels[mode]}</span> search</span>
          )}
          {totalPages > 1 && (
            <span className="ml-1">(page {page} of {totalPages})</span>
          )}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <Link
              key={result.id}
              href={`/prompts/${result.id}`}
              className="block"
            >
              <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-4 mb-2">
                    <p className="text-sm text-foreground line-clamp-2 sm:line-clamp-3 whitespace-pre-line flex-1">
                      {result.promptText}
                    </p>
                    <Badge
                      variant={result.score > 0.5 ? "success" : result.score > 0.2 ? "warning" : "secondary"}
                      className="shrink-0"
                    >
                      {formatScore(result.score)}
                    </Badge>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(result.timestamp)}</span>
                    {result.projectName && (
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground/50 hidden sm:inline">·</span>
                        <Badge variant="secondary">{result.projectName}</Badge>
                      </span>
                    )}
                    {result.source && (
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground/50 hidden sm:inline">·</span>
                        <Badge variant="outline">{result.source}</Badge>
                      </span>
                    )}
                    {result.sessionId && (
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground/50 hidden sm:inline">·</span>
                        <span className="text-muted-foreground/70 truncate">
                          Session: {result.sessionId.slice(0, 8)}...
                        </span>
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <PaginationNav
          currentPage={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}

      {searched && !loading && !error && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>No results found for &quot;{query}&quot;</p>
          <p className="text-sm mt-1">
            Try a different search term or switch to{" "}
            {mode === "keyword" ? "Semantic" : mode === "semantic" ? "Hybrid" : "Keyword"} mode.
          </p>
        </div>
      )}

      {!searched && (
        <div className="text-center py-12 text-muted-foreground">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>Enter a search query to find prompts</p>
          <p className="text-sm mt-2">
            <span className="font-medium">Keyword</span> finds exact matches.{" "}
            <span className="font-medium">Semantic</span> finds similar text.{" "}
            <span className="font-medium">Hybrid</span> combines both.
          </p>
        </div>
      )}
    </div>
  );
}
