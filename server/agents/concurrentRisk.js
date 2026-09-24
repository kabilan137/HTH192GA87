/**
 * Concurrent Modification Risk — Detection Engine
 *
 * Steps A–D from the spec:
 *   A. Fetch sibling open PRs (excluding the PR under review)
 *   B. File-level overlap filter (cheap, eliminates most PRs)
 *   C. Hunk-level collision detection (only on survivors)
 *   D. LLM explanation pass via OpenRouter/Claude
 *
 * Detection is deterministic (ground truth from real diffs).
 * Only the explanation text is LLM-generated.
 * Issues produced here carry source = "diff-overlap" — they do NOT
 * inflate the false-positive rate.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { parseHunkRanges, findOverlappingHunks } from './hunkParser.js';
import { randomUUID } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const SIBLING_PR_LOOKBACK_DAYS = 30;
const MAX_SIBLING_PRS = 20; // cap to keep this fast on large repos
const HUNK_BUFFER_LINES = 3;

// ─── GitHub REST helpers (re-use token from env) ──────────────────────────────

async function ghFetch(path) {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Step A: Fetch open sibling PRs, excluding the one being reviewed.
 * Filtered to PRs updated within SIBLING_PR_LOOKBACK_DAYS.
 */
async function fetchSiblingPRs(owner, repo, currentPRNumber) {
  const prs = await ghFetch(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=${MAX_SIBLING_PRS}&sort=updated&direction=desc`
  );

  const cutoff = Date.now() - SIBLING_PR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return prs.filter((pr) => {
    if (pr.number === currentPRNumber) return false;
    const updatedAt = new Date(pr.updated_at).getTime();
    return updatedAt >= cutoff;
  });
}

/**
 * Step A (files): Fetch changed files for a PR (returns array with filename + patch).
 */
async function fetchSiblingFiles(owner, repo, prNumber) {
  try {
    return await ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
  } catch (e) {
    console.warn(`⚠️  Could not fetch files for sibling PR #${prNumber}: ${e.message}`);
    return [];
  }
}

/**
 * Step B: File-level overlap filter.
 * Returns sibling files that share a path with the reviewed PR's files.
 *
 * @param {string[]} reviewedFilePaths - Changed file paths in the PR under review
 * @param {Array}    siblingFiles      - GitHub API file objects for a sibling PR
 * @returns {Array} Filtered sibling files that overlap
 */
function filterOverlappingFiles(reviewedFilePaths, siblingFiles) {
  const reviewedSet = new Set(reviewedFilePaths);
  return siblingFiles.filter((f) => reviewedSet.has(f.filename));
}

/**
 * Step C: Hunk-level collision detection.
 *
 * @param {Object} reviewedPRFiles   - { filename: patchText } for the PR under review
 * @param {Object} siblingPR         - GitHub PR object (has .head.ref, .user.login, .updated_at)
 * @param {Array}  overlappingFiles  - File objects from the sibling PR that overlap
 * @returns {Array} Collision records
 */
function detectCollisions(reviewedPRFiles, siblingPR, overlappingFiles) {
  const collisions = [];

  for (const siblingFile of overlappingFiles) {
    const filename = siblingFile.filename;
    const siblingPatch = siblingFile.patch || '';
    const reviewedPatch = reviewedPRFiles[filename] || '';

    const siblingRanges  = parseHunkRanges(siblingPatch);
    const reviewedRanges = parseHunkRanges(reviewedPatch);

    // If either side has no hunk info, fall back to file-level collision
    if (siblingRanges.length === 0 || reviewedRanges.length === 0) {
      collisions.push({
        id: randomUUID().slice(0, 8),
        file: filename,
        lineRangeSelf: [0, 0],
        lineRangeOther: [0, 0],
        collisionType: 'file-level',
        conflictingBranch: siblingPR.head?.ref || `PR#${siblingPR.number}`,
        conflictingAuthor: siblingPR.user?.login || 'unknown',
        conflictingPRNumber: siblingPR.number,
        conflictingPRTitle: siblingPR.title,
        lastPushedAt: siblingPR.updated_at,
        explanation: '', // filled in by LLM pass
      });
      continue;
    }

    const hunkCollisions = findOverlappingHunks(reviewedRanges, siblingRanges, HUNK_BUFFER_LINES);

    for (const hc of hunkCollisions) {
      collisions.push({
        id: randomUUID().slice(0, 8),
        file: filename,
        lineRangeSelf: hc.rangeA,
        lineRangeOther: hc.rangeB,
        collisionType: hc.type,
        conflictingBranch: siblingPR.head?.ref || `PR#${siblingPR.number}`,
        conflictingAuthor: siblingPR.user?.login || 'unknown',
        conflictingPRNumber: siblingPR.number,
        conflictingPRTitle: siblingPR.title,
        lastPushedAt: siblingPR.updated_at,
        explanation: '',
      });
    }
  }

  return collisions;
}

// ─── Step D: LLM Explanation ─────────────────────────────────────────────────

const CollisionExplanationSchema = z.object({
  explanations: z.array(
    z.object({
      collisionId: z.string(),
      explanation: z.string().describe(
        'One-sentence technical explanation of what could go wrong if both branches merge independently, e.g. "Both branches modify the password-hashing function; the branch fixing timing attacks may silently overwrite the branch adding bcrypt rounds."'
      ),
    })
  ),
});

let concurrentRiskChain = null;

function getConcurrentRiskChain() {
  if (concurrentRiskChain) return concurrentRiskChain;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const model = new ChatOpenAI({
    model: 'anthropic/claude-sonnet-5',
    apiKey,
    temperature: 0.1,
    maxTokens: 2000,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'CodeGuard AI' },
    },
  });

  concurrentRiskChain = model.withStructuredOutput(CollisionExplanationSchema, {
    name: 'concurrent_risk_explanations',
  });
  return concurrentRiskChain;
}

async function addLLMExplanations(collisions, owner, repo, prTitle, diff) {
  if (collisions.length === 0) return collisions;

  const collisionSummary = collisions.map((c) =>
    `- ID: ${c.id}\n  File: ${c.file}\n  Your lines: ${c.lineRangeSelf[0]}–${c.lineRangeSelf[1]}\n  Sibling branch "${c.conflictingBranch}" (by @${c.conflictingAuthor}) lines: ${c.lineRangeOther[0]}–${c.lineRangeOther[1]}\n  Type: ${c.collisionType}\n  Sibling PR title: "${c.conflictingPRTitle}"`
  ).join('\n\n');

  const prompt = `You are CodeGuard AI's Concurrent Modification Risk analyst.

Repository: ${owner}/${repo}
PR being reviewed: "${prTitle}"

The following file/line-range overlaps were found between this PR and other currently-open sibling branches:

${collisionSummary}

For EACH collision (identified by its ID), write one concrete sentence explaining:
- What could go wrong if both branches merge to main independently
- Which specific code element is at risk (function name, variable, logic block)
- Be specific, not generic. Reference the file path and sibling branch name.

Keep each explanation under 30 words.`;

  try {
    const chain = getConcurrentRiskChain();
    const result = await chain.invoke([
      new SystemMessage('You are a precise merge-conflict risk analyst. Return structured JSON only.'),
      new HumanMessage(prompt),
    ]);

    // Map explanations back to collision objects
    const explMap = Object.fromEntries(
      (result.explanations || []).map((e) => [e.collisionId, e.explanation])
    );

    return collisions.map((c) => ({
      ...c,
      explanation: explMap[c.id] || `Line-range overlap in ${c.file} between this branch and "${c.conflictingBranch}" — coordinate before merging.`,
    }));
  } catch (e) {
    console.warn(`⚠️  LLM explanation pass failed: ${e.message} — using fallback explanations`);
    return collisions.map((c) => ({
      ...c,
      explanation: `${c.collisionType === 'line-level' ? 'High-risk' : 'Moderate'} overlap in ${c.file} (lines ${c.lineRangeSelf[0]}–${c.lineRangeSelf[1]}) with branch "${c.conflictingBranch}" — coordinate before merging.`,
    }));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full concurrent modification risk pipeline.
 * Designed to run in parallel with the main ESLint + LLM review.
 *
 * @param {object}   params
 * @param {string}   params.owner
 * @param {string}   params.repo
 * @param {number}   params.pullNumber       - The PR under review
 * @param {string}   params.prTitle
 * @param {Array}    params.reviewedPRFiles  - GitHub file objects for the reviewed PR
 * @param {string}   params.diff             - Full diff of the reviewed PR
 * @returns {Promise<Array>} Array of collision issue objects (source='diff-overlap')
 */
export async function detectConcurrentModificationRisk({
  owner,
  repo,
  pullNumber,
  prTitle,
  reviewedPRFiles,
  diff,
}) {
  console.log(`🔀 Concurrent Modification Risk: scanning sibling PRs for ${owner}/${repo}#${pullNumber}`);

  try {
    // Build patch map for the reviewed PR: { filename → patchText }
    const reviewedPatchMap = Object.fromEntries(
      (reviewedPRFiles || []).map((f) => [f.filename, f.patch || ''])
    );
    const reviewedFilePaths = Object.keys(reviewedPatchMap);

    if (reviewedFilePaths.length === 0) {
      console.log('🔀 No changed files in PR — skipping concurrent risk check');
      return [];
    }

    // Step A: Fetch sibling PRs in parallel with their file lists
    const siblingPRs = await fetchSiblingPRs(owner, repo, pullNumber);
    console.log(`🔀 Found ${siblingPRs.length} sibling PRs to check (within ${SIBLING_PR_LOOKBACK_DAYS}d lookback)`);

    if (siblingPRs.length === 0) return [];

    // Fetch all sibling file lists in parallel
    const siblingFileLists = await Promise.all(
      siblingPRs.map((pr) => fetchSiblingFiles(owner, repo, pr.number))
    );

    // Step B: File-level overlap filter
    let allCollisions = [];
    for (let i = 0; i < siblingPRs.length; i++) {
      const siblingPR    = siblingPRs[i];
      const siblingFiles = siblingFileLists[i];

      const overlapping = filterOverlappingFiles(reviewedFilePaths, siblingFiles);
      if (overlapping.length === 0) continue; // fast discard

      console.log(`   ↳ PR #${siblingPR.number} "${siblingPR.title}" overlaps on ${overlapping.length} file(s)`);

      // Step C: Hunk-level detection (only on survivors)
      const collisions = detectCollisions(reviewedPatchMap, siblingPR, overlapping);
      allCollisions.push(...collisions);
    }

    console.log(`🔀 Raw collisions before LLM pass: ${allCollisions.length}`);

    // Step D: LLM explanation pass
    allCollisions = await addLLMExplanations(allCollisions, owner, repo, prTitle, diff);

    console.log(`✅ Concurrent risk check complete: ${allCollisions.length} collision(s) found`);
    return allCollisions;

  } catch (e) {
    console.warn(`⚠️  Concurrent modification risk check failed: ${e.message}`);
    return [];
  }
}

/**
 * Convert raw collision records into issues compatible with the existing Issue schema.
 * source = 'diff-overlap' — does NOT count toward false-positive rate.
 */
export function collisionsToIssues(collisions) {
  return collisions.map((c) => ({
    id: c.id,
    file: c.file,
    line: c.lineRangeSelf[0] || 1,
    category: 'Concurrent Modification Risk',
    severity: c.collisionType === 'line-level' ? 'high' : 'medium',
    confidence: 1.0, // detection is deterministic, not inferred
    source: 'diff-overlap',
    explanation: c.explanation,
    suggestedFix: `Coordinate with @${c.conflictingAuthor} (branch: ${c.conflictingBranch}, PR #${c.conflictingPRNumber}) before merging. Their changes affect lines ${c.lineRangeOther[0]}–${c.lineRangeOther[1]} of ${c.file}.`,
    // Concurrent-risk-specific fields
    conflictingBranch: c.conflictingBranch,
    conflictingAuthor: c.conflictingAuthor,
    conflictingPRNumber: c.conflictingPRNumber,
    conflictingPRTitle: c.conflictingPRTitle,
    lineRangeSelf: c.lineRangeSelf,
    lineRangeOther: c.lineRangeOther,
    collisionType: c.collisionType,
    lastPushedAt: c.lastPushedAt,
  }));
}
