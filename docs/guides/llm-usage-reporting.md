# LLM usage reporting (jiun-api)

Oh My Prompt reports the usage metadata of every LLM provider call it makes to
jiun-api, so token counts, list-price cost, latency and errors for every service
are visible in one place. We are on free tiers; the cost figure exists to make
the remaining free-tier headroom legible.

The authority for the wire format is **`jiunbae/jiun-api` `docs/USAGE_EVENTS.md`**.
`docs/INTEGRATION_BRIEF.md` in the same repo is the consumer-side summary and
says so itself: where either disagrees with the contract, the contract wins.
Both are in a private repo, so a browser fetch returns 404 — read them with
`gh api repos/jiunbae/jiun-api/contents/docs/USAGE_EVENTS.md --jq .content | base64 -d`.

Only metadata leaves this service. Prompts, completions, and credentials never do.

## Status

This service reports as `serviceId: "oh-my-prompt"`.

**It is not registered in jiun-api's `JIUN_SERVICES` yet**, so no usage key
exists and nothing is reported. Registration and key issuance are handled
centrally in jiun-api — `JIUN_SERVICE_KEYS` is a single sealed blob holding
every service's key, so re-sealing it from two places at once loses one of
them. Do not edit jiun-api's ConfigMap or sealed secret from here.

Until then the integration is inert rather than broken: reporting stays off
while `JIUN_USAGE_KEY` is empty, so there are no 401s and no outbox backlog.
Set the key when it is issued and reporting begins; nothing else changes.

## Turning it on

Reporting stays off until both `JIUN_USAGE_SERVICE_ID` and `JIUN_USAGE_KEY` are
set. This is deliberate: Oh My Prompt is self-hosted with the operator's own
provider keys, and an install that was never given a jiun-api key must not try
to report anything.

| Variable | Notes |
|---|---|
| `JIUN_USAGE_API_URL` | Defaults to `https://api.jiun.dev`. |
| `JIUN_USAGE_SERVICE_ID` | Defaults to `oh-my-prompt`. Must match the ID registered in `JIUN_SERVICES`. |
| `JIUN_USAGE_KEY` | The service usage key. **Inject as a secret.** Never commit or log it. |
| `JIUN_USAGE_API_KEY_LABEL` | Optional Vault credential *label* (`key_1`, `key_99`). Never a key. |
| `JIUN_USAGE_TIMEOUT_MS` | Delivery timeout, default 5000. |

`JIUN_USAGE_SERVICE_ID` is configuration rather than a constant in the source,
because the same image runs for anyone who self-hosts.

If the key is wrong or the service is not registered, jiun-api answers 401/403.
That is logged by name rather than as a generic retry, and the events are held
rather than dropped — once registration lands they deliver under their original
`occurredAt`, which the contract aggregates into the correct historical day.

## How it works

`src/lib/usage/contract.ts` holds the parts of the contract that are easy to get
wrong: the closed provider vocabulary, the credential-label rules, and the
token-counting convention. It is pure and covered by
`src/lib/__tests__/usage-contract.test.ts`.

`src/lib/usage/report.ts` owns delivery.

Three call sites are instrumented, each on both the success and the failure
path:

| Call site | Covers |
|---|---|
| `callLLM` in `src/extensions/llm.ts` | Every insight and summary: `/api/insights/ask`, daily-summary, weekly-trends, session-story, prompt-quality, admin diagnostics. |
| `generateEmbedding` in `src/lib/embedding.ts` | Embeddings written on upload and computed for semantic search. |
| `suggestRewrite` in `src/lib/suggestions.ts` | Prompt rewrite suggestions. |

### Provider is the vendor, not our provider name

The service's own `OMP_LLM_PROVIDER` vocabulary is **not** the contract's.
`resolveUsageProvider` translates:

| `OMP_LLM_PROVIDER` | Reported `provider` |
|---|---|
| `gemini` | `google` |
| `azure` | `openai` |
| `anthropic` | `anthropic` |
| `openai` | `openai` |
| `ollama`, `custom` | resolved from the base URL host, else `local` |

This matters more than it looks. jiun-api does **not** reject an unrecognised
`provider` — the endpoint accepts any string. Reporting `"gemini"` would
therefore return `200` and quietly create a second permanent series for the same
vendor, making every per-model total wrong by whatever went to the other
spelling. Fixing it afterwards means correcting the sender and then rebuilding
the affected range with `POST /usage/admin/rebuild`.

So the mapping is exhaustive over a typed union, `recordUsage` refuses to send
anything outside the vocabulary, and the test asserts that no input produces an
off-vocabulary value. A dropped event is a gap, and gaps are repairable; a wrong
spelling is not.

### Token counting

One convention across every provider, because the contract requires a single
convention per service and does not infer `totalTokens` from the other fields:

- `inputTokens` — all input tokens, **including** the cached ones
- `cachedInputTokens` — the cached subset of `inputTokens`
- `totalTokens` — the provider's own total where it reports one, else
  `inputTokens + outputTokens`

OpenAI and Gemini already count cached tokens inside their input figure;
Anthropic reports them separately, so its adapter adds `cache_read` and
`cache_creation` back into `inputTokens`. Gemini's `thoughtsTokenCount` is
folded into `outputTokens`, which is where its own `totalTokenCount` counts it.

Failed calls are reported with `status: "error"` and zero tokens: a non-2xx
response body is not parsed for usage, and the contract accepts `0` for
unavailable counts. The latency is still reported, which is the point — a
failure that burned a quota slot is otherwise invisible.

### Credential labels

`JIUN_USAGE_API_KEY_LABEL` is a label such as `key_1`, matching the name in
Vault. It must never be a key. The value is stored in MongoDB and exported as
the Prometheus `api_key` label, which puts it in front of everyone who can open
a dashboard; a credential that arrived there could not be recalled from either.

`validateApiKeyLabel` therefore refuses anything that is not 1–32 characters of
lowercase letters, digits, underscore or hyphen, or that starts like a known
credential (`AIza`, `sk-`, `ghp_`, `xoxb-`, `AKIA`, …). A rejected value is
dropped, not sent, and never written to the log — it may be the credential.

### Delivery, retries, and the outbox

A provider call that succeeded must never be re-run because its report failed,
so every event is written to the `llm_usage_events` table before any network
call is attempted, then delivered separately.

- Each call tries to deliver immediately after recording.
- Failures back off exponentially from 30s, capped at one hour.
- `POST /api/admin/usage/flush` retries whatever is still pending. Point the
  same cron that drives `/api/admin/scheduled-jobs/run` at it; it takes the
  `SCHEDULER_TOKEN` or an admin session.
- Retries reuse the same `eventId`. The endpoint is idempotent on
  `(serviceId, eventId)`, so a resend costs nothing and a regenerated ID would
  be a permanent double-count.
- Delivered rows are pruned after 7 days.

Batches are capped at the contract's 100 events, and concurrent flushes share a
single in-flight run.

### `userId` is omitted, and that is the correct answer

`userId` takes the jiun-api user ID that a service receives from
`GET /auth/me` as `user.id`, persisted on its user record at login. Oh My
Prompt has no such ID to persist: it authenticates locally against its own
`users` table with bcrypt and its own session cookie, and never talks to
jiun-api's auth. Its own UUIDs are a different identifier space, which the
endpoint rejects.

The brief is right that omitting it is not free — this usage aggregates as
`auth="anonymous"`, which reads on the dashboard as "no signed-in user". For
this service that reading is accurate today. It stops being accurate the day
Oh My Prompt gains jiun-api login, and the fix then is to keep `user.id` from
that exchange and send it here.

## Open issue: none of our models are in the price table

The brief says to check that each model appears in jiun-api's
`src/pricing/modelPrices.ts`, because a model with no rate on file is **not**
costed at zero — it is counted in `unpricedRequestCount` and surfaces as
`jiun_llm_usage_unpriced_requests_total`, so the gap reads as a gap.

As of 2026-09-15 that table holds exactly two entries:

| `provider` | `model` | |
|---|---|---|
| `google` | `gemini-3.5-flash-lite` | priced |
| `cloudflare` | `@cf/black-forest-labs/flux-2-klein-4b` | reference only, billed per tile |

Every model this service can be configured with is missing from it, including
the defaults in `getLLMConfig` (`claude-sonnet-4-5-20250929`, `gpt-4o-mini`,
`gemini-2.5-flash`, `llama3.2`) and the `Qwen/Qwen3.5-122B-A10B-FP8` in
`.env.example`. So on the day the key is issued, this service will report
volume, latency and errors correctly and contribute **no cost at all**.

That matters because the cost figure is the entire point of recording free-tier
usage: quota headroom is only legible next to the number it is saving. Two
things close the gap, both on the jiun-api side and neither of them ours to do
unilaterally — the contract requires a model's rate to land in the same pull
request as the sender that emits it:

1. Add rates for the models this service actually runs.
2. Separately, note that `gemini-2.5-flash` is this repo's default while the
   house standard (`~/.agents/AI_API.md`) and the only priced Gemini entry are
   both `gemini-3.5-flash-lite`. Aligning the default would make Gemini usage
   priced for free, but it changes which model the app calls, so it is a
   deliberate decision rather than a side effect of this integration.

## Verifying

Sending is not the same as being integrated. After a deploy:

```bash
# 1. Force a flush and confirm the endpoint stored the events.
curl -sS -X POST https://prompt.jiun.dev/api/admin/usage/flush \
  -H "X-Scheduler-Token: $SCHEDULER_TOKEN"
# -> {"success":true,"enabled":true,"attempted":N,"accepted":N,...}

# 2. Confirm they aggregated. If nothing shows here, the integration is not done.
curl -sS "https://api.jiun.dev/usage/services/$JIUN_USAGE_SERVICE_ID?from=$(date -u +%F)&to=$(date -u +%F)" \
  -H "X-Service-Key: $JIUN_USAGE_KEY"
```

Anything stuck shows up locally as well:

```sql
SELECT provider, model, status, attempts, last_error
FROM llm_usage_events
WHERE delivery_status = 'pending'
ORDER BY occurred_at;
```

A row whose `provider` is not one of `openai`, `anthropic`, `google`,
`cloudflare`, `openrouter`, `local` is a bug in the mapping, not in the data.
