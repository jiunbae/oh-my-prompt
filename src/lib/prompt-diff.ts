/**
 * Prompt diff utilities
 *
 * Word-level diff using Longest Common Subsequence (LCS) algorithm
 * and Jaccard similarity on word sets. No external dependencies.
 */

export interface DiffSegment {
  type: "added" | "removed" | "unchanged";
  text: string;
}

/**
 * Tokenize text into words, preserving whitespace as part of words
 * so the reconstructed diff reads naturally.
 */
function tokenize(text: string): string[] {
  // Split on word boundaries but keep whitespace attached to the following word
  const tokens = text.match(/\S+|\n/g);
  return tokens ?? [];
}

/**
 * Compute the LCS (Longest Common Subsequence) table for two arrays of words.
 * Returns the DP table for backtracking.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Use typed arrays for better performance on large inputs
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Backtrack through the LCS table to produce diff segments.
 */
function backtrack(
  dp: number[][],
  a: string[],
  b: string[],
  i: number,
  j: number
): DiffSegment[] {
  const segments: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      segments.push({ type: "unchanged", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      segments.push({ type: "added", text: b[j - 1] });
      j--;
    } else {
      segments.push({ type: "removed", text: a[i - 1] });
      i--;
    }
  }

  segments.reverse();
  return segments;
}

/**
 * Merge consecutive segments of the same type to reduce output size.
 */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const merged: DiffSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const last = merged[merged.length - 1];
    if (last.type === segments[i].type) {
      last.text += " " + segments[i].text;
    } else {
      merged.push({ ...segments[i] });
    }
  }

  return merged;
}

/**
 * Compute word-level diff between two texts using LCS.
 *
 * @param textA - Original text (left side)
 * @param textB - Modified text (right side)
 * @returns Array of diff segments with type and text
 */
export function computeDiff(textA: string, textB: string): DiffSegment[] {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  // Edge cases
  if (wordsA.length === 0 && wordsB.length === 0) return [];
  if (wordsA.length === 0) {
    return [{ type: "added", text: wordsB.join(" ") }];
  }
  if (wordsB.length === 0) {
    return [{ type: "removed", text: wordsA.join(" ") }];
  }

  const dp = lcsTable(wordsA, wordsB);
  const segments = backtrack(dp, wordsA, wordsB, wordsA.length, wordsB.length);
  return mergeSegments(segments);
}

/**
 * Compute Jaccard similarity between two texts based on word sets.
 *
 * @param textA - First text
 * @param textB - Second text
 * @returns Similarity score between 0 and 1
 */
export function computeSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(tokenize(textA.toLowerCase()));
  const wordsB = new Set(tokenize(textB.toLowerCase()));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
