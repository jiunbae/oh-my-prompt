# Task: Frontend UI Components

## Context
Build the core frontend components for the Prompt Analytics Dashboard using Next.js App Router and shadcn/ui.

## Reference Documents
- `/Users/username/workspace/prompt-manager/.context/impl/20260202_174951_prompt-analytics-dashboard/perspectives/gemini-frontend.md`

## Deliverables

### 1. Layout Structure
Create the app layout structure:
```
src/app/
├── layout.tsx           # Root layout with providers
├── page.tsx             # Redirect to /prompts
├── globals.css          # Tailwind + custom styles
├── (dashboard)/
│   ├── layout.tsx       # Dashboard layout with sidebar
│   ├── prompts/
│   │   ├── page.tsx     # Prompt list view
│   │   └── [id]/
│   │       └── page.tsx # Prompt detail view
│   └── settings/
│       └── page.tsx     # Settings placeholder
```

### 2. UI Components (shadcn/ui style)
Create in `src/components/ui/`:
- `button.tsx` - Button variants
- `card.tsx` - Card component
- `input.tsx` - Input field
- `badge.tsx` - Badge/tag component
- `skeleton.tsx` - Loading skeleton

### 3. Dashboard Components
Create in `src/components/`:

**Sidebar** (`sidebar.tsx`):
- Logo/title
- Navigation links (Prompts, Analytics, Settings)
- Sync status indicator

**PromptCard** (`prompt-card.tsx`):
- Timestamp
- Project name badge
- Prompt preview (truncated)
- Prompt type indicator
- Token count

**PromptList** (`prompt-list.tsx`):
- Grid/list view toggle
- Sorting (date, length)
- Pagination
- Empty state

**PromptDetail** (`prompt-detail.tsx`):
- Full prompt text with syntax highlighting
- Metadata panel (timestamp, project, tokens)
- Copy to clipboard button
- Back navigation

### 4. Styling
- Dark mode support (default dark)
- Responsive design (mobile-first)
- Monospace font for prompt text

### 5. tRPC Client Setup
Create `src/lib/trpc.ts` - React Query + tRPC client configuration

## Design Guidelines
- Clean, minimal interface
- High contrast for readability
- Generous whitespace
- Consistent spacing (8px grid)

## Output Location
Write all files directly to `/Users/username/workspace/prompt-manager/`

## Success Criteria
- Dashboard renders without errors
- Responsive on mobile/desktop
- Dark mode works correctly
