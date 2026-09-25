/**
 * LangChain Code Review Agent — OpenRouter Edition
 *
 * Uses ChatOpenAI from @langchain/openai pointed at OpenRouter's
 * OpenAI-compatible endpoint (https://openrouter.ai/api/v1).
 * Model: anthropic/claude-sonnet-5 (fast, affordable, great at code).
 *
 * Input:  diff + full file contents + ESLint findings
 * Output: structured issue array via Zod schema (model.withStructuredOutput)
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ReviewResponseSchema } from './schemas.js';

// Max chars sent to LLM to stay within context/cost limits
const MAX_FILE_CONTENT_CHARS = 8000;
const MAX_DIFF_CHARS = 12000;

// OpenRouter model — best balance of quality + cost for code review
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-5';

function truncate(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n... [truncated — ${text.length - maxChars} more chars]`;
}

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

## Changed File Contents (full context)
${fileSection || 'No file contents available.'}

## Static Analysis (ESLint) Pre-Findings
${eslintSection}

## Your Task
Review this PR thoroughly. For each issue you find:

1. **Certainty**: Use "Bug - Certain" ONLY when the code WILL cause a runtime error or wrong behavior. Use "Code Smell - Stylistic" for style/maintainability that doesn't break functionality.

2. **Security first**: Flag injection risks, unsafe deserialization, exposed secrets, improper input validation, auth bypasses.

3. **Performance**: Flag N+1 queries, blocking async code, memory leaks, inefficient algorithms in hot paths.

4. **Confidence**: Be honest — lower confidence when issues depend on runtime context you can't verify.

5. **Source**: Always set source to "llm-only" — the merge step will upgrade to "static+llm" when ESLint also found the same issue.

6. **Suggested fixes**: Provide concrete before/after code snippets, not just descriptions.

7. **Line numbers**: Use exact line numbers from the diff/file.

Focus on changed lines in the diff. Be thorough but avoid false positives — quality over quantity.`;
}

let reviewChain = null;

function getReviewChain() {
  if (reviewChain) return reviewChain;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set in .env. Add: OPENROUTER_API_KEY=sk-or-v1-...'
    );
  }

  const model = new ChatOpenAI({
    model: OPENROUTER_MODEL,
    apiKey,
    temperature: 0.1,
    maxTokens: 3000,  // kept low to fit within OpenRouter free credit limits
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'CodeGuard AI',
      },
    },
  });

  reviewChain = model.withStructuredOutput(ReviewResponseSchema, {
    name: 'code_review',
  });

  console.log(`🤖 Review chain ready: ${OPENROUTER_MODEL} via OpenRouter`);
  return reviewChain;
}

/**
 * Run the LLM review chain.
 *
 * @param {object} params
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
  console.log(`🤖 Starting LLM review: ${OPENROUTER_MODEL} via OpenRouter...`);

  const chain = getReviewChain();
  const prompt = buildPrompt({
    owner, repo, pullNumber, prTitle, diff, fileContents, eslintFindings,
  });

  const messages = [
    new SystemMessage(
      'You are CodeGuard AI, a precise code review assistant. Always respond with valid structured output matching the schema exactly.'
    ),
    new HumanMessage(prompt),
  ];

  try {
    const result = await chain.invoke(messages);
    console.log(`✅ LLM review complete: ${result.issues?.length ?? 0} issues found`);
    return result;
  } catch (e) {
    console.error('❌ LLM review failed:', e.message);
    // Return empty so static-analysis results still flow through
    return {
      issues: [],
      summary: `LLM review failed: ${e.message}. Static analysis results are still included below.`,
    };
  }
}
