/**
 * Zod schemas and types for CodeGuard AI
 * Used by both LangChain structured output and merge logic.
 */

import { z } from 'zod';

export const IssueCategory = z.enum([
  'Bug - Certain',
  'Security Vulnerability',
  'Performance Risk',
  'Code Smell - Stylistic',
  'Concurrent Modification Risk',
]);

export const IssueSeverity = z.enum(['critical', 'high', 'medium', 'low']);

export const IssueSource = z.enum(['static+llm', 'llm-only', 'static-only', 'diff-overlap', 'branch-diff-overlap']);

export const IssueSchema = z.object({
  file: z.string().describe('Relative path to the file containing the issue'),
  line: z.number().int().positive().describe('Exact line number in the file where the issue occurs'),
  category: IssueCategory.describe(
    'Type of issue: Bug - Certain, Security Vulnerability, Performance Risk, or Code Smell - Stylistic'
  ),
  severity: IssueSeverity.describe('Severity level: critical, high, medium, or low'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score from 0 (uncertain) to 1 (certain)'),
  source: IssueSource.describe(
    'Source: static+llm if confirmed by both ESLint and LLM, llm-only if only LLM flagged it, static-only if only ESLint flagged it'
  ),
  explanation: z
    .string()
    .describe('Clear explanation of what the issue is and why it matters for production safety'),
  suggestedFix: z
    .string()
    .describe('Concrete, code-level fix — ideally a before/after diff snippet'),
});

export const ReviewResponseSchema = z.object({
  issues: z.array(IssueSchema).describe('List of all issues found in the pull request'),
  summary: z
    .string()
    .describe('One-paragraph summary of the overall code quality and main concerns'),
});

export { z };
