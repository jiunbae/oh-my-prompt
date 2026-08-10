# Oh My Prompt

> CLI tool for capturing, analyzing, and syncing AI coding prompts

[![npm version](https://img.shields.io/npm/v/oh-my-prompt.svg)](https://www.npmjs.com/package/oh-my-prompt)
[![Node.js](https://img.shields.io/node/v/oh-my-prompt.svg)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/oh-my-prompt.svg)](LICENSE)

**Oh My Prompt** captures your AI coding sessions (Claude Code, Codex, OpenCode, etc.) to a local SQLite database, syncs them to a server, and provides analytics insights into your prompting patterns.

## Features

- **Automatic capture**: Hook into Claude Code, Codex, OpenCode, and Gemini CLI
- **Tool tracking**: Per-prompt log of every `tool_use` the agent ran (Bash, Edit, Write, Read, WebFetch, etc.) with extracted `program` name for Bash commands so you can answer "which programs did the agent actually run"
- **Local storage**: SQLite database at `~/.omp/prompts.db`
- **Server sync**: Upload prompts to self-hosted server for analytics
- **Prompt analysis**: Get quality scores and improvement suggestions
- **Export/Import**: JSONL, CSV, or JSON formats
- **Privacy-first**: Redact secrets, responses optional

## Installation

### Global Install (Recommended)

```bash
npm install -g oh-my-prompt
```

### Using npx (No install)

```bash
npx oh-my-prompt setup
```

### From Source

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm build:cli
cd packages/omp-cli
npm link
```

## Quick Start

### 1. Setup

Run the interactive setup wizard:

```bash
omp setup
```

This will:
- Create config at `~/.omp/config.json`
- Initialize SQLite database
- Detect installed CLIs (Claude, Codex, OpenCode)
- Optionally configure server sync

### 2. Install Hooks

Install hooks for your CLI(s):

```bash
omp install claude      # For Claude Code
omp install codex       # For Codex
omp install opencode    # For OpenCode
omp install all         # For all detected CLIs
```

This adds prompt capture hooks to:
- Claude: `~/.claude/hooks/prompt-logger.sh`
- Codex: `~/.config/oh-my-prompt/hooks/codex/notify.js` + `~/.codex/config.toml` notify entry
- OpenCode: `~/.config/oh-my-prompt/hooks/opencode/omp-opencode-plugin.mjs` + `~/.config/opencode/opencode.json` plugin entry

### 3. Verify Setup

```bash
omp status
```

Expected output:
```
Server: https://your-server.example.com (or not configured)
Token: configured / not configured
Storage: sqlite
SQLite: /Users/you/.omp/prompts.db
Hooks: claude=installed, codex=installed, opencode=installed
Last capture: 2026-02-08T10:30:00.000Z
Queue: 0 files, 0 bytes
```

### 4. Use Your CLI

Just use Claude Code, Codex, or OpenCode normally:
```bash
claude "Write a function to parse TOML"
codex "Add error handling to this file"
opencode run "Add retry logic to the sync command"
```

Prompts are automatically captured!

### 5. View Stats

```bash
omp stats
omp report
omp analyze <prompt-id>
```

## Start with Agent

Copy-paste this prompt into your coding agent to install Oh My Prompt with interactive setup:

```text
Install Oh My Prompt from https://github.com/jiunbae/oh-my-prompt on this machine.

Before running commands, ask me to choose only the install method:
1) npm install -g oh-my-prompt (recommended)
2) npx oh-my-prompt setup (no global install)
3) from source (git clone + pnpm build:cli)

After installation, run:
  omp setup

Important:
- Do NOT use setup flags like --server, --token, --hooks, --yes.
- Use the interactive wizard only, and let me provide values directly in the prompts.
- Ask me each setup input in order (server URL, auth/login or token, device name, hook install confirmations).

After setup completes, verify with:
- omp doctor
- omp status

Finally, show exactly what was configured (hooks, server URL, and token status).
```

## Commands

### Hook Management

```bash
omp install [claude|codex|opencode|all]    # Install prompt capture hooks
omp uninstall [claude|codex|opencode|all]  # Remove hooks
omp status                         # Show config and hook status
omp doctor                         # Validate setup and diagnose issues
```

### Data Management

```bash
omp sync                           # Sync local prompts to server
omp sync status                    # Show sync history
omp export [--format json|jsonl|csv] [--out file.json]
omp import codex-history [--path ~/.codex/history.jsonl]
```

### Analytics

```bash
omp stats [--view overview|projects|sources|hourly|weekday|sessions] [--since 7d] [--group-by day|week|month|project|source|hour|weekday]
omp report [--format text|json] [--since 2026-01-01]
omp analyze <prompt-id>            # Analyze prompt quality
omp analyze --file prompt.txt      # Analyze file
omp analyze --stdin < prompt.txt   # Analyze from stdin
omp tui                             # Interactive local prompt browser
```

### Configuration

```bash
omp config get                     # Show config with secrets redacted
omp config get server.token --show-secrets  # Explicitly reveal a secret
omp config get server.url          # Get specific value
omp config set server.url https://your-server.example.com
printf '%s' "$OMP_TOKEN" | omp config set server.token --stdin
omp config validate                # Check config validity
```

### Database

```bash
omp db migrate                     # Run schema migrations
omp db repair                      # Repair full-text index drift
omp db backups                     # List database recovery artifacts
omp db backups prune               # Dry-run safe cleanup (add --yes to execute)
```

### Low-level

```bash
omp ingest --stdin < payload.json  # Manually ingest payload
omp ingest --replay                # Replay failed queue
```

## Configuration

Config file: `~/.config/oh-my-prompt/config.json` (or `$XDG_CONFIG_HOME/oh-my-prompt/config.json`)

### Server Sync (Recommended)

```json
{
  "server": {
    "url": "https://your-server.example.com",
    "token": "your-api-token"
  }
}
```

Or via CLI:
```bash
omp config set server.url https://your-server.example.com
printf '%s' "$OMP_TOKEN" | omp config set server.token --stdin
```

### Storage

```json
{
  "storage": {
    "type": "sqlite",
    "sqlite": {
      "path": "/Users/you/.omp/prompts.db"
    }
  }
}
```

### Capture Options

```json
{
  "capture": {
    "response": true,
    "redact": {
      "enabled": true,
      "mask": "[REDACTED]"
    }
  }
}
```

### Environment Variables

Override config with env vars:

```bash
export OMP_SERVER_URL="https://your-server.example.com"
export OMP_SERVER_TOKEN="your-token"
export OMP_STORAGE_TYPE="sqlite"
export OMP_SQLITE_PATH="/custom/path/prompts.db"
export OMP_CAPTURE_RESPONSE="true"
```

## Hooks

### How Hooks Work

**Claude Code**:
- Adds `~/.claude/hooks/prompt_sent.sh`
- Triggered after every `claude` command
- Reads env vars: `$CLAUDE_PROMPT`, `$CLAUDE_RESPONSE`, `$CLAUDE_SESSION_ID`

**Codex**:
- Adds/updates `notify` in `~/.codex/config.toml`
- Triggered on `agent-turn-complete` events
- Parses Codex event JSON

**OpenCode**:
- Adds a plugin path in `~/.config/opencode/opencode.json`
- Plugin listens to `session.idle` events
- Captures the latest user/assistant turn pair per session

### Custom Hook Environment

Set `OMP_BIN` to use a custom omp binary:
```bash
export OMP_BIN="/custom/path/to/omp"
```

### Manual Hook Installation

If auto-install fails, manually add to `~/.claude/config.toml`:

```toml
[[hooks]]
name = "oh-my-prompt"
on = "prompt_sent"
script = "/Users/you/.omp/hooks/claude_prompt_sent.sh"
```

## Analytics Features

### Prompt Quality Score

```bash
omp analyze <prompt-id>
```

Output:
```
Score: 85 (Good)
Signals:
- Goal: present
- Context: present
- Constraints: missing
- Output format: present
- Examples: missing
Suggestions:
- Add specific constraints or requirements
- Include examples of expected output
```

### Stats Report

```bash
omp stats --view weekday --since 7d
```

Output:
```
┌──────────────────────────────────────────────────────────────┐
│ Local Analytics                                             │
│ Range: 7d -> now                                            │
└──────────────────────────────────────────────────────────────┘

Top Projects
api       ██████████████████████████ 42  6.2k tok · 88% rsp
frontend  ████████████████░░░░░░░░░ 27  3.8k tok · 91% rsp

Grouped By weekday
Mon       ██████████████████████████ 18  2.1k tok · 94% rsp
Tue       ████████████████████░░░░░░ 14  1.8k tok · 86% rsp
```

### Report

```bash
omp report --since 2026-02-01
```

Generates:
- Total prompts, tokens, words
- Prompts per day/project
- Quality score distribution
- Top projects
- Improvement suggestions

## Sync to Server

### Setup Server Sync

1. Get an API token from your Oh My Prompt server
2. Configure sync:
   ```bash
   omp config set server.url https://your-server.example.com
   printf '%s' "$OMP_TOKEN" | omp config set server.token --stdin
   ```

3. Run initial sync:
   ```bash
   omp sync
   ```

### Automatic Sync

On Linux, install the event-driven user service once:

```bash
omp sync auto install
omp sync auto status
```

The service starts at login. New captures are debounced for 30 seconds, then
synced as one batch; a one-hour interval is only a missed-event and network
recovery safety net. The resident watcher does not open the database: each sync
runs in a short-lived, low-priority worker so transient memory is reclaimed and
interactive workloads win CPU and disk contention. Local storage prefers native
SQLite WAL page writes and automatically retains `sql.js` as the portable
fallback. To disable or remove it:

```bash
omp sync auto stop
omp sync auto uninstall
```

On macOS, `omp sync auto` starts the event-driven daemon for the current login
session. A launchd installer is not yet included.

### Manual Sync

```bash
omp sync                  # Sync all new prompts
omp sync --since 2026-01-01  # Sync from date
omp sync --dry-run        # Preview sync
omp sync status           # Show sync history
```

## Export / Import

### Export

```bash
omp export --format jsonl --out prompts.jsonl
omp export --format csv --out prompts.csv --since 2026-01-01
omp export --format json > prompts.json
```

### Import

```bash
omp import codex-history --path ~/.codex/history.jsonl
omp import codex-history --dry-run  # Preview
```

## Troubleshooting

### Hooks Not Working

1. Check hook status:
   ```bash
   omp status
   ```

2. Run doctor:
   ```bash
   omp doctor
   ```

3. Manually test hook:
   ```bash
   bash ~/.omp/hooks/claude_prompt_sent.sh
   ```

4. Check logs:
   ```bash
   tail -f ~/.omp/state.json
   ```

### Sync Failing

1. Check config:
   ```bash
   omp config validate
   ```

2. Test connectivity:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" https://your-server.example.com/api/health
   ```

3. Force sync:
   ```bash
   omp sync --force
   ```

### Database Issues

```bash
omp db migrate            # Run migrations
omp config get storage.sqlite.path  # Check DB location
sqlite3 ~/.omp/prompts.db ".schema"  # Inspect schema
```

## Development

### Build from Source

```bash
git clone https://github.com/jiunbae/oh-my-prompt.git
cd oh-my-prompt
pnpm install
pnpm build:cli
cd packages/omp-cli
npm link
```

### Run Tests

```bash
cd packages/omp-cli
npm test
```

### Project Structure

```
packages/omp-cli/
├── bin/omp              # CLI entry point
├── lib/                 # Core modules (copied from src/omp/)
│   ├── cli.js           # Command router
│   ├── config.js        # Config management
│   ├── db.js            # SQLite operations
│   ├── hooks.js         # Hook installation
│   ├── ingest.js        # Payload processing
│   ├── sync.js          # Server sync
│   └── ...
└── package.json
```

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

## License

MIT © Jiun Bae

## Links

- **GitHub**: https://github.com/jiunbae/oh-my-prompt
- **npm**: https://www.npmjs.com/package/oh-my-prompt
- **Issues**: https://github.com/jiunbae/oh-my-prompt/issues
- **Docs**: See [docs/](https://github.com/jiunbae/oh-my-prompt/tree/main/docs)

## Acknowledgments

- Inspired by oh-my-zsh and prompt engineering best practices
- Built for Claude Code, Codex, and OpenCode users
- Uses optional `better-sqlite3` with WAL page writes when a compatible native
  binary is available, with `sql.js` as the build-tool-free Node.js 20+ fallback
