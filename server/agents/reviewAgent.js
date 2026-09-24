/**
 * LangChain Code Review Agent
 *
 * Assembles the prompt from diff + file contents + ESLint findings,
 * sends it to Claude via ChatAnthropic, and returns a structured issue list
 * via Zod schema (model.withStructuredOutput).
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ReviewResponseSchema } from './schemas.js';

// Max characters of file content to include in prompt (to stay within token limits)
const MAX_FILE_CONTENT_CHARS = 8000;
const MAX_DIFF_CHARS = 12000;

function truncate(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n... [truncated, ${text.length - maxChars} chars omitted]`;
}

/**
 * Build the structured prompt for Claude.
 */
function buildPrompt({ owner, repo, pullNumber, prTitle, diff, fileContents, eslintFindings }) {
  const eslintSection =
    eslintFindings.length > 0
      ? eslintFindings
          .map(
            (f) =>
              `  - ${f.file}:${f.line} [${f.ruleId}] ${f.message} (${f.category}, ${f.severity})`
          )
          .join('\n')
      : '  None found.';

  const fileSection = Object.entries(fileContents)
    .map(
      ([path, content]) =>
        `### File: ${path}\n\`\`\`javascript\n${truncate(content, MAX_FILE_CONTENT_CHARS)}\n\`\`\``
    )
    .join('\n\n');

  return `You are CodeGuard AI, an expert code reviewer specializing in production safety.

## Pull Request Context
- Repository: ${owner}/${repo}
- PR #${pullNumber}: "${prTitle}"

## PR Diff
\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\`

## Changed File Contents (for full context)
${fileSection || 'No file contents available.'}

## Static Analysis (ESLint) Pre-Findings
These issues were already found by ESLint before you were asked to review:
${eslintSection}

## Your Task
Perform a thorough code review of this pull request. For each issue you find:

1. **Distinguish certainty**: Use "Bug - Certain" ONLY when you are very confident the code WILL cause a runtime error or wrong behavior. Use "Code Smell - Stylistic" for style/maintainability issues that don't break functionality.

2. **Security first**: Flag any injection risks, unsafe deserialization, exposed secrets, improper input validation, auth bypasses, etc.

3. **Performance**: Flag N+1 queries, synchronous blocking in async code, memory leaks, inefficient algorithms in hot paths.

4. **Confidence**: Set confidence between 0.0 and 1.0. Be honest — lower your confidence for issues that depend on runtime context you can't verify.

5. **Source**: Set source to "llm-only" — the merge step will upgrade it to "static+llm" if ESLint also found the same issue.

6. **Suggested fixes**: Provide a concrete before/after code snippet, not just a description.

7. **Line numbers**: Use exact line numbers from the diff/file where the issue appears.

Focus on lines CHANGED in the diff. You may note issues in surrounding context if they're critical.
Be thorough but avoid false positives — quality over quantity.`;
}

let reviewChain = null;

function getReviewChain() {
  if (reviewChain) return reviewChain;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment');
  }

  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-5',
    apiKey,
    maxTokens: 8096,
    temperature: 0.1, // Low temperature for consistent structured output
  });

  reviewChain = model.withStructuredOutput(ReviewResponseSchema, {
    name: 'code_review',
  });

  return reviewChain;
}

/**
 * Run the LLM review chain.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.pullNumber
 * @param {string} params.prTitle
 * @param {string} params.diff
 * @param {Object<string, string>} params.fileContents - { filename: content }
 * @param {Array} params.eslintFindings
 * @returns {Promise<{issues: Array, summary: string}>}
 */
export async function runCodeReviewAgent({
  owner,
  repo,
  pullNumber,
  prTitle,
  diff,
  fileContents,
  eslintFindings,
}) {
  console.log('🤖 Starting LLM code review with Claude...');

  const chain = getReviewChain();
  const prompt = buildPrompt({
    owner,
    repo,
    pullNumber,
    prTitle,
    diff,
    fileContents,
    eslintFindings,
  });

  const messages = [
    new SystemMessage(
      'You are CodeGuard AI, a precise code review assistant. Always respond with valid structured output matching the schema exactly.'
    ),
    new HumanMessage(prompt),
  ];

  try {
    const result = await chain.invoke(messages);
    console.log(`✅ LLM review complete: ${result.issues?.length || 0} issues found`);
    return result;
  } catch (e) {
    console.error('❌ LLM review failed:', e.message);
    // Return empty result so we can still use static analysis
    return { issues: [], summary: `LLM review failed: ${e.message}` };
  }
}
