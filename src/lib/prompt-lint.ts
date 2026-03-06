/**
 * Prompt linting system — detects common prompt anti-patterns and suggests improvements.
 */

export type LintSeverity = "warning" | "error";

export interface LintResult {
  id: string;
  severity: LintSeverity;
  message: string;
  suggestion: string;
}

// ── Rule: vague-instruction ─────────────────────────────────────

const VAGUE_PHRASES =
  /\b(fix this|make it better|do something|make it work|clean this up|improve this|handle this|do the thing|take care of it|sort this out)\b/i;

const VAGUE_STANDALONE =
  /^(fix this|help|do it|make it work|do something|please help)\s*[.!?]?\s*$/i;

function checkVagueInstruction(text: string): LintResult | null {
  const trimmed = text.trim();
  if (VAGUE_STANDALONE.test(trimmed)) {
    return {
      id: "vague-instruction",
      severity: "error",
      message: "Prompt is too vague — it contains no specific instruction or context.",
      suggestion:
        "Describe exactly what you want done, including the file, function, or behavior to change.",
    };
  }
  if (VAGUE_PHRASES.test(trimmed)) {
    return {
      id: "vague-instruction",
      severity: "warning",
      message: "Prompt contains vague phrases like \"fix this\" or \"make it better\" without specifics.",
      suggestion:
        "Replace vague phrases with concrete descriptions, e.g. \"Fix the null-pointer crash in parseConfig()\" instead of \"fix this\".",
    };
  }
  return null;
}

// ── Rule: missing-context ───────────────────────────────────────

const FILE_PATH_RE =
  /(?:^|\s)(?:\.{1,2}\/|\/[\w.-]+\/|[a-zA-Z]:\\)[\w./\\-]+(?:\.[a-zA-Z0-9]+)?/;
const CODE_REF_RE =
  /`[^`]+`|\b[A-Za-z_]\w*\([^)]*\)|\b[A-Za-z_]\w*\.\w+\b/;
const FILE_EXT_RE = /\b\w+\.\w{1,5}\b/;

function checkMissingContext(text: string): LintResult | null {
  const hasFilePath = FILE_PATH_RE.test(text);
  const hasCodeRef = CODE_REF_RE.test(text);
  const hasFileExt = FILE_EXT_RE.test(text);

  if (!hasFilePath && !hasCodeRef && !hasFileExt) {
    return {
      id: "missing-context",
      severity: "warning",
      message: "No file paths, function names, or code references found in the prompt.",
      suggestion:
        "Include specific references like file paths (src/auth.ts), function names (validateToken()), or code snippets to help the AI locate the relevant code.",
    };
  }
  return null;
}

// ── Rule: too-broad-scope ───────────────────────────────────────

const CONJUNCTION_SPLITTERS =
  /\b(?:also|and then|and also|additionally|plus|as well as|on top of that|furthermore|moreover)\b/gi;

const UNRELATED_ACTION_RE =
  /\b(add|build|change|create|debug|delete|deploy|document|explain|fix|implement|migrate|optimize|refactor|remove|rename|test|update|upgrade|write)\b/gi;

function checkTooBroadScope(text: string): LintResult | null {
  const conjunctions = text.match(CONJUNCTION_SPLITTERS)?.length ?? 0;
  const actions = new Set(
    (text.match(UNRELATED_ACTION_RE) ?? []).map((a) => a.toLowerCase()),
  );

  // Multiple conjunction splitters AND many distinct action verbs => too broad
  if (conjunctions >= 2 && actions.size >= 3) {
    return {
      id: "too-broad-scope",
      severity: "warning",
      message: "Prompt tries to accomplish multiple unrelated tasks at once.",
      suggestion:
        "Break this into separate, focused prompts — one per task. This leads to higher-quality results for each.",
    };
  }
  return null;
}

// ── Rule: no-verification-criteria ──────────────────────────────

const VERIFICATION_RE =
  /\b(accept(?:ance)?|assert|criteria|definition of done|done when|expect(?:ed)?|must pass|should (?:return|output|produce|render|display|show)|success(?:ful)?|test(?:s|ed)?|verif(?:y|ied|ication)|validate|result should|output should)\b/i;

function checkNoVerificationCriteria(text: string): LintResult | null {
  const words = text.trim().split(/\s+/).length;
  // Only flag for prompts with enough complexity to warrant criteria (>20 words)
  if (words > 20 && !VERIFICATION_RE.test(text)) {
    return {
      id: "no-verification-criteria",
      severity: "warning",
      message: "No definition of done or success criteria specified.",
      suggestion:
        "Add what \"done\" looks like, e.g. \"The tests should pass\" or \"The function should return an array of strings\".",
    };
  }
  return null;
}

// ── Rule: missing-constraints ───────────────────────────────────

const CONSTRAINT_RE =
  /\b(avoid|cannot|do not|don't|limit|must not|only|should not|without|prefer|use .+ instead|in (?:TypeScript|Python|Go|Rust|Java)|no external|no dependencies|backward.?compat|must be|keep it)\b/i;

function checkMissingConstraints(text: string): LintResult | null {
  const words = text.trim().split(/\s+/).length;
  // Only flag for prompts long enough to benefit from constraints (>30 words)
  if (words > 30 && !CONSTRAINT_RE.test(text)) {
    return {
      id: "missing-constraints",
      severity: "warning",
      message: "No explicit constraints on language, framework, or approach preferences found.",
      suggestion:
        "Specify constraints like preferred language, frameworks to use or avoid, performance requirements, or compatibility needs.",
    };
  }
  return null;
}

// ── Rule: wall-of-text ──────────────────────────────────────────

const STRUCTURE_RE = /[-*]\s+|^\d+\.\s+|^#{1,6}\s+|```/m;

function checkWallOfText(text: string): LintResult | null {
  if (text.length > 2000 && !STRUCTURE_RE.test(text)) {
    return {
      id: "wall-of-text",
      severity: "warning",
      message: "Prompt is over 2000 characters with no structural formatting.",
      suggestion:
        "Use bullet points, numbered lists, headings, or code blocks to organize long prompts into sections (e.g. Goal, Context, Constraints, Acceptance Criteria).",
    };
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────

const RULES = [
  checkVagueInstruction,
  checkMissingContext,
  checkTooBroadScope,
  checkNoVerificationCriteria,
  checkMissingConstraints,
  checkWallOfText,
] as const;

export function lintPrompt(text: string): LintResult[] {
  if (!text || !text.trim()) return [];

  const results: LintResult[] = [];
  for (const rule of RULES) {
    const result = rule(text);
    if (result) results.push(result);
  }
  return results;
}
