<div align="center">

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg" />
  <img alt="Oh My Prompt" src="docs/assets/logo-dark.svg" width="540" />
</picture>

<br />

### Your AI coding sessions, captured and analyzed.

A self-hosted prompt journal + CLI that captures every interaction<br />with Claude Code, Codex, OpenCode, and more — then turns them into actionable insights.

<br />

[![npm version](https://img.shields.io/npm/v/oh-my-prompt?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/oh-my-prompt)
[![License](https://img.shields.io/github/license/jiunbae/oh-my-prompt?style=for-the-badge&color=blue)](LICENSE)
[![Node](https://img.shields.io/node/v/oh-my-prompt?style=for-the-badge&logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)

<br />

**[Quickstart for Agents](#quickstart-for-agents)** · **[Start with Human](#start-with-human)** · **[CLI](#-cli)** · **[Dashboard](#-dashboard)** · **[Local Mode](#-local-dashboard)** · **[Server Deploy](#-server-deployment)** · **[Contributing](#-contributing)**

<br />

<!-- Replace with actual screenshot -->
<!-- <img src="docs/assets/dashboard-preview.png" alt="Dashboard Preview" width="800" /> -->

</div>

<br />

## Why?

You write **hundreds of prompts a day** to AI coding agents. But do you actually know which ones work?

**Oh My Prompt** gives you the answer. It captures every prompt, scores its quality, and shows you patterns you'd never notice on your own.

<br />

<table>
<tr>
<td width="33%" align="center">

**🎯 Capture**

Shell hooks silently intercept<br/>every prompt you send

</td>
<td width="33%" align="center">

**📊 Analyze**

Quality scores, token usage,<br/>session patterns, trends

</td>
<td width="33%" align="center">

**🔄 Sync**

Local SQLite → server API<br/>Works offline, syncs when ready

</td>
</tr>
</table>

<br />

## How It Works

```
  You                    CLI                      Dashboard
  ───                    ───                      ─────────

  claude "fix the bug"
       │
       └──── hook ────▶  omp ingest ──▶ SQLite (local)
                              │
                              ├── omp sync ──▶ POST /api/sync/upload
                              │                       │
                              │                ┌──────┴──────┐
                              │                │  PostgreSQL  │
                              │                └─────────────┘
                              │                       │
                              │              ┌────────┴────────┐
                              │              │ omp serve        │  ← local mode
                              │              │ localhost:3000   │
                              │              └─────────────────┘
                              │                      or
                              │              ┌─────────────────┐
                              └──────────────│ your-server.com │  ← server mode
                                             └─────────────────┘
```

<br />

## Quickstart for Agents

<div><img src="https://quickstart-for-agents.vercel.app/api/header.svg?theme=opencode&title=Install+Oh+My+Prompt&lang=Agents" width="100%" /></div>

```text
Install Oh My Prompt from https://github.com/jiunbae/oh-my-prompt on this machine.

Before running commands, ask me to choose one install method:
1) npm install -g oh-my-prompt (recommended)
2) npx oh-my-prompt setup (no global install)
3) source install (git clone + pnpm install + pnpm build:cli + npm link)

After installation, run:
  omp setup

Important:
- Use interactive setup only.
- Do NOT use setup flags like --server, --token, --hooks, --yes, or --dry-run.
- Ask me each setup input in order:
  server URL, auth/login or token, device name, and hook installs (Claude/Codex/OpenCode).

After setup completes, verify with:
- omp doctor
- omp status

Finally, summarize:
- configured hooks and install status
- server URL
- token status
```

<div><img src="https://quickstart-for-agents.vercel.app/api/footer.svg?theme=opencode&model=OpenCode&agent=Installer" width="100%" /></div>

<br />

<details>
<summary><b>Setup Flow Preview</b></summary>

`omp setup` guides the interactive flow:

```bash
$ omp setup

  Oh My Prompt - Setup Wizard
  ============================

  [1/4] Server URL
  > Server URL [https://prompt.jiun.dev]:

  [2/4] Authentication
  > Choice [1]:
  > Email:
  > Password (press Enter if new account):

  [3/4] Device Name
  > Device name [my-laptop]:

  [4/4] Install Hooks
  > Install Claude Code hook? [Y/n]:
  > Install Codex hook? [Y/n]:
  > Install OpenCode hook? [Y/n]:

  Running doctor...
  Setup complete!
```

</details>

<details>
<summary><b>Manual Install Options</b></summary>

```bash
# npm (recommended)
npm install -g oh-my-prompt && omp setup

# npx (no global install)
npx oh-my-prompt setup

# source
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm build:cli
cd packages/omp-cli
npm link
omp setup
```

</details>

## Start with Human

```bash
# Install
npm install -g oh-my-prompt

# Setup (interactive wizard)
omp setup

# Verify
omp doctor
```

That's it. Now use Claude Code, Codex, or OpenCode normally — prompts are captured automatically.

```bash
claude "Refactor this function to use async/await"
#        ↑ captured silently in the background
```

### Choose Your Mode

Oh My Prompt supports two modes depending on your needs:

| | **Local Mode** | **Server Mode** |
|:--|:--|:--|
| **Setup** | `omp serve` | Deploy to your server |
| **Requires** | Docker | Docker + domain |
| **Dashboard** | `http://localhost:3000` | `https://your-domain.com` |
| **Data** | Local only | Multi-device sync |
| **Best for** | Solo use, privacy | Teams, cross-machine |

**Local Mode** — everything runs on your machine via Docker:
```bash
omp serve        # Start dashboard at http://localhost:3000
omp sync         # Sync captured prompts to local dashboard
```

**Server Mode** — deploy once, sync from anywhere:
```bash
omp config set server.url https://your-domain.com
omp config set server.token YOUR_TOKEN
omp sync         # Sync to remote server
```

<br />

## 📟 CLI

<details>
<summary><b>omp setup</b> — Interactive configuration wizard</summary>

```bash
$ omp setup

  ✨ Oh My Prompt Setup

  ? Server URL: https://your-server.com
  ? API Token: ********-****-****-****-************
  ? Device name: my-laptop
  ? Install Claude Code hook? Yes
  ? Install Codex hook? Yes

  ✓ Config saved to ~/.omp/config.json
  ✓ Database initialized
  ✓ Claude Code hook installed
  ✓ Codex hook installed
  ✓ Server connection verified

  You're all set! Prompts will be captured automatically.
```
</details>

<details>
<summary><b>omp analyze</b> — Score prompt quality</summary>

```bash
$ omp analyze abc123

  Score: 85/100 (Good)

  Signals:
    ✓ Goal         Clear objective stated
    ✓ Context      Background information provided
    ✗ Constraints  No specific constraints
    ✓ Output       Expected format described
    ✗ Examples     No examples included

  Suggestions:
    → Add specific constraints or requirements
    → Include examples of expected output
```
</details>

<details>
<summary><b>omp stats</b> — View statistics</summary>

```bash
$ omp stats --group-by week

  Overall: 1,234 prompts · 450 avg length · 600 avg tokens

  ┌──────────┬───────┬─────────┬───────────┐
  │ Week     │ Count │ Avg Len │ Avg Tokens│
  ├──────────┼───────┼─────────┼───────────┤
  │ 2026-W05 │   120 │     420 │       580 │
  │ 2026-W06 │   145 │     480 │       620 │
  │ 2026-W07 │   198 │     510 │       650 │
  └──────────┴───────┴─────────┴───────────┘
```
</details>

<details>
<summary><b>All commands</b></summary>

| Command | Description |
|:--------|:------------|
| `omp setup` | Interactive configuration wizard |
| `omp install [claude\|codex\|opencode\|all]` | Install capture hooks |
| `omp uninstall [claude\|codex\|opencode\|all]` | Remove capture hooks |
| `omp status` | Show config and hook status |
| `omp doctor` | Validate setup, diagnose issues |
| `omp sync` | Sync local prompts to server |
| `omp sync status` | Show sync history |
| `omp backfill` | Import from Claude transcripts / Codex history |
| `omp serve` | Start local dashboard server (Docker) |
| `omp serve stop` | Stop local dashboard server |
| `omp stats [--group-by day\|week]` | View statistics |
| `omp export [--format json\|jsonl\|csv]` | Export prompts |
| `omp import codex-history` | Import from Codex |
| `omp config get\|set\|validate` | Manage configuration |
| `omp db migrate` | Run database migrations |

</details>

<br />

## 📊 Dashboard

The self-hosted web dashboard turns raw prompts into insights.

<table>
<tr>
<td width="50%">

**Prompt Journal**
- Full-text search across all prompts
- Filter by project, type, date, tags
- Quality signals on every prompt
- Markdown + syntax highlighting

</td>
<td width="50%">

**Analytics**
- Activity heatmap
- Token usage trends
- Quality score tracking
- Project breakdown
- Session analysis

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

**Multi-User**
- Email/password auth
- Admin-managed allowlist
- Per-user data isolation
- Individual API tokens

</td>
<td width="50%">

**Security**
- No client credentials needed
- bcrypt password hashing
- httpOnly secure cookies
- Non-root container

</td>
</tr>
</table>

<!-- Screenshot gallery — uncomment when screenshots are available
<details>
<summary><b>Screenshots</b></summary>
<br />
<img src="docs/assets/prompts-list.png" width="400" /> <img src="docs/assets/analytics.png" width="400" />
<img src="docs/assets/prompt-detail.png" width="400" /> <img src="docs/assets/quality-score.png" width="400" />
</details>
-->

<br />

## 🏗 Local Dashboard

The fastest way to view your data. No server deployment needed — just Docker.

```bash
# Start (pulls images and runs PostgreSQL + Redis + App)
omp serve

# Dashboard is now at http://localhost:3000
# Register an account, then:
omp config set server.url http://localhost:3000
omp config set server.token YOUR_TOKEN   # from Settings page
omp backfill                              # import past transcripts
omp sync                                  # sync to local dashboard
```

```bash
omp serve status    # check container status
omp serve logs      # tail app logs
omp serve stop      # stop (data is preserved)
omp serve           # restart — your data is still there
```

**Configuration:**

```bash
omp config set serve.port 3030                # change port (default: 3000)
omp config set serve.adminEmail you@email.com # auto-seed admin account
omp config set serve.image my-registry/omp    # custom Docker image
```

<br />

## 🌐 Server Deployment

For multi-device sync and team use, deploy Oh My Prompt to your own server.

### Docker Compose

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
docker compose up -d    # Starts PostgreSQL + Redis + App on :3000
```

### Docker (standalone)

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/prompts \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e OMP_ADMIN_EMAIL=you@email.com \
  ghcr.io/jiunbae/oh-my-prompt:latest
```

### Environment Variables

| Variable | Required | Default | Description |
|:---------|:--------:|:--------|:------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `SESSION_SECRET` | **Yes** | random | Cookie signing key (`openssl rand -hex 32`) |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for caching |
| `OMP_ADMIN_EMAIL` | No | — | Auto-seed admin email on startup |
| `NODE_ENV` | No | `production` | Environment mode |

### Kubernetes

Example manifests in `k8s/`. Update secrets and ingress for your cluster:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/
```

### Connect CLI to Server

```bash
omp config set server.url https://your-domain.com
omp config set server.token YOUR_TOKEN   # from Settings page after registration
omp backfill     # import past Claude/Codex transcripts
omp sync         # upload to server
```

<br />

## 🏛 Architecture

```
oh-my-prompt/
├── src/app/                    Next.js 16 App Router
│   ├── (dashboard)/            Protected pages (prompts, analytics, admin)
│   └── api/                    REST API (auth, sync, analytics)
├── src/components/             React + Recharts + Shadcn/ui
├── src/db/                     Drizzle ORM schema (PostgreSQL)
├── src/services/               Business logic (upload, sync, classify)
├── src/omp/                    CLI source (Node.js + SQLite)
├── packages/omp-cli/           Standalone npm package
└── .gitea/workflows/           Gitea CI/CD (Docker build + k8s deploy)
```

<table>
<tr>
<td><b>Frontend</b></td>
<td>Next.js 16 · React 19 · Tailwind CSS 4 · Recharts</td>
</tr>
<tr>
<td><b>Backend</b></td>
<td>Next.js API Routes · tRPC · Zod</td>
</tr>
<tr>
<td><b>Database</b></td>
<td>PostgreSQL · Drizzle ORM</td>
</tr>
<tr>
<td><b>CLI</b></td>
<td>Node.js · better-sqlite3 · zero runtime deps</td>
</tr>
<tr>
<td><b>Infra</b></td>
<td>Docker · Kubernetes · ArgoCD · Gitea CI</td>
</tr>
</table>

<br />

## 🤝 Contributing

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm dev          # Web dashboard
pnpm build:cli    # Build CLI package
```

1. Fork → 2. Branch (`feat/thing`) → 3. Commit → 4. PR

<br />

## 📄 License

[MIT](LICENSE) — [Jiun Bae](https://github.com/jiunbae)

<div align="center">

<br />

**[GitHub](https://github.com/jiunbae/oh-my-prompt)** · **[npm](https://www.npmjs.com/package/oh-my-prompt)** · **[Issues](https://github.com/jiunbae/oh-my-prompt/issues)**

<sub>Built for developers who talk to AI all day.</sub>

</div>
