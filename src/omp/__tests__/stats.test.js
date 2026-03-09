process.env.TZ = "UTC";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { ingestPayload } = require("../ingest");
const { getStats } = require("../stats");

function makeTempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-stats-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return {
    root,
    config: {
      storage: { sqlite: { path: path.join(root, "omp.db") } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    },
  };
}

function insertPrompt(config, payload) {
  const result = ingestPayload(payload, config);
  expect(result.ok).toBe(true);
}

describe("getStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes richer CLI analytics from local prompt history", () => {
    const { config } = makeTempConfig();

    insertPrompt(config, {
      timestamp: "2026-03-01T09:00:00Z",
      source: "codex",
      project: "alpha",
      cli_name: "codex",
      text: "a".repeat(400),
      token_estimate: 100,
      response_text: "r".repeat(200),
      token_estimate_response: 50,
    });

    insertPrompt(config, {
      timestamp: "2026-03-01T09:10:00Z",
      source: "codex",
      project: "alpha",
      cli_name: "codex",
      text: "b".repeat(300),
      token_estimate: 80,
    });

    insertPrompt(config, {
      timestamp: "2026-03-01T11:00:00Z",
      source: "claude",
      project: "beta",
      cli_name: "claude",
      text: "c".repeat(500),
      token_estimate: 120,
      response_text: "s".repeat(250),
      token_estimate_response: 60,
    });

    insertPrompt(config, {
      timestamp: "2026-03-02T10:00:00Z",
      source: "codex",
      project: "beta",
      cli_name: "codex",
      text: "d".repeat(350),
      token_estimate: 90,
      response_text: "t".repeat(150),
      token_estimate_response: 40,
    });

    const stats = getStats(config, { groupBy: "project", limit: 5 });

    expect(stats.overall).toMatchObject({
      total_prompts: 4,
      total_tokens: 390,
      total_response_tokens: 150,
      total_combined_tokens: 540,
      avg_length: 387.5,
      avg_response_length: 200,
      project_count: 2,
      source_count: 2,
      response_count: 3,
      response_rate: 75,
      active_days: 2,
      avg_prompts_per_active_day: 2,
    });

    expect(stats.sessions).toMatchObject({
      total_sessions: 3,
      avg_prompts_per_session: 1.3,
      avg_session_minutes: 3.3,
      longest_session_minutes: 10,
      longest_session_prompts: 2,
    });

    expect(stats.patterns).toEqual({
      peak_hour: { bucket: "09:00", count: 2 },
      busiest_weekday: { bucket: "Sun", count: 3 },
      longest_active_streak: 2,
    });

    expect(stats.topProjects[0]).toMatchObject({
      bucket: "beta",
      total_prompts: 2,
      total_combined_tokens: 310,
      response_rate: 100,
    });
    expect(stats.topProjects[1]).toMatchObject({
      bucket: "alpha",
      total_prompts: 2,
      total_combined_tokens: 230,
      response_rate: 50,
    });

    expect(stats.topSources[0]).toMatchObject({
      bucket: "codex",
      total_prompts: 3,
      total_combined_tokens: 360,
    });

    expect(stats.grouped).toEqual([
      {
        bucket: "beta",
        total_prompts: 2,
        total_tokens: 210,
        total_response_tokens: 100,
        total_combined_tokens: 310,
        avg_length: 425,
        response_count: 2,
        response_rate: 100,
      },
      {
        bucket: "alpha",
        total_prompts: 2,
        total_tokens: 180,
        total_response_tokens: 50,
        total_combined_tokens: 230,
        avg_length: 350,
        response_count: 1,
        response_rate: 50,
      },
    ]);
  });

  it("supports relative Nd date filters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));

    const { config } = makeTempConfig();

    insertPrompt(config, {
      timestamp: "2026-03-03T08:00:00Z",
      source: "codex",
      project: "recent",
      cli_name: "codex",
      text: "recent prompt",
      token_estimate: 50,
    });

    insertPrompt(config, {
      timestamp: "2026-02-28T08:00:00Z",
      source: "codex",
      project: "old",
      cli_name: "codex",
      text: "old prompt",
      token_estimate: 70,
    });

    const stats = getStats(config, { since: "7d" });

    expect(stats.overall.total_prompts).toBe(1);
    expect(stats.overall.total_tokens).toBe(50);
    expect(stats.topProjects).toHaveLength(1);
    expect(stats.topProjects[0].bucket).toBe("recent");
  });
});
