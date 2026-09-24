/**
 * Concurrent Modification Risk — Detection Engine  (Steps 18–20)
 *
 *   A. Fetch ALL active branches (not just PRs), build PR-lookup map
 *   B. File-level overlap filter via compare endpoint (cheap, runs first)
 *   C. Hunk-level collision detection — reuses parseHunkRanges / findOverlappingHunks unchanged
 *   D. futureRiskTier calculation (high / medium / low)
 *   E. LLM explanation pass — forward-looking when no PR exists
 *
 * Detection is deterministic (ground truth from real diffs).
 * Only the explanation text is LLM-generated.
 * Issues carry source = "branch-diff-overlap" — NOT counted in false-positive rate.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { parseHunkRanges, findOverlappingHunks } from './hunkParser.js';
import { randomUUID } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const ACTIVE_BRANCH_LOOKBACK_DAYS = 14;   // ignore branches not pushed within this window
const HUNK_BUFFER_LINES = 3;
const COMPARE_CONCURRENCY = 5;            // max simultaneous compare API calls
const HIGH_RISK_RECENCY_DAYS = 3;         // pushed within this → recency qualifies as "recent"

// Branch name patterns to always exclude from sibling comparison
const STALE_BRANCH_PATTERNS = [
  /^main$/,
  /^master$/,
  /^develop$/,
  /^gh-pages$/,
  /^release\//,
  /^hotfix\//,
];

// ─── GitHub REST helper ───────────────────────────────────────────────────────

async function ghFetch(path) {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 429 || res.status === 403) {
    // Rate limit — return null so callers can skip gracefully
    console.warn(`⚠️  GitHub rate limit hit on ${path} — skipping`);
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Step A helpers ───────────────────────────────────────────────────────────

/**
 * Fetch all branches in the repo with pagination.
 * Returns raw GitHub branch objects (name, commit.committer.date).
 */
async function fetchAllBranches(owner, repo) {
  const branches = [];
  let page = 1;
  while (true) {
    const page_data = await ghFetch(
      `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`
    );
    if (!page_data || page_data.length === 0) break;
    branches.push(...page_data);
    if (page_data.length < 100) break;
    page++;
  }
  return branches;
}

/**
 * Filter branches to candidates:
 *  - not the base branch
 *  - not the branch under review
 *  - not a stale/release pattern
 * (Date filtering happens later, after fetching commit details in compare step)
 */
function filterActiveBranches(branches, baseBranch, excludeBranch) {
  return branches.filter((b) => {
    if (b.name === baseBranch) return false;
    if (b.name === excludeBranch) return false;
    if (STALE_BRANCH_PATTERNS.some((p) => p.test(b.name))) return false;
    return true;
  });
}

/**
 * Fetch open PRs and build a Map: branchName → { number, title, author }
 * A branch with no entry = no open PR yet.
 */
async function buildPRLookupMap(owner, repo) {
  const map = new Map();
  try {
    const prs = await ghFetch(
      `/repos/${owner}/${repo}/pulls?state=open&per_page=100`
    );
    if (!prs) return map;
    for (const pr of prs) {
      map.set(pr.head.ref, {
        number: pr.number,
        title: pr.title,
        author: pr.user?.login || 'unknown',
      });
    }
  } catch (e) {
    console.warn(`⚠️  Could not fetch open PRs for lookup: ${e.message}`);
  }
  return map;
}

// ─── Step B: Compare endpoint ─────────────────────────────────────────────────

/**
 * Call GET /compare/{base}...{head} and return { ahead_by, files[] }.
 * Returns null if rate-limited or branch not found.
 */
async function fetchBranchCompare(owner, repo, base, head) {
  try {
    const data = await ghFetch(
      `/repos/${owner}/${repo}/compare/${base}...${head}`
    );
    return data; // { ahead_by, behind_by, files: [{filename, patch, ...}] }
  } catch (e) {
    console.warn(`⚠️  Compare ${base}...${head} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch the commit date for a branch tip SHA via GET /commits/{sha}.
 * Returns ISO date string or null.
 */
async function fetchCommitDate(owner, repo, sha) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}`);
    return data?.commit?.committer?.date || data?.commit?.author?.date || null;
  } catch {
    return null;
  }
}

/**
 * Run compare calls in batches of COMPARE_CONCURRENCY to avoid hammering API.
 * Returns array of { branch, pushedAt, compareData } for branches with ahead_by > 0
 * AND at least one file overlapping reviewedFilePaths.
 */
async function fetchOverlappingBranchCompares(
  owner, repo, baseBranch, activeBranches, reviewedFilePaths
) {
  const reviewedSet = new Set(reviewedFilePaths);
  const cutoff = Date.now() - ACTIVE_BRANCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const results = [];

  // Chunk into groups of COMPARE_CONCURRENCY
  for (let i = 0; i < activeBranches.length; i += COMPARE_CONCURRENCY) {
    const chunk = activeBranches.slice(i, i + COMPARE_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (branch) => {
        // Fetch commit date for this branch tip
        const pushedAt = await fetchCommitDate(owner, repo, branch.commit.sha);

        // Apply recency filter here (since /branches list doesn't return commit date)
        if (pushedAt) {
          const daysAgo = (Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (daysAgo > ACTIVE_BRANCH_LOOKBACK_DAYS) return null; // too old
        }

        const compareData = await fetchBranchCompare(owner, repo, baseBranch, branch.name);
        if (!compareData) return null;
        if (compareData.ahead_by === 0) return null; // nothing to compare
        const overlappingFiles = (compareData.files || []).filter(
          (f) => reviewedSet.has(f.filename)
        );
        if (overlappingFiles.length === 0) return null; // fast discard
        return {
          branch,
          pushedAt,
          overlappingFiles,
        };
      })
    );
    results.push(...chunkResults.filter(Boolean));
  }
  return results;
}

// ─── Step C: Hunk-level collision detection ───────────────────────────────────

/**
 * Compute futureRiskTier based on collisionType and recency.
 */
function computeFutureRiskTier(collisionType, pushedAt) {
  const daysAgo = pushedAt
    ? (Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const isRecent = daysAgo <= HIGH_RISK_RECENCY_DAYS;

  if (collisionType === 'line-level' && isRecent) return 'high';
  if (collisionType === 'line-level') return 'medium';       // line-level but older
  if (collisionType === 'file-level' && isRecent) return 'medium'; // file-level recent
  return 'low';                                               // file-level older
}

/**
 * Detect hunk-level collisions between the reviewed PR and one sibling branch.
 * siblingBranchMeta: { branch: GitHubBranchObj, pushedAt, overlappingFiles }
 * prLookupMap: Map<branchName, {number, title, author}>
 */
function detectCollisions(reviewedPatchMap, siblingBranchMeta, prLookupMap) {
  const { branch, pushedAt, overlappingFiles } = siblingBranchMeta;
  const branchName = branch.name;
  const prInfo = prLookupMap.get(branchName) || null;
  const siblingHasOpenPr = prInfo !== null;

  // Determine the committer of the sibling branch from the branches endpoint
  const siblingAuthor =
    branch.commit?.commit?.committer?.name ||
    branch.commit?.commit?.author?.name ||
    (prInfo?.author) ||
    'unknown';

  const collisions = [];

  for (const siblingFile of overlappingFiles) {
    const filename = siblingFile.filename;
    const siblingPatch = siblingFile.patch || '';
    const reviewedPatch = reviewedPatchMap[filename] || '';

    const siblingRanges  = parseHunkRanges(siblingPatch);
    const reviewedRanges = parseHunkRanges(reviewedPatch);

    // Fall back to file-level if either side has no parseable hunks
    if (siblingRanges.length === 0 || reviewedRanges.length === 0) {
      const tier = computeFutureRiskTier('file-level', pushedAt);
      collisions.push({
        id: randomUUID().slice(0, 8),
        file: filename,
        lineRangeSelf: [0, 0],
        lineRangeOther: [0, 0],
        collisionType: 'file-level',
        futureRiskTier: tier,
        siblingHasOpenPr,
        conflictingBranch: branchName,
        conflictingAuthor: siblingAuthor,
        conflictingPRNumber: prInfo?.number ?? null,
        conflictingPRTitle: prInfo?.title ?? null,
        lastPushedAt: pushedAt,
        explanation: '',
      });
      continue;
    }

    const hunkCollisions = findOverlappingHunks(reviewedRanges, siblingRanges, HUNK_BUFFER_LINES);

    for (const hc of hunkCollisions) {
      const tier = computeFutureRiskTier(hc.type, pushedAt);
      collisions.push({
        id: randomUUID().slice(0, 8),
        file: filename,
        lineRangeSelf: hc.rangeA,
        lineRangeOther: hc.rangeB,
        collisionType: hc.type,
        futureRiskTier: tier,
        siblingHasOpenPr,
        conflictingBranch: branchName,
        conflictingAuthor: siblingAuthor,
        conflictingPRNumber: prInfo?.number ?? null,
        conflictingPRTitle: prInfo?.title ?? null,
        lastPushedAt: pushedAt,
        explanation: '',
      });
    }
  }

  return collisions;
}

// ─── Step E: LLM Explanation ──────────────────────────────────────────────────

const CollisionExplanationSchema = z.object({
  explanations: z.array(
    z.object({
      collisionId: z.string(),
      explanation: z.string().describe(
        'One-sentence technical explanation of the merge risk. Forward-looking when no PR exists yet.'
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

  const collisionSummary = collisions.map((c) => {
    const prContext = c.siblingHasOpenPr
      ? `PR #${c.conflictingPRNumber}: "${c.conflictingPRTitle}"`
      : `NO PR yet — branch already pushed, not reviewed`;
    return (
      `- ID: ${c.id}\n` +
      `  File: ${c.file}\n` +
      `  This branch lines: ${c.lineRangeSelf[0]}–${c.lineRangeSelf[1]}\n` +
      `  Sibling branch "${c.conflictingBranch}" (by @${c.conflictingAuthor}) lines: ${c.lineRangeOther[0]}–${c.lineRangeOther[1]}\n` +
      `  Collision type: ${c.collisionType}\n` +
      `  Future risk tier: ${c.futureRiskTier}\n` +
      `  Sibling PR context: ${prContext}`
    );
  }).join('\n\n');

  const prompt = `You are CodeGuard AI's Concurrent Modification Risk analyst.

Repository: ${owner}/${repo}
Branch/PR being reviewed: "${prTitle}"

The following file/line-range overlaps were found between this branch and other active sibling branches:

${collisionSummary}

For EACH collision (identified by its ID), write one concrete sentence explaining the merge risk.
IMPORTANT RULES:
- If "Sibling PR context" says "NO PR yet": phrase as a FORWARD-LOOKING warning, e.g. "No PR yet, but branch X already edits the same validation function — worth syncing with @author before either of you opens a PR"
- If a PR does exist: phrase as a current actionable warning about merging both PRs
- Always reference the file path, specific function or code element, and sibling branch name
- Keep each explanation under 35 words`;

  try {
    const chain = getConcurrentRiskChain();
    const result = await chain.invoke([
      new SystemMessage('You are a precise merge-conflict risk analyst. Return structured JSON only.'),
      new HumanMessage(prompt),
    ]);

    const explMap = Object.fromEntries(
      (result.explanations || []).map((e) => [e.collisionId, e.explanation])
    );

    return collisions.map((c) => ({
      ...c,
      explanation: explMap[c.id] || fallbackExplanation(c),
    }));
  } catch (e) {
    console.warn(`⚠️  LLM explanation pass failed: ${e.message} — using fallback explanations`);
    return collisions.map((c) => ({ ...c, explanation: fallbackExplanation(c) }));
  }
}

function fallbackExplanation(c) {
  if (!c.siblingHasOpenPr) {
    return `No PR yet, but branch "${c.conflictingBranch}" already edits ${c.file} (lines ${c.lineRangeOther[0]}–${c.lineRangeOther[1]}) — sync with @${c.conflictingAuthor} before opening a PR.`;
  }
  return `${c.collisionType === 'line-level' ? 'High-risk' : 'Moderate'} overlap in ${c.file} (lines ${c.lineRangeSelf[0]}–${c.lineRangeSelf[1]}) with branch "${c.conflictingBranch}" (PR #${c.conflictingPRNumber}) — coordinate before merging.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full concurrent modification risk pipeline.
 * Runs against ALL active branches — not just branches with open PRs.
 *
 * @param {object}  params
 * @param {string}  params.owner
 * @param {string}  params.repo
 * @param {string}  params.reviewedBranch   - Name of the branch under review
 * @param {string}  params.baseBranch       - The default/base branch (e.g. 'main')
 * @param {string}  params.prTitle          - Display name for the reviewed branch/PR
 * @param {Array}   params.reviewedPRFiles  - GitHub file objects with .filename and .patch
 * @param {string}  params.diff             - Full unified diff string
 * @returns {Promise<Array>} Raw collision objects (call collisionsToIssues() to convert)
 */
export async function detectConcurrentModificationRisk({
  owner,
  repo,
  reviewedBranch,
  baseBranch,
  prTitle,
  reviewedPRFiles,
  diff,
}) {
  console.log(`🔀 Concurrent Modification Risk: scanning active branches for ${owner}/${repo} (reviewing: ${reviewedBranch})`);

  try {
    // Build patch map for the reviewed branch: { filename → patchText }
    const reviewedPatchMap = Object.fromEntries(
      (reviewedPRFiles || []).map((f) => [f.filename, f.patch || ''])
    );
    const reviewedFilePaths = Object.keys(reviewedPatchMap);

    if (reviewedFilePaths.length === 0) {
      console.log('🔀 No changed files — skipping concurrent risk check');
      return [];
    }

    // Step A: Fetch branches + PR lookup map in parallel
    const [allBranches, prLookupMap] = await Promise.all([
      fetchAllBranches(owner, repo),
      buildPRLookupMap(owner, repo),
    ]);

    const activeBranches = filterActiveBranches(allBranches, baseBranch, reviewedBranch);
    console.log(`🔀 ${allBranches.length} total branches → ${activeBranches.length} active candidates (within ${ACTIVE_BRANCH_LOOKBACK_DAYS}d lookback)`);

    if (activeBranches.length === 0) return [];

    // Step B: Compare endpoint — file-level overlap filter (batched, max 5 concurrent)
    const overlappingBranches = await fetchOverlappingBranchCompares(
      owner, repo, baseBranch, activeBranches, reviewedFilePaths
    );
    console.log(`🔀 ${overlappingBranches.length} branch(es) share changed files — running hunk analysis`);

    if (overlappingBranches.length === 0) return [];

    // Step C: Hunk-level collision detection on survivors
    let allCollisions = [];
    for (const siblingBranchMeta of overlappingBranches) {
      const hasPR = prLookupMap.has(siblingBranchMeta.branch.name);
      console.log(
        `   ↳ Branch "${siblingBranchMeta.branch.name}" (${hasPR ? `PR #${prLookupMap.get(siblingBranchMeta.branch.name).number}` : 'no PR yet'}) — ${siblingBranchMeta.overlappingFiles.length} overlapping file(s)`
      );
      const collisions = detectCollisions(reviewedPatchMap, siblingBranchMeta, prLookupMap);
      allCollisions.push(...collisions);
    }

    console.log(`🔀 Raw collisions before LLM pass: ${allCollisions.length}`);

    // Step E: LLM explanation pass
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
 * source = 'branch-diff-overlap' — does NOT count toward false-positive rate.
 */
export function collisionsToIssues(collisions) {
  return collisions.map((c) => ({
    id: c.id,
    file: c.file,
    line: c.lineRangeSelf[0] || 1,
    category: 'Concurrent Modification Risk',
    severity: c.collisionType === 'line-level' ? 'high' : 'medium',
    confidence: 1.0, // deterministic — not an LLM guess
    source: 'branch-diff-overlap',
    explanation: c.explanation,
    suggestedFix: c.siblingHasOpenPr
      ? `Coordinate with @${c.conflictingAuthor} (branch: ${c.conflictingBranch}, PR #${c.conflictingPRNumber}) before merging. Their changes affect lines ${c.lineRangeOther[0]}–${c.lineRangeOther[1]} of ${c.file}.`
      : `Reach out to @${c.conflictingAuthor} about branch "${c.conflictingBranch}" — they're editing the same lines (${c.lineRangeOther[0]}–${c.lineRangeOther[1]}) in ${c.file} without a PR yet. Sync before either branch merges.`,
    // Concurrent-risk-specific fields
    conflictingBranch:   c.conflictingBranch,
    conflictingAuthor:   c.conflictingAuthor,
    conflictingPRNumber: c.conflictingPRNumber,
    conflictingPRTitle:  c.conflictingPRTitle,
    lineRangeSelf:       c.lineRangeSelf,
    lineRangeOther:      c.lineRangeOther,
    collisionType:       c.collisionType,
    futureRiskTier:      c.futureRiskTier,
    siblingHasOpenPr:    c.siblingHasOpenPr,
    lastPushedAt:        c.lastPushedAt,
  }));
}
