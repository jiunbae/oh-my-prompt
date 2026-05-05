import { SessionCard } from "@/components/session-card";
import { SessionFilters } from "@/components/session-filters";
import { SessionViewToggle, type ViewMode } from "@/components/session-view-toggle";
import { SessionTimelineView } from "@/components/session-timeline-view";
import { SharedSessionsList } from "@/components/shared-sessions-list";
import { getSessionUser } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lte, sql, desc, inArray, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface SearchParams {
  tab?: string;
  page?: string;
  search?: string;
  searchMode?: string;
  project?: string;
  source?: string;
  device?: string;
  workspace?: string;
  from?: string;
  to?: string;
  view?: string;
}

const getCurrentUser = getSessionUser;

interface SessionRow {
  session_id: string;
  display_name: string | null;
  started_at: string;
  ended_at: string;
  prompt_count: number;
  response_count: number;
  project_name: string | null;
  source: string | null;
  device_name: string | null;
  first_prompt: string;
  total_tokens: number;
}

async function getSessions(params: SearchParams, userId: string, onlyFavoriteIds?: Set<string>) {

  const page = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(schema.prompts.userId, userId),
    sql`${schema.prompts.sessionId} IS NOT NULL`,
    isNull(schema.prompts.deletedAt),
  ];

  // Filter to favorites only
  if (onlyFavoriteIds !== undefined) {
    if (onlyFavoriteIds.size === 0) {
      return { sessions: [], totalCount: 0, projects: [], sources: [], devices: [], workspaces: [] };
    }
    conditions.push(inArray(schema.prompts.sessionId, [...onlyFavoriteIds]));
  }

  if (params.project) conditions.push(eq(schema.prompts.projectName, params.project));
  if (params.source) conditions.push(eq(schema.prompts.source, params.source));
  if (params.device) conditions.push(eq(schema.prompts.deviceName, params.device));
  if (params.workspace) conditions.push(eq(schema.prompts.workingDirectory, params.workspace));
  if (params.from) conditions.push(gte(schema.prompts.timestamp, new Date(params.from)));
  if (params.to) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.prompts.timestamp, toDate));
  }
  if (params.search) {
    const searchMode = params.searchMode || "keyword";
    if (searchMode === "semantic") {
      conditions.push(
        sql`LEFT(${schema.prompts.promptText}, 500) % ${params.search} AND similarity(LEFT(${schema.prompts.promptText}, 500), ${params.search}) > 0.1`
      );
    } else if (searchMode === "hybrid") {
      conditions.push(
        sql`(${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${params.search}) OR (LEFT(${schema.prompts.promptText}, 500) % ${params.search} AND similarity(LEFT(${schema.prompts.promptText}, 500), ${params.search}) > 0.1))`
      );
    } else {
      conditions.push(
        sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${params.search})`
      );
    }
  }

  const whereClause = and(...conditions);

  // Base conditions for filter options (user's sessions only)
  const baseConditions = and(
    eq(schema.prompts.userId, userId),
    sql`${schema.prompts.sessionId} IS NOT NULL`,
    isNull(schema.prompts.deletedAt),
  );

  try {
    const [sessionsResult, countResult, projectsResult, sourcesResult, devicesResult, workspacesResult] = await Promise.all([
      db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
          ${schema.sessionDisplayNames.displayName} as display_name,
          MIN(${schema.prompts.timestamp}) as started_at,
          MAX(${schema.prompts.timestamp}) as ended_at,
          COUNT(*)::int as prompt_count,
          COUNT(${schema.prompts.responseText})::int as response_count,
          (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
          (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
          (array_agg(${schema.prompts.deviceName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as device_name,
          LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
          SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
        FROM ${schema.prompts}
        LEFT JOIN ${schema.sessionDisplayNames}
          ON ${schema.sessionDisplayNames.userId} = ${userId}
         AND ${schema.sessionDisplayNames.sessionId} = ${schema.prompts.sessionId}
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.sessionId}, ${schema.sessionDisplayNames.displayName}
        ORDER BY MAX(${schema.prompts.timestamp}) DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `),
      db
        .select({ name: schema.prompts.projectName, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.projectName} IS NOT NULL`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.source, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.source} IS NOT NULL`))
        .groupBy(schema.prompts.source)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.deviceName, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.deviceName} IS NOT NULL`))
        .groupBy(schema.prompts.deviceName)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`)),
      db
        .select({ name: schema.prompts.workingDirectory, count: sql<number>`count(distinct ${schema.prompts.sessionId})` })
        .from(schema.prompts)
        .where(and(baseConditions, sql`${schema.prompts.workingDirectory} IS NOT NULL AND ${schema.prompts.workingDirectory} != 'unknown'`))
        .groupBy(schema.prompts.workingDirectory)
        .orderBy(desc(sql`count(distinct ${schema.prompts.sessionId})`))
        .limit(50),
    ]);



    const sRows = extractRows(sessionsResult) as unknown as SessionRow[];
    const cRows = extractRows(countResult);
    return {
      sessions: sRows,
      totalCount: Number((cRows[0] as Record<string, unknown>)?.count ?? 0),
      projects: projectsResult.map((p) => ({ name: p.name ?? "", count: Number(p.count) })),
      sources: sourcesResult.map((s) => ({ name: s.name ?? "", count: Number(s.count) })),
      devices: devicesResult.map((d) => ({ name: d.name ?? "", count: Number(d.count) })),
      workspaces: workspacesResult.map((w) => ({ name: w.name ?? "", count: Number(w.count) })),
    };
  } catch (error) {
    logger.error({ err: error }, "Sessions query error");

    return { sessions: [], totalCount: 0, projects: [], sources: [], devices: [], workspaces: [], error: true };
  }
}

function PaginationNav({
  currentPage,
  totalPages,
  buildPageUrl,
}: {
  currentPage: number;
  totalPages: number;
  buildPageUrl: (page: number) => string;
}) {
  // Generate page numbers to display
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
    <nav className="flex items-center justify-center gap-2 sm:gap-1" aria-label="Session list pagination">
      {currentPage > 1 && (
        <Link
          href={buildPageUrl(currentPage - 1)}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-9 sm:w-9 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Go to previous page"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      )}

      {getPageNumbers().map((page, idx) =>
        page === "ellipsis" ? (
          <span key={`ellipsis-${idx}`} className="px-1 sm:px-2 text-muted-foreground text-sm">
            ...
          </span>
        ) : (
          <Link
            key={page}
            href={buildPageUrl(page)}
            className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-[36px] sm:h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
              page === currentPage
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            aria-label={`Go to page ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </Link>
        )
      )}

      {currentPage < totalPages && (
        <Link
          href={buildPageUrl(currentPage + 1)}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-9 sm:w-9 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Go to next page"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </nav>
  );
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const activeTab = params.tab === "shared" ? "shared" : params.tab === "favorites" ? "favorites" : "all";
  const viewMode = (params.view as ViewMode) || "list";

  // Fetch user's favorite session IDs
  const favoriteRows = await db
    .select({ sessionId: schema.favoriteSessions.sessionId })
    .from(schema.favoriteSessions)
    .where(eq(schema.favoriteSessions.userId, user.userId));
  const favoriteSessionIds = new Set(favoriteRows.map((f) => f.sessionId));

  const { sessions, totalCount, projects, sources, devices, workspaces, error } = activeTab === "all" || activeTab === "favorites"
    ? await getSessions(params, user.userId, activeTab === "favorites" ? favoriteSessionIds : undefined)
    : { sessions: [], totalCount: 0, projects: [], sources: [], devices: [], workspaces: [], error: false };
  const currentPage = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize);

  const buildPageUrl = (page: number) => {
    const p = new URLSearchParams();
    if (page > 1) p.set("page", String(page));
    if (params.tab) p.set("tab", params.tab);
    if (params.search) p.set("search", params.search);
    if (params.searchMode) p.set("searchMode", params.searchMode);
    if (params.project) p.set("project", params.project);
    if (params.source) p.set("source", params.source);
    if (params.device) p.set("device", params.device);
    if (params.workspace) p.set("workspace", params.workspace);
    if (params.from) p.set("from", params.from);
    if (params.to) p.set("to", params.to);
    if (params.view && params.view !== "list") p.set("view", params.view);
    const qs = p.toString();
    return `/sessions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab === "shared"
              ? "Manage your shared session links"
              : activeTab === "favorites"
              ? `Your favorite sessions (${totalCount} total)`
              : `Browse your Claude Code sessions (${totalCount} total)`}
          </p>
        </div>
        {(activeTab === "all" || activeTab === "favorites") && <SessionViewToggle currentView={viewMode} />}
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border">
        <Link
          href="/sessions"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "all"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          All Sessions
        </Link>
        <Link
          href="/sessions?tab=favorites"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "favorites"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Favorites
          {favoriteSessionIds.size > 0 && (
            <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {favoriteSessionIds.size}
            </span>
          )}
        </Link>
        <Link
          href="/sessions?tab=shared"
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "shared"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Shared
        </Link>
      </div>

      {activeTab === "shared" ? (
        <SharedSessionsList />
      ) : (
      <>
      <SessionFilters
        projects={projects}
        sources={sources}
        devices={devices}
        workspaces={workspaces}
        currentSearch={params.search}
        currentSearchMode={params.searchMode}
        currentProject={params.project}
        currentSource={params.source}
        currentDevice={params.device}
        currentWorkspace={params.workspace}
        currentFrom={params.from}
        currentTo={params.to}
      />

      {error ? (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <p className="font-medium">Failed to load sessions</p>
          <p className="mt-1 opacity-80">A database error occurred. Please try again later.</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No sessions found.</p>
          <p className="text-sm mt-1">
            {activeTab === "favorites"
              ? "Star a session to add it to your favorites."
              : "Sessions are created when prompts share a session ID."}
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              sessionId={s.session_id}
              displayName={s.display_name}
              firstPrompt={s.first_prompt}
              startedAt={String(s.started_at)}
              endedAt={String(s.ended_at)}
              promptCount={s.prompt_count}
              responseCount={s.response_count}
              projectName={s.project_name}
              source={s.source}
              deviceName={s.device_name}
              totalTokens={s.total_tokens}
              variant="grid"
              isFavorited={favoriteSessionIds.has(s.session_id)}
            />
          ))}
        </div>
      ) : viewMode === "timeline" ? (
        <SessionTimelineView sessions={sessions} />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              sessionId={s.session_id}
              displayName={s.display_name}
              firstPrompt={s.first_prompt}
              startedAt={String(s.started_at)}
              endedAt={String(s.ended_at)}
              promptCount={s.prompt_count}
              responseCount={s.response_count}
              projectName={s.project_name}
              source={s.source}
              deviceName={s.device_name}
              totalTokens={s.total_tokens}
              variant="list"
              isFavorited={favoriteSessionIds.has(s.session_id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <PaginationNav
          currentPage={currentPage}
          totalPages={totalPages}
          buildPageUrl={buildPageUrl}
        />
      )}
      </>
      )}
    </div>
  );
}
