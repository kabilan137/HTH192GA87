/**
 * Issue Merge Logic & Risk Scoring
 *
 * Merges ESLint findings with LLM issues:
 * - Tags source as "static+llm", "llm-only", or "static-only"
 * - Computes risk score (0–100)
 * - Computes false-positive rate
 * - Selects top-3 must-fix issues
 */

import { randomUUID } from 'crypto';

// Category weights
const CATEGORY_WEIGHTS = {
  'Security Vulnerability':          10,
  'Bug - Certain':                    7,
  'Concurrent Modification Risk':     6, // line-level; file-level uses 2 (applied below)
  'Performance Risk':                 4,
  'Known Pattern - Previously Flagged': 3, // probabilistic — counted in FPR
  'Code Smell - Stylistic':           1,
};

// For concurrent risk, use collisionType to pick the right weight
function getCategoryWeight(issue) {
  if (issue.category === 'Concurrent Modification Risk') {
    return issue.collisionType === 'line-level' ? 6 : 2;
  }
  return CATEGORY_WEIGHTS[issue.category] || 1;
}

/**
 * Check if an ESLint finding and an LLM issue refer to the same problem.
 * Uses file + approximate line matching (within ±3 lines).
 */
function isSameIssue(eslintFinding, llmIssue) {
  if (eslintFinding.file !== llmIssue.file) return false;
  const lineDiff = Math.abs(eslintFinding.line - llmIssue.line);
  return lineDiff <= 3;
}

/**
 * Generate a simple unique ID for an issue.
 */
function generateId() {
  return randomUUID().slice(0, 8);
}

/**
 * Merge ESLint findings and LLM issues into a unified, deduplicated list.
 *
 * @param {Array} eslintFindings - From eslintRunner
 * @param {Array} llmIssues - From reviewAgent (source will be "llm-only")
 * @returns {Array} Merged issues with correct source tags
 */
export function mergeIssues(eslintFindings, llmIssues) {
  const merged = [];
  const usedESLintIndices = new Set();
  const usedLLMIndices = new Set();

  // First pass: find overlaps (same file + nearby line)
  for (let ei = 0; ei < eslintFindings.length; ei++) {
    const ef = eslintFindings[ei];
    let matched = false;

    for (let li = 0; li < llmIssues.length; li++) {
      if (usedLLMIndices.has(li)) continue;
      const lIssue = llmIssues[li];

      if (isSameIssue(ef, lIssue)) {
        // Both flagged it — "static+llm", take the best of both
        merged.push({
          id: generateId(),
          file: ef.file,
          line: ef.line,
          category: lIssue.category || ef.category, // LLM category is more semantic
          severity: ef.severity === 'critical' || lIssue.severity === 'critical'
            ? 'critical'
            : ef.severity === 'high' || lIssue.severity === 'high'
            ? 'high'
            : lIssue.severity || ef.severity,
          confidence: Math.max(ef.confidence, lIssue.confidence || 0.8),
          source: 'static+llm',
          explanation: lIssue.explanation || ef.message,
          suggestedFix: lIssue.suggestedFix || `Fix the ${ef.ruleId} ESLint rule violation`,
        });
        usedESLintIndices.add(ei);
        usedLLMIndices.add(li);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // ESLint-only
      merged.push({
        id: generateId(),
        file: ef.file,
        line: ef.line,
        category: ef.category,
        severity: ef.severity,
        confidence: ef.confidence,
        source: 'static-only',
        explanation: `ESLint rule "${ef.ruleId}" violation: ${ef.message}`,
        suggestedFix: `Resolve ESLint rule "${ef.ruleId}" on line ${ef.line}`,
      });
      usedESLintIndices.add(ei);
    }
  }

  // Second pass: remaining LLM-only issues
  for (let li = 0; li < llmIssues.length; li++) {
    if (usedLLMIndices.has(li)) continue;
    const lIssue = llmIssues[li];
    merged.push({
      id: generateId(),
      ...lIssue,
      source: 'llm-only',
    });
  }

  return merged;
}

/**
 * Compute the aggregate risk score (0–100).
 *
 * Formula: sum(categoryWeight × confidence) per issue,
 * normalized/capped so a heavily-flawed PR approaches 100.
 */
export function computeRiskScore(issues) {
  if (!issues || issues.length === 0) return 0;

  const rawScore = issues.reduce((sum, issue) => {
    const weight = getCategoryWeight(issue);
    return sum + weight * (issue.confidence || 0.5);
  }, 0);

  const MAX_RAW = 80;
  const normalized = Math.min(100, (rawScore / MAX_RAW) * 100);
  return Math.round(normalized);
}

/**
 * Compute false-positive rate.
 *
 * FPR = (llm-only issues) / (total non-deterministic issues) × 100
 *
 * NOTE: 'diff-overlap' and 'branch-diff-overlap' issues are EXCLUDED from the FPR denominator
 * because they are deterministically detected from real diffs, not inferred by the LLM.
 * 'review-history-match' IS included — it is a probabilistic similarity match, not a deterministic
 * finding, so wrong matches are real false positives that must be counted.
 */
export function computeFalsePositiveRate(issues) {
  if (!issues || issues.length === 0) return 0;
  // Exclude only deterministic sources from FPR denominator
  const DETERMINISTIC_SOURCES = new Set(['diff-overlap', 'branch-diff-overlap']);
  const countableIssues = issues.filter((i) => !DETERMINISTIC_SOURCES.has(i.source));
  if (countableIssues.length === 0) return 0;
  // llm-only AND review-history-match are both unconfirmed-by-static-analysis
  const unconfirmed = countableIssues.filter(
    (i) => i.source === 'llm-only' || i.source === 'review-history-match'
  ).length;
  return Math.round((unconfirmed / countableIssues.length) * 100);
}

/**
 * Select the top-3 must-fix issues.
 * Ranked by: (categoryWeight × confidence × severityMultiplier) descending.
 */
export function selectTopThreeIssues(issues) {
  const severityMultiplier = { critical: 4, high: 3, medium: 2, low: 1 };

  const scored = issues.map((issue) => ({
    id: issue.id,
    score:
      getCategoryWeight(issue) *
      (issue.confidence || 0.5) *
      (severityMultiplier[issue.severity] || 1),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.id);
}

/**
 * Full pipeline: merge, score, and produce final report data.
 * Accepts optional concurrent-risk issues and review-memory issues.
 */
export function computeReportData(eslintFindings, llmIssues, concurrentIssues = [], reviewMemoryIssues = []) {
  const baseIssues = mergeIssues(eslintFindings, llmIssues);
  const issues = [...baseIssues, ...concurrentIssues, ...reviewMemoryIssues];

  const riskScore = computeRiskScore(issues);
  const falsePositiveRate = computeFalsePositiveRate(issues);
  const topThreeIssueIds = selectTopThreeIssues(issues);

  const staticIssuesCount   = issues.filter((i) => i.source === 'static-only').length;
  const llmIssuesCount      = issues.filter((i) => i.source === 'llm-only').length;
  const combinedIssuesCount = issues.filter((i) => i.source === 'static+llm').length;
  const concurrentModificationCount = issues.filter(
    (i) => i.source === 'diff-overlap' || i.source === 'branch-diff-overlap'
  ).length;
  const reviewMemoryCount = issues.filter((i) => i.source === 'review-history-match').length;

  return {
    issues,
    riskScore,
    falsePositiveRate,
    topThreeIssueIds,
    totalIssues: issues.length,
    staticIssuesCount,
    llmIssuesCount,
    combinedIssuesCount,
    concurrentModificationCount,
    reviewMemoryCount,
  };
}
