# Prompt Analytics Dashboard - Frontend & UX Design

## Executive Summary

This document outlines the frontend architecture, UI/UX design patterns, and implementation strategy for the Prompt Analytics Dashboard. The design prioritizes a clean, modern interface that enables efficient prompt browsing, powerful analytics visualization, and intuitive search functionality while maintaining excellent performance for a single-user personal project.

---

## 1. Frontend Architecture

### 1.1 Framework Recommendation: Next.js 14+ with App Router

**Primary Choice: Next.js 14+**

Rationale:
- **Server Components**: Reduce client-side JavaScript, faster initial loads
- **App Router**: Modern routing with layouts, loading states, and error boundaries built-in
- **Seamless Backend Integration**: API routes and tRPC integration in the same project
- **Streaming & Suspense**: Progressive loading for better perceived performance
- **Static + Dynamic**: Hybrid rendering for optimal performance per route
- **Ecosystem Alignment**: Matches the architecture recommendation for end-to-end TypeScript

```typescript
// Next.js App Router structure
app/
  layout.tsx              // Root layout with sidebar
  page.tsx                // Dashboard home (redirects to /prompts)
  (dashboard)/
    layout.tsx            // Dashboard layout with navigation
    prompts/
      page.tsx            // Prompts list view
      [id]/
        page.tsx          // Prompt detail view
    analytics/
      page.tsx            // Analytics overview
      tokens/
        page.tsx          // Token usage deep-dive
      patterns/
        page.tsx          // Usage patterns
    search/
      page.tsx            // Search interface
    settings/
      page.tsx            // Configuration
```

### 1.2 State Management Approach

**Recommendation: Server-First with Minimal Client State**

| State Type | Solution | Rationale |
|------------|----------|-----------|
| Server State | tRPC + TanStack Query | Automatic caching, revalidation, optimistic updates |
| URL State | nuqs (URL search params) | Shareable filter states, browser navigation |
| UI State | React useState/useReducer | Local component state only |
| Global UI | Zustand (minimal) | Theme, sidebar collapse, modal states |

```typescript
// Example: Using nuqs for URL-synced filter state
import { useQueryState, parseAsString, parseAsArrayOf } from 'nuqs';

export function usePromptFilters() {
  const [dateRange, setDateRange] = useQueryState('range', parseAsString.withDefault('7d'));
  const [models, setModels] = useQueryState('models', parseAsArrayOf(parseAsString));
  const [search, setSearch] = useQueryState('q', parseAsString);

  return {
    filters: { dateRange, models, search },
    setDateRange,
    setModels,
    setSearch,
  };
}
```

### 1.3 Component Library Selection

**Primary: shadcn/ui + Tailwind CSS**

Rationale:
- **Ownership**: Copy-paste components you own and can customize
- **Accessibility**: Built on Radix UI primitives with full ARIA support
- **Theming**: CSS variables enable easy dark/light mode
- **Performance**: No external CSS-in-JS runtime
- **Consistency**: Pre-designed components maintain visual coherence

**Additional Libraries:**
| Purpose | Library | Notes |
|---------|---------|-------|
| Charts | Recharts | React-native, composable, good for dashboards |
| Tables | TanStack Table | Headless, powerful sorting/filtering |
| Date Picker | react-day-picker | Lightweight, accessible |
| Icons | Lucide React | Consistent icon set, tree-shakeable |
| Code Display | react-syntax-highlighter | For displaying prompt/response code |
| Markdown | react-markdown | Render formatted responses |

```typescript
// Component architecture
components/
  ui/                     // shadcn/ui base components
    button.tsx
    card.tsx
    dialog.tsx
    ...
  prompts/                // Domain-specific components
    prompt-card.tsx
    prompt-list.tsx
    prompt-detail.tsx
    prompt-filters.tsx
  analytics/
    stat-card.tsx
    usage-chart.tsx
    token-breakdown.tsx
  layout/
    sidebar.tsx
    header.tsx
    breadcrumb.tsx
  shared/
    date-range-picker.tsx
    search-input.tsx
    loading-skeleton.tsx
```

---

## 2. Dashboard Layout Design

### 2.1 Main Dashboard Wireframe

```
+-----------------------------------------------------------------------------------+
|  [Logo] Prompt Analytics                    [Search...]  [Sync] [?] [Settings] [@]|
+-----------------------------------------------------------------------------------+
|         |                                                                          |
|  [Nav]  |  +------------------------------------------------------------------+  |
|         |  |  BREADCRUMB: Dashboard > Prompts                                 |  |
|  Home   |  +------------------------------------------------------------------+  |
|  -------+                                                                         |
|  Prompts|  +------------------------------------------------------------------+  |
|  -------+  |  QUICK STATS BAR                                                 |  |
|  Search |  |  +------------+  +------------+  +------------+  +------------+  |  |
|  -------+  |  | Total      |  | Today      |  | Tokens     |  | Avg Length |  |  |
| Analytics  |  | 1,247      |  | 23         |  | 2.4M       |  | 342 words  |  |  |
|  > Tokens  |  +------------+  +------------+  +------------+  +------------+  |  |
|  > Usage   |  +------------------------------------------------------------------+  |
|  > Patterns|                                                                       |
|  -------+  +------------------------------------------------------------------+  |
| Settings|  |  FILTERS & VIEW CONTROLS                                         |  |
|         |  |  [Date: Last 7 days v] [Model: All v] [Tags: +] [Grid|List] [Sort]|  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  PROMPT LIST / GRID                                              |  |
|         |  |                                                                  |  |
|         |  |  +----------------------+  +----------------------+              |  |
|         |  |  | Jan 15, 2:34 PM     |  | Jan 15, 1:12 PM     |              |  |
|         |  |  | Claude 3.5 Sonnet   |  | Claude 3 Opus       |              |  |
|         |  |  | 1,234 tokens        |  | 2,456 tokens        |              |  |
|         |  |  | --------------------|  | --------------------|              |  |
|         |  |  | "Create a React     |  | "Review this code   |              |  |
|         |  |  |  component that..." |  |  for security..."   |              |  |
|         |  |  | [coding] [react]    |  | [review] [security] |              |  |
|         |  |  +----------------------+  +----------------------+              |  |
|         |  |                                                                  |  |
|         |  |  +----------------------+  +----------------------+              |  |
|         |  |  | ...                  |  | ...                  |              |  |
|         |  |  +----------------------+  +----------------------+              |  |
|         |  |                                                                  |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  PAGINATION: < 1 2 3 ... 47 > | Showing 1-20 of 934             |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                          |
+---------+--------------------------------------------------------------------------+
```

### 2.2 Prompt Detail View Wireframe

```
+-----------------------------------------------------------------------------------+
|  [Logo] Prompt Analytics                    [Search...]  [Sync] [?] [Settings] [@]|
+-----------------------------------------------------------------------------------+
|         |                                                                          |
|  [Nav]  |  +------------------------------------------------------------------+  |
|         |  |  < Back to Prompts    |    [Copy] [Export] [Star] [...]         |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  PROMPT METADATA                                                 |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  |  | Session: abc-123-def | Jan 15, 2026 2:34 PM | Claude Sonnet| |  |
|         |  |  | Input: 856 tokens | Output: 1,423 tokens | Total: 2,279    | |  |
|         |  |  | Tags: [coding] [react] [components]        [+ Add Tag]     | |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  CONVERSATION                                                    |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  |  |  [You]                                     Jan 15, 2:34 PM | |  |
|         |  |  |  ----------------------------------------------------------| |  |
|         |  |  |  Create a React component that displays a sortable table   | |  |
|         |  |  |  with the following features:                               | |  |
|         |  |  |  - Column sorting (asc/desc)                                | |  |
|         |  |  |  - Pagination                                               | |  |
|         |  |  |  - Search filter                                            | |  |
|         |  |  |  ...                                                        | |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  |                                                                  |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  |  |  [Claude]                                  Jan 15, 2:35 PM | |  |
|         |  |  |  ----------------------------------------------------------| |  |
|         |  |  |  I'll create a React component with those features...       | |  |
|         |  |  |                                                             | |  |
|         |  |  |  ```typescript                                              | |  |
|         |  |  |  interface TableProps<T> {                                  | |  |
|         |  |  |    data: T[];                                               | |  |
|         |  |  |    columns: Column<T>[];                                    | |  |
|         |  |  |  }                                                          | |  |
|         |  |  |  ```                                                        | |  |
|         |  |  |  ...                                                        | |  |
|         |  |  +------------------------------------------------------------+ |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  RELATED PROMPTS (Similar topic/session)                        |  |
|         |  |  [Card 1] [Card 2] [Card 3]                                     |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                          |
+---------+--------------------------------------------------------------------------+
```

### 2.3 Analytics Dashboard Wireframe

```
+-----------------------------------------------------------------------------------+
|  [Logo] Prompt Analytics                    [Search...]  [Sync] [?] [Settings] [@]|
+-----------------------------------------------------------------------------------+
|         |                                                                          |
|  [Nav]  |  +------------------------------------------------------------------+  |
|         |  |  BREADCRUMB: Dashboard > Analytics                               |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  DATE RANGE SELECTOR                                             |  |
|         |  |  [Today] [7d] [30d] [90d] [Year] [Custom: ___ to ___]           |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +------------------------------------------------------------------+  |
|         |  |  KEY METRICS                                                     |  |
|         |  |  +------------+  +------------+  +------------+  +------------+  |  |
|         |  |  | Prompts    |  | Tokens     |  | Avg/Day    |  | Cost Est.  |  |  |
|         |  |  | 1,247      |  | 2.4M       |  | 34         |  | $12.50     |  |  |
|         |  |  | +12% ^     |  | +8% ^      |  | -5% v      |  | +15% ^     |  |  |
|         |  |  +------------+  +------------+  +------------+  +------------+  |  |
|         |  +------------------------------------------------------------------+  |
|         |                                                                         |
|         |  +--------------------------------+  +--------------------------------+  |
|         |  |  USAGE OVER TIME               |  |  TOKEN DISTRIBUTION           |  |
|         |  |  [Area Chart]                  |  |  [Pie/Donut Chart]            |  |
|         |  |                                |  |                                |  |
|         |  |     ^                          |  |      Input (45%)              |  |
|         |  |     |    /\    /\              |  |         /----\                |  |
|         |  |     |   /  \  /  \    /        |  |        |      |               |  |
|         |  |     |  /    \/    \  /         |  |         \----/                |  |
|         |  |     | /            \/          |  |      Output (55%)             |  |
|         |  |     +-------------------->     |  |                                |  |
|         |  |       Jan    Feb    Mar        |  |  [Sonnet 60%] [Opus 40%]      |  |
|         |  +--------------------------------+  +--------------------------------+  |
|         |                                                                         |
|         |  +--------------------------------+  +--------------------------------+  |
|         |  |  ACTIVITY HEATMAP              |  |  TOP CATEGORIES               |  |
|         |  |  [GitHub-style Heatmap]        |  |  [Horizontal Bar Chart]       |  |
|         |  |                                |  |                                |  |
|         |  |  Mon [][][][][][][]            |  |  Coding     ========== 45%   |  |
|         |  |  Tue [][][][][][][][]          |  |  Debug      ======     28%   |  |
|         |  |  Wed [][][][][][][]            |  |  Review     ====       18%   |  |
|         |  |  Thu [][][][][][]              |  |  Writing    ==          9%   |  |
|         |  |  Fri [][][][][][][][][]        |  |                                |  |
|         |  |  Sat [][]                      |  |                                |  |
|         |  |  Sun [][][]                    |  |                                |  |
|         |  +--------------------------------+  +--------------------------------+  |
|         |                                                                          |
+---------+--------------------------------------------------------------------------+
```

### 2.4 Navigation Flow

```
                                    +----------------+
                                    |   Dashboard    |
                                    |    (Home)      |
                                    +-------+--------+
                                            |
            +---------------+---------------+---------------+---------------+
            |               |               |               |               |
            v               v               v               v               v
    +-------+-------+ +-----+------+ +------+------+ +------+------+ +------+------+
    |    Prompts    | |   Search   | |  Analytics  | |   Settings  | |    Sync     |
    |     List      | |            | |   Overview  | |             | |   Status    |
    +-------+-------+ +-----+------+ +------+------+ +------+------+ +------+------+
            |               |               |
            v               |               +---------------+---------------+
    +-------+-------+       |               |               |               |
    |    Prompt     |       v               v               v               v
    |    Detail     |   [Results] ->   +----+----+   +------+------+  +-----+-----+
    +---------------+   [To Detail]    |  Tokens |   |   Patterns  |  | Categories|
                                       |  Usage  |   |             |  |           |
                                       +---------+   +-------------+  +-----------+
```

### 2.5 Responsive Design Considerations

**Breakpoints:**
```css
/* Tailwind breakpoint strategy */
--breakpoint-sm: 640px;   /* Mobile landscape */
--breakpoint-md: 768px;   /* Tablet */
--breakpoint-lg: 1024px;  /* Desktop */
--breakpoint-xl: 1280px;  /* Large desktop */
```

**Mobile Adaptations (< 768px):**
- Sidebar collapses to hamburger menu
- Cards stack vertically (single column)
- Stats bar scrolls horizontally
- Bottom navigation bar for primary actions
- Swipe gestures for prompt navigation

**Tablet Adaptations (768px - 1024px):**
- Sidebar becomes collapsible icon-only rail
- 2-column card grid
- Filters collapse into dropdown

**Desktop (> 1024px):**
- Full sidebar with labels
- 3-4 column card grid
- All filters visible

```
Mobile (<768px)           Tablet (768-1024px)        Desktop (>1024px)
+---------------+         +------------------+        +----------------------+
| [=] Title  [@]|         |[=]| Title    [@] |        | [Nav]  | Title  [@] |
+---------------+         +---+--------------+        +--------+------------+
| [Stats >>>]   |         | I | [Stats]      |        |        | [Stats]    |
+---------------+         | c +--------------|        | Home   |------------|
| +----------+  |         | o | [Grid]       |        | Prompts| [  Grid  ] |
| | Card 1   |  |         | n | +----+ +----+|        | Search | +--+ +--+  |
| +----------+  |         | s | |Card| |Card||        | Analyt | |  | |  |  |
| +----------+  |         |   | +----+ +----+|        |        | +--+ +--+  |
| | Card 2   |  |         |   |              |        |        | +--+ +--+  |
| +----------+  |         |   |              |        |        | |  | |  |  |
+---------------+         +---+--------------+        +--------+------------+
| [Home][Srch]  |
| [Anlyt][Set]  |
+---------------+
```

---

## 3. Key UI Components

### 3.1 Prompt List/Grid View

**Card Component Structure:**
```typescript
interface PromptCardProps {
  id: string;
  timestamp: Date;
  model: string;
  preview: string;           // First ~100 chars of user prompt
  inputTokens: number;
  outputTokens: number;
  tags: string[];
  isStarred: boolean;
}
```

**Card Layout (ASCII):**
```
+------------------------------------------+
| Jan 15, 2026 2:34 PM           [*] [...] |
| Claude 3.5 Sonnet                        |
+------------------------------------------+
| "Create a React component that displays  |
| a sortable table with pagination..."     |
+------------------------------------------+
| Input: 856  |  Output: 1,423  |  2,279   |
+------------------------------------------+
| [coding] [react] [+2]                    |
+------------------------------------------+
```

**View Modes:**
1. **Grid View**: 2-4 columns of cards (default)
2. **List View**: Full-width rows with more detail
3. **Compact View**: Dense list for power users

**Sorting Options:**
- Date (newest/oldest)
- Token count (highest/lowest)
- Conversation length (longest/shortest)

### 3.2 Prompt Detail View

**Layout Sections:**
1. **Header Bar**: Back navigation, actions (copy, export, star)
2. **Metadata Panel**: Session info, timestamps, token counts, tags
3. **Conversation Thread**: Alternating user/assistant messages
4. **Related Prompts**: Similar prompts sidebar/footer

**Message Display:**
```typescript
interface MessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tokens?: number;
}

// Rendering considerations:
// - Markdown rendering for assistant messages
// - Syntax highlighting for code blocks
// - Collapsible long messages (>500 words)
// - Copy button per message
// - Token count badge
```

**Code Block Component:**
```
+------------------------------------------------+
| typescript                        [Copy] [Wrap]|
+------------------------------------------------+
| 1 | interface TableProps<T> {                  |
| 2 |   data: T[];                               |
| 3 |   columns: Column<T>[];                    |
| 4 |   onSort?: (column: string) => void;       |
| 5 | }                                          |
+------------------------------------------------+
```

### 3.3 Analytics Charts and Visualizations

**Chart Components:**

1. **Usage Timeline (Area Chart)**
   - X-axis: Date/time
   - Y-axis: Prompt count or token count
   - Interactive hover tooltips
   - Brush selection for zoom

2. **Token Distribution (Donut Chart)**
   - Input vs Output tokens
   - Model breakdown
   - Interactive legend

3. **Activity Heatmap (Calendar Heatmap)**
   - GitHub-style contribution graph
   - Click to filter by date
   - Tooltip with daily stats

4. **Category Breakdown (Horizontal Bar)**
   - Top categories/tags
   - Percentage labels
   - Click to filter

**Stat Card Component:**
```
+------------------------+
| TOTAL PROMPTS          |
| 1,247                  |
| +12% vs last period ^  |
| [Sparkline ~~~~]       |
+------------------------+
```

### 3.4 Search and Filter Interface

**Search Bar:**
```
+----------------------------------------------------------------+
| [Q] Search prompts...                              [Filters v] |
+----------------------------------------------------------------+
```

**Advanced Filters Panel:**
```
+----------------------------------------------------------------+
| FILTERS                                              [Clear All]|
+----------------------------------------------------------------+
| Date Range        Model              Tags                       |
| [Last 7 days v]   [x] Claude Sonnet  [coding] [x]              |
|                   [x] Claude Opus    [review] [ ]              |
|                   [ ] Claude Haiku   [debug]  [ ]              |
|                                      [+ More]                   |
+----------------------------------------------------------------+
| Token Range       Has Code           Starred Only               |
| [0] ----o---- [10k]  [ ] Yes  [x] Any    [ ]                   |
+----------------------------------------------------------------+
| [Apply Filters]                                   [Save Filter] |
+----------------------------------------------------------------+
```

**Search Results:**
- Highlighted matching text
- Filter chips showing active filters
- Result count with query time
- Sort options

### 3.5 Settings and Configuration

**Settings Sections:**
```
+----------------------------------------------------------------+
| SETTINGS                                                        |
+----------------------------------------------------------------+
| [General]  [Appearance]  [Data]  [Sync]  [Keyboard]            |
+----------------------------------------------------------------+

GENERAL
+----------------------------------------------------------------+
| Default View          [Grid v]                                  |
| Items per Page        [20 v]                                    |
| Default Date Range    [Last 7 days v]                           |
+----------------------------------------------------------------+

APPEARANCE
+----------------------------------------------------------------+
| Theme                 ( ) Light  (x) Dark  ( ) System          |
| Accent Color          [Blue v]                                  |
| Code Font             [JetBrains Mono v]                        |
| Font Size             [Medium v]                                |
+----------------------------------------------------------------+

DATA SYNC
+----------------------------------------------------------------+
| MinIO Status          [Connected] [Test Connection]             |
| Last Sync             Jan 15, 2026 3:45 PM                     |
| Auto-sync Interval    [15 minutes v]                            |
| [Sync Now]            [View Sync Log]                           |
+----------------------------------------------------------------+
```

---

## 4. Data Visualization Strategy

### 4.1 Chart Library Recommendation: Recharts

**Why Recharts:**
- React-native composable API
- Good documentation and community
- Responsive and accessible
- Supports all needed chart types
- SSR compatible with Next.js

**Alternative: Tremor**
- Higher-level dashboard components
- Less customization but faster to implement
- Good for analytics-focused dashboards

**Recommendation:** Start with Tremor for rapid MVP, migrate to Recharts if customization needs increase.

```typescript
// Example: Usage timeline with Tremor
import { AreaChart, Card, Title } from '@tremor/react';

export function UsageTimeline({ data }: { data: UsageData[] }) {
  return (
    <Card>
      <Title>Prompts Over Time</Title>
      <AreaChart
        data={data}
        index="date"
        categories={['prompts', 'tokens']}
        colors={['blue', 'cyan']}
        valueFormatter={formatNumber}
        showLegend
        showGridLines
      />
    </Card>
  );
}
```

### 4.2 Key Metrics to Visualize

**Primary Metrics (Always Visible):**
| Metric | Visualization | Purpose |
|--------|--------------|---------|
| Total Prompts | Stat card + trend | Volume tracking |
| Token Usage | Stat card + breakdown | Cost awareness |
| Daily Average | Stat card + sparkline | Usage patterns |
| Activity Heatmap | Calendar heatmap | When you code |

**Secondary Metrics (Analytics Page):**
| Metric | Visualization | Purpose |
|--------|--------------|---------|
| Usage Over Time | Area/Line chart | Trend analysis |
| Model Distribution | Donut chart | Model preference |
| Token Input/Output | Stacked bar | Conversation balance |
| Category Breakdown | Horizontal bar | Topic analysis |
| Peak Hours | Bar chart by hour | Time patterns |
| Conversation Length | Histogram | Depth analysis |

**Derived Insights (Phase 3):**
| Insight | Visualization | Purpose |
|---------|--------------|---------|
| Response Quality | Scatter plot | Effectiveness |
| Topic Trends | Stream graph | Evolving interests |
| Prompt Templates | Word cloud | Common patterns |
| Cost Projection | Line + forecast | Budget planning |

### 4.3 Interactive Exploration Features

**Drill-Down:**
- Click chart segment -> Filter prompts
- Click date range -> Zoom in
- Click category -> Show related prompts

**Comparison Mode:**
- Compare two date ranges
- Compare models
- Compare categories

**Export:**
- Download chart as PNG/SVG
- Export data as CSV
- Share chart link

```typescript
// Interactive chart example
function InteractiveChart({ data, onSegmentClick }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          fill="url(#gradient)"
          onClick={(data) => onSegmentClick(data.payload)}
        />
        <Brush dataKey="date" height={30} stroke="#3b82f6" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

---

## 5. UX Patterns

### 5.1 Loading States and Skeletons

**Skeleton Components:**
```
Card Skeleton:                    List Skeleton:
+------------------+             +----------------------------------+
| [====]    [==]   |             | [==]  [========]  [===]  [====] |
| [============]   |             +----------------------------------+
| [========]       |             | [==]  [==========]  [==]  [===] |
| [=====] [===]    |             +----------------------------------+
+------------------+

Chart Skeleton:                   Stats Skeleton:
+------------------+             +--------+ +--------+ +--------+
| [========]       |             | [====] | | [====] | | [====] |
|                  |             | [==]   | | [===]  | | [=]    |
|   [Spinner]      |             +--------+ +--------+ +--------+
|                  |
+------------------+
```

**Loading Strategy:**
1. **Instant**: Show skeleton immediately
2. **Progressive**: Load critical content first
3. **Streaming**: Use Suspense for incremental loading
4. **Optimistic**: Show expected state before confirmation

```typescript
// Suspense boundary example
function PromptsPage() {
  return (
    <div>
      <Suspense fallback={<StatsBarSkeleton />}>
        <StatsBar />
      </Suspense>

      <Suspense fallback={<PromptListSkeleton count={10} />}>
        <PromptList />
      </Suspense>
    </div>
  );
}
```

### 5.2 Error Handling UI

**Error Types and Displays:**

1. **Connection Error (Full Page)**
```
+------------------------------------------+
|                                          |
|            [!] Connection Lost           |
|                                          |
|   Unable to connect to the server.       |
|   Please check your internet connection. |
|                                          |
|            [Retry]  [Settings]           |
|                                          |
+------------------------------------------+
```

2. **Data Error (Inline)**
```
+------------------------------------------+
| [!] Failed to load prompts               |
| Error: Database connection timeout       |
| [Retry] [Report Issue]                   |
+------------------------------------------+
```

3. **Validation Error (Toast)**
```
                        +----------------------+
                        | [!] Invalid date     |
                        | range selected       |
                        +----------------------+
```

**Error Recovery:**
- Automatic retry with exponential backoff
- Offline mode indicator
- Cached data fallback
- Clear error messages with actions

### 5.3 Empty States

**No Data Yet:**
```
+------------------------------------------+
|                                          |
|              [Icon: Inbox]               |
|                                          |
|          No prompts found yet            |
|                                          |
|   Start using Claude Code to see your    |
|   conversations appear here.             |
|                                          |
|            [Sync Now]  [Help]            |
|                                          |
+------------------------------------------+
```

**No Search Results:**
```
+------------------------------------------+
|                                          |
|             [Icon: Search]               |
|                                          |
|     No prompts match your search         |
|                                          |
|   Try adjusting your filters or search   |
|   for different keywords.                |
|                                          |
|         [Clear Filters]  [Browse All]    |
|                                          |
+------------------------------------------+
```

**No Data in Range:**
```
+------------------------------------------+
|                                          |
|            [Icon: Calendar]              |
|                                          |
|    No activity in this date range        |
|                                          |
|     [Try Last 30 Days]  [View All]       |
|                                          |
+------------------------------------------+
```

### 5.4 Keyboard Shortcuts

**Global Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `/` or `Cmd+K` | Focus search |
| `Cmd+P` | Quick prompt search |
| `?` | Show keyboard shortcuts |
| `G then H` | Go to Home |
| `G then P` | Go to Prompts |
| `G then A` | Go to Analytics |
| `G then S` | Go to Settings |

**List View Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `J` / `K` | Next/Previous item |
| `Enter` | Open selected |
| `X` | Star/Unstar |
| `E` | Export selected |
| `V` | Toggle view mode |

**Detail View Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `Escape` | Go back |
| `C` | Copy all content |
| `N` / `P` | Next/Previous prompt |
| `X` | Star/Unstar |

**Implementation:**
```typescript
// Using cmdk for command palette
import { Command } from 'cmdk';

function CommandPalette() {
  return (
    <Command.Dialog>
      <Command.Input placeholder="Type a command..." />
      <Command.List>
        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => router.push('/prompts')}>
            Go to Prompts
          </Command.Item>
          <Command.Item onSelect={() => router.push('/analytics')}>
            Go to Analytics
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Actions">
          <Command.Item onSelect={syncNow}>
            Sync Now
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

### 5.5 Additional UX Patterns

**Feedback and Notifications:**
- Toast notifications for actions
- Progress indicators for long operations
- Success/error animations
- Confirmation dialogs for destructive actions

**Accessibility:**
- ARIA labels on all interactive elements
- Focus management for modals
- Keyboard navigation support
- High contrast mode support
- Reduced motion option

**Performance UX:**
- Virtualized lists for large datasets
- Infinite scroll with intersection observer
- Image lazy loading
- Prefetching on hover

---

## 6. Feature Prioritization

### 6.1 MVP (Must-Have) - Phase 1 (Weeks 1-4)

| Feature | Priority | Complexity | Notes |
|---------|----------|------------|-------|
| Prompt list view | P0 | Medium | Core feature |
| Prompt detail view | P0 | Medium | Core feature |
| Basic date filtering | P0 | Low | Essential UX |
| Pagination | P0 | Low | Performance |
| Responsive layout | P0 | Medium | Mobile support |
| Dark/Light theme | P0 | Low | User preference |
| Manual sync trigger | P0 | Low | Data refresh |
| Basic loading states | P0 | Low | UX polish |
| Basic error handling | P0 | Low | Robustness |

**MVP Wireframe Focus:**
```
+------------------------------------------+
|  Basic Header with Search Placeholder    |
+------------------------------------------+
|  Simple Sidebar    |  Prompt List        |
|  - Prompts         |  - Cards with       |
|  - Settings        |    date, model,     |
|                    |    preview          |
|                    |  - Pagination       |
+------------------------------------------+
```

### 6.2 V1.0 (Nice-to-Have) - Phase 2 (Weeks 5-8)

| Feature | Priority | Complexity | Notes |
|---------|----------|------------|-------|
| Full-text search | P1 | Medium | Core functionality |
| Analytics dashboard | P1 | High | Key differentiator |
| Token usage charts | P1 | Medium | Cost tracking |
| Activity heatmap | P1 | Medium | Usage patterns |
| Model filter | P1 | Low | Multi-model support |
| Tag system | P1 | Medium | Organization |
| Grid/List toggle | P1 | Low | User preference |
| Keyboard shortcuts | P1 | Medium | Power users |
| Command palette | P1 | Medium | Quick navigation |
| Skeleton loading | P1 | Low | UX polish |
| Empty states | P1 | Low | UX completeness |

### 6.3 Future Enhancements - Phase 3+ (Weeks 9+)

| Feature | Priority | Complexity | Notes |
|---------|----------|------------|-------|
| Semantic search | P2 | High | AI-powered |
| Auto-categorization | P2 | High | ML-based |
| Export to Markdown | P2 | Low | Sharing |
| Starred/Favorites | P2 | Low | Quick access |
| Prompt templates | P2 | Medium | Reusability |
| Comparison mode | P2 | Medium | Analytics |
| Cost estimation | P2 | Medium | Budget tracking |
| Custom dashboards | P3 | High | Personalization |
| Collaboration features | P3 | High | Multi-user |
| Browser extension | P3 | High | Integration |
| API for external tools | P3 | Medium | Extensibility |

### 6.4 Implementation Roadmap Visual

```
Week 1-2: Foundation
[========================================] Setup, Auth, Basic Layout

Week 3-4: Core Features
[========================================] Prompt List, Detail, Filters

Week 5-6: Search & Analytics
[========================================] Search, Basic Charts, Stats

Week 7-8: Polish & Enhancement
[========================================] Tags, Keyboard, Performance

Week 9-10: Intelligence
[========================================] Semantic Search, Categories

Week 11-12: Advanced
[========================================] Export, Templates, Insights
```

---

## 7. Design System Specifications

### 7.1 Color Palette

```css
/* Light Theme */
--background: 0 0% 100%;
--foreground: 240 10% 3.9%;
--card: 0 0% 100%;
--card-foreground: 240 10% 3.9%;
--primary: 221.2 83.2% 53.3%;      /* Blue */
--primary-foreground: 210 40% 98%;
--secondary: 240 4.8% 95.9%;
--muted: 240 4.8% 95.9%;
--accent: 240 4.8% 95.9%;
--destructive: 0 84.2% 60.2%;      /* Red */
--border: 240 5.9% 90%;
--ring: 221.2 83.2% 53.3%;

/* Dark Theme */
--background: 240 10% 3.9%;
--foreground: 0 0% 98%;
--card: 240 10% 3.9%;
--card-foreground: 0 0% 98%;
--primary: 217.2 91.2% 59.8%;      /* Blue */
--primary-foreground: 222.2 47.4% 11.2%;
--secondary: 240 3.7% 15.9%;
--muted: 240 3.7% 15.9%;
--accent: 240 3.7% 15.9%;
--destructive: 0 62.8% 30.6%;      /* Red */
--border: 240 3.7% 15.9%;
--ring: 217.2 91.2% 59.8%;
```

### 7.2 Typography

```css
/* Font Stack */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* Scale */
--text-xs: 0.75rem;     /* 12px */
--text-sm: 0.875rem;    /* 14px */
--text-base: 1rem;      /* 16px */
--text-lg: 1.125rem;    /* 18px */
--text-xl: 1.25rem;     /* 20px */
--text-2xl: 1.5rem;     /* 24px */
--text-3xl: 1.875rem;   /* 30px */

/* Usage */
Body text:        --text-sm or --text-base
Card titles:      --text-base, font-medium
Page titles:      --text-2xl, font-semibold
Stat numbers:     --text-3xl, font-bold
Code blocks:      --text-sm, --font-mono
```

### 7.3 Spacing & Layout

```css
/* Spacing Scale (Tailwind) */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */

/* Layout */
Sidebar width:    256px (collapsed: 64px)
Content max-width: 1400px
Card padding:     --space-4 to --space-6
Grid gap:         --space-4 to --space-6
Section margin:   --space-6 to --space-8
```

### 7.4 Component Specifications

**Button Sizes:**
```
sm:  h-8   px-3  text-sm
md:  h-10  px-4  text-sm   (default)
lg:  h-12  px-6  text-base
```

**Border Radius:**
```
--radius-sm: 0.25rem;   /* Buttons, inputs */
--radius-md: 0.5rem;    /* Cards, modals */
--radius-lg: 0.75rem;   /* Large cards */
--radius-full: 9999px;  /* Pills, avatars */
```

**Shadows:**
```
--shadow-sm:  0 1px 2px rgba(0,0,0,0.05);
--shadow-md:  0 4px 6px rgba(0,0,0,0.1);
--shadow-lg:  0 10px 15px rgba(0,0,0,0.1);
```

---

## 8. Performance Considerations

### 8.1 Core Web Vitals Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| LCP | < 2.5s | Server components, image optimization |
| FID | < 100ms | Minimal JS, code splitting |
| CLS | < 0.1 | Skeleton loaders, reserved space |

### 8.2 Optimization Strategies

1. **Code Splitting**
   - Route-based splitting (automatic with Next.js)
   - Dynamic imports for heavy components (charts)
   - Lazy load below-fold content

2. **Data Fetching**
   - Server components for initial data
   - Streaming with Suspense
   - Stale-while-revalidate caching
   - Prefetch on hover/focus

3. **Rendering**
   - Virtual scrolling for long lists (>100 items)
   - Debounced search input
   - Memoized chart renders
   - Intersection observer for lazy loading

4. **Assets**
   - Next/Image for automatic optimization
   - Font subsetting
   - SVG icons (Lucide)
   - Compressed assets

```typescript
// Virtual list example
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualPromptList({ prompts }) {
  const virtualizer = useVirtualizer({
    count: prompts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120, // Card height
    overscan: 5,
  });

  return (
    <div ref={scrollRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <PromptCard
            key={virtualRow.key}
            prompt={prompts[virtualRow.index]}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 9. Appendix: Technology Summary

### Frontend Stack

| Category | Choice | Alternative |
|----------|--------|-------------|
| Framework | Next.js 14+ | Remix, SvelteKit |
| Language | TypeScript | - |
| Styling | Tailwind CSS | CSS Modules |
| Components | shadcn/ui | Radix UI, Chakra |
| Charts | Tremor / Recharts | Nivo, Victory |
| Tables | TanStack Table | AG Grid |
| State (Server) | TanStack Query | SWR |
| State (URL) | nuqs | next-usequerystate |
| State (UI) | Zustand | Jotai |
| Forms | React Hook Form | - |
| Validation | Zod | Yup |
| Icons | Lucide React | Heroicons |
| Date | date-fns | dayjs |
| Code Highlight | Shiki | Prism |
| Markdown | react-markdown | MDX |

### File Structure

```
src/
  app/                    # Next.js App Router
    (dashboard)/         # Dashboard route group
    api/                 # API routes
    layout.tsx
    page.tsx
  components/
    ui/                  # Base UI components
    prompts/             # Prompt-specific components
    analytics/           # Chart components
    layout/              # Layout components
    shared/              # Shared components
  hooks/                 # Custom React hooks
  lib/                   # Utilities, helpers
    utils.ts
    api.ts
    validators.ts
  styles/                # Global styles
    globals.css
  types/                 # TypeScript types
    prompt.ts
    analytics.ts
```

---

*Document prepared by: Frontend Architecture Agent*
*Last updated: 2026-02-02*
