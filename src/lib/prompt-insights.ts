export type PromptSignalId =
  | "goal"
  | "context"
  | "constraints"
  | "output"
  | "examples"
  | "role"
  | "tone"
  | "steps";

export interface PromptSignal {
  id: PromptSignalId;
  label: string;
  description: string;
  present: boolean;
}

export interface PromptReview {
  score: number;
  scoreLabel: "Strong" | "Good" | "Needs Work";
  wordCount: number;
  charCount: number;
  signals: PromptSignal[];
  suggestions: string[];
}

interface SignalDefinition {
  id: PromptSignalId;
  label: string;
  description: string;
  test: (normalized: string, raw: string) => boolean;
}

const signalDefinitions: SignalDefinition[] = [
  {
    id: "goal",
    label: "Clear goal",
    description: "Explicit task or desired outcome",
    test: (text) =>
      /\b(goal|objective|task|you are to|your task|i need|i want)\b/.test(text),
  },
  {
    id: "context",
    label: "Context",
    description: "Background, scenario, or why this matters",
    test: (text) => /\b(context|background|scenario|situation|about)\b/.test(text),
  },
  {
    id: "constraints",
    label: "Constraints",
    description: "Limits, requirements, or things to avoid",
    test: (text) =>
      /\b(constraints|requirements|must|should|avoid|do not|don't|only|limit)\b/.test(
        text
      ),
  },
  {
    id: "output",
    label: "Output format",
    description: "Specified format or structure for the response",
    test: (text) =>
      /\b(output format|format|respond with|return|json|markdown|table|bullet|list)\b/.test(
        text
      ),
  },
  {
    id: "examples",
    label: "Examples",
    description: "Example of desired output or input",
    test: (text) => /\b(example|e\.g\.|for example)\b/.test(text),
  },
  {
    id: "role",
    label: "Role framing",
    description: "Defines who the assistant should act as",
    test: (text) => /\b(you are|act as|role:|as a)\b/.test(text),
  },
  {
    id: "tone",
    label: "Tone or style",
    description: "Voice, tone, or writing style guidance",
    test: (text) => /\b(tone|style|voice)\b/.test(text),
  },
  {
    id: "steps",
    label: "Structured steps",
    description: "Numbered steps or checklist structure",
    test: (_text, raw) => /^\s*\d+\./m.test(raw) || /\b(steps|checklist)\b/.test(_text),
  },
];

const coreSignalIds: PromptSignalId[] = [
  "goal",
  "context",
  "constraints",
  "output",
];

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function analyzePrompt(rawText: string): PromptReview {
  const raw = rawText || "";
  const normalized = raw.toLowerCase();
  const words = raw.trim().length ? raw.trim().split(/\s+/).length : 0;
  const chars = raw.length;

  const signals = signalDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    present: definition.test(normalized, raw),
  }));

  const coreSignalsPresent = signals.filter(
    (signal) => coreSignalIds.includes(signal.id) && signal.present
  ).length;

  let score = (coreSignalsPresent / coreSignalIds.length) * 100;

  if (words < 20) {
    score -= 20;
  } else if (words > 400) {
    score -= 10;
  }

  score = clampScore(score);

  const scoreLabel = score >= 80 ? "Strong" : score >= 55 ? "Good" : "Needs Work";

  const suggestions: string[] = [];
  const missing = new Set(
    signals.filter((signal) => !signal.present).map((signal) => signal.id)
  );

  if (missing.has("goal")) {
    suggestions.push("State the exact outcome or task in one sentence.");
  }
  if (missing.has("context")) {
    suggestions.push("Add brief context so the agent can disambiguate.");
  }
  if (missing.has("constraints")) {
    suggestions.push("List constraints, limits, and things to avoid.");
  }
  if (missing.has("output")) {
    suggestions.push("Specify the output format (bullets, JSON, table, etc.).");
  }
  if (missing.has("examples")) {
    suggestions.push("Include a short example of the desired output.");
  }

  if (words < 20) {
    suggestions.push("Add a bit more detail so the agent has enough context.");
  }
  if (words > 400) {
    suggestions.push("Consider splitting this into smaller steps or sections.");
  }

  return {
    score,
    scoreLabel,
    wordCount: words,
    charCount: chars,
    signals,
    suggestions,
  };
}

export interface PromptInsightsSummary {
  total: number;
  averageScore: number;
  signalStats: Array<{
    id: PromptSignalId;
    label: string;
    description: string;
    presentCount: number;
    percent: number;
  }>;
  topGaps: Array<{
    id: PromptSignalId;
    label: string;
    percent: number;
  }>;
  length: {
    shortCount: number;
    longCount: number;
    averageWords: number;
  };
}

export function summarizePromptReviews(reviews: PromptReview[]): PromptInsightsSummary {
  const total = reviews.length;

  if (total === 0) {
    return {
      total: 0,
      averageScore: 0,
      signalStats: signalDefinitions.map((definition) => ({
        id: definition.id,
        label: definition.label,
        description: definition.description,
        presentCount: 0,
        percent: 0,
      })),
      topGaps: [],
      length: { shortCount: 0, longCount: 0, averageWords: 0 },
    };
  }

  const signalCounts = new Map<PromptSignalId, number>();
  for (const definition of signalDefinitions) {
    signalCounts.set(definition.id, 0);
  }

  let totalScore = 0;
  let totalWords = 0;
  let shortCount = 0;
  let longCount = 0;

  for (const review of reviews) {
    totalScore += review.score;
    totalWords += review.wordCount;
    if (review.wordCount < 20) shortCount += 1;
    if (review.wordCount > 400) longCount += 1;

    for (const signal of review.signals) {
      if (signal.present) {
        signalCounts.set(signal.id, (signalCounts.get(signal.id) || 0) + 1);
      }
    }
  }

  const signalStats = signalDefinitions.map((definition) => {
    const presentCount = signalCounts.get(definition.id) || 0;
    const percent = total ? Math.round((presentCount / total) * 100) : 0;
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      presentCount,
      percent,
    };
  });

  const topGaps = [...signalStats]
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 3)
    .map((stat) => ({ id: stat.id, label: stat.label, percent: stat.percent }));

  return {
    total,
    averageScore: Math.round(totalScore / total),
    signalStats,
    topGaps,
    length: {
      shortCount,
      longCount,
      averageWords: Math.round(totalWords / total),
    },
  };
}
