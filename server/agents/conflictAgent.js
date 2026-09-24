/**
 * Merge Conflict Detection & Resolution Agent
 *
 * Compares base-branch file content against PR-branch file content and diff,
 * then uses Claude (via LangChain withStructuredOutput) to detect conflicts
 * and suggest resolution code.
 *
 * Output schema matches the CodeGuard AI conflict spec exactly.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

// ─── Zod Schema ───────────────────────────────────────────────────────────────

export const ConflictSeverity = z.enum(['high', 'medium', 'low', 'none']);

export const ConflictResultSchema = z.object({
  mergeConflict: z.boolean().describe('True if a real merge conflict is detected'),
  conflictSeverity: ConflictSeverity.describe(
    'Severity: high = same function/logic edited; medium = same file nearby lines; low = same file separate blocks; none = no conflict'
  ),
  file: z.string().describe('Relative path of the conflicting file, or empty string if none'),
  functionName: z
    .string()
    .describe('Name of the conflicting function or code block, or empty string if none'),
  startLine: z
    .number()
    .int()
    .describe('Start line of the conflict region (0 if none)'),
  endLine: z
    .number()
    .int()
    .describe('End line of the conflict region (0 if none)'),
  reason: z
    .string()
    .describe('Short technical explanation of WHY a conflict exists or does not exist'),
  developerAChanges: z
    .string()
    .describe('Summary of what the base/main branch changed in the conflict region'),
  developerBChanges: z
    .string()
    .describe('Summary of what the PR branch changed in the conflict region'),
  recommendedMergedCode: z
    .string()
    .describe(
      'The complete recommended merged code that preserves logic from both branches. Empty string if no conflict.'
    ),
  explanation: z
    .string()
    .describe(
      'Detailed explanation of the merge strategy — which branch contributed each retained change and why the merged version is safer'
    ),
  notificationMessage: z
    .string()
    .describe(
      'Human-readable notification message to send to collaborators. Empty string if no conflict.'
    ),
});

export const ConflictResponseSchema = z.object({
  conflicts: z
    .array(ConflictResultSchema)
    .describe('List of all conflict results — one entry per changed file analyzed'),
  overallConflictDetected: z
    .boolean()
    .describe('True if ANY file has a real merge conflict'),
  summary: z
    .string()
    .describe('One-paragraph overall summary of the conflict analysis'),
});

// ─── Prompt Builder ───────────────────────────────────────────────────────────

const MAX_FILE_CHARS = 6000;
const MAX_DIFF_CHARS = 10000;

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n... [truncated, ${text.length - max} chars omitted]`;
}

function buildConflictPrompt({ owner, repo, pullNumber, prTitle, diff, baseFiles, prFiles, changedFiles }) {
  const fileComparisons = changedFiles
    .map((filename) => {
      const baseContent = baseFiles[filename] || '(file does not exist on base branch)';
      const prContent   = prFiles[filename]   || '(file does not exist on PR branch)';
      return [
        `### File: ${filename}`,
        `#### Base branch (main):`,
        '```',
        truncate(baseContent, MAX_FILE_CHARS),
        '```',
        `#### PR branch:`,
        '```',
        truncate(prContent, MAX_FILE_CHARS),
        '```',
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return `You are CodeGuard AI's Merge Conflict Detection & Resolution Agent.

## Repository
${owner}/${repo} — PR #${pullNumber}: "${prTitle}"

## PR Diff
\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\`

## File Comparisons (base branch vs PR branch)
${fileComparisons || 'No file content available.'}

## Your Task
For every changed file, determine whether a merge conflict exists between the base branch (main) and the PR branch.

### Detect a conflict ONLY if:
- The SAME logical section (function, class, block) was modified DIFFERENTLY in both branches.
- The modified line ranges overlap.
- Git cannot automatically merge the changes without losing intent.

### Do NOT mark a conflict if:
- Different files are changed.
- The same file is changed in completely separate, non-overlapping sections.
- Only the PR branch touches a section (no competing main-branch edit).

### For each file, return a ConflictResult with:
- mergeConflict: true/false
- conflictSeverity: "high" | "medium" | "low" | "none"
- file: filename
- functionName: name of affected function/block (empty if none)
- startLine / endLine: conflict region line numbers (0 if none)
- reason: technical explanation
- developerAChanges: what main/base branch changed
- developerBChanges: what PR branch changed
- recommendedMergedCode: complete merged code preserving both intents
- explanation: detailed merge strategy rationale
- notificationMessage: message for both collaborators

### Severity Rules:
- high: Same function or overlapping logic edited in both branches
- medium: Same file, nearby but not identical lines
- low: Same file, separate logical blocks
- none: No conflict

Return structured JSON only.`;
}

// ─── Chain (singleton) ────────────────────────────────────────────────────────

let conflictChain = null;

function getConflictChain() {
  if (conflictChain) return conflictChain;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment');

  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-5',
    apiKey,
    maxTokens: 8096,
    temperature: 0.1,
  });

  conflictChain = model.withStructuredOutput(ConflictResponseSchema, {
    name: 'conflict_detection',
  });

  return conflictChain;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Merge Conflict Detection & Resolution agent.
 *
 * @param {object} params
 * @param {string}   params.owner
 * @param {string}   params.repo
 * @param {number}   params.pullNumber
 * @param {string}   params.prTitle
 * @param {string}   params.diff          - Full PR diff text
 * @param {string[]} params.changedFiles  - List of changed filenames
 * @param {Object<string,string>} params.baseFiles - { filename: content } from base/main branch
 * @param {Object<string,string>} params.prFiles   - { filename: content } from PR branch
 * @returns {Promise<object>} ConflictResponseSchema output
 */
export async function runConflictAgent({
  owner,
  repo,
  pullNumber,
  prTitle,
  diff,
  changedFiles,
  baseFiles,
  prFiles,
}) {
  console.log(`\n🔍 Running Conflict Agent for ${owner}/${repo}#${pullNumber} (${changedFiles.length} files)`);

  const chain  = getConflictChain();
  const prompt = buildConflictPrompt({ owner, repo, pullNumber, prTitle, diff, baseFiles, prFiles, changedFiles });

  const messages = [
    new SystemMessage(
      'You are CodeGuard AI\'s Merge Conflict Agent. Return valid structured JSON matching the schema. Be precise about line numbers.'
    ),
    new HumanMessage(prompt),
  ];

  try {
    const result = await chain.invoke(messages);
    const conflictCount = result.conflicts.filter((c) => c.mergeConflict).length;
    console.log(`✅ Conflict Agent done: ${conflictCount} conflict(s) in ${result.conflicts.length} file(s)`);
    return result;
  } catch (e) {
    console.error('❌ Conflict Agent failed:', e.message);
    return {
      conflicts: [],
      overallConflictDetected: false,
      summary: `Conflict detection failed: ${e.message}`,
    };
  }
}
