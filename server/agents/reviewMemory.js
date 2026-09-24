/**
 * Review Memory — Incident Ingestion (Steps 25–28)
 *
 * Part 1: fetch resolved review threads via GraphQL, extract incidents,
 * embed them, and store in the Incident collection.
 *
 * Source: 'review-history-match' IS counted in FPR (probabilistic similarity).
 */

import { graphql } from '@octokit/graphql';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Incident } from '../models/Incident.js';
import { randomUUID } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const IMPORT_BATCH_SIZE = 20; // default number of merged PRs to scan

// ─── GraphQL client ───────────────────────────────────────────────────────────

function getGraphQLClient() {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN not set');
  return graphql.defaults({
    headers: { authorization: `Bearer ${token}` },
  });
}

// ─── Step 25: Fetch resolved review threads for a PR ─────────────────────────

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        number
        title
        mergedAt
        mergeCommit { oid }
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            comments(first: 50) {
              nodes {
                body
                diffHunk
                path
                originalLine
                author { login }
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchResolvedThreadsForPR(owner, repo, prNumber) {
  const gql = getGraphQLClient();
  const resolvedThreads = [];
  let after = null;

  while (true) {
    const data = await gql(REVIEW_THREADS_QUERY, { owner, repo, prNumber, after });
    const pr = data.repository.pullRequest;
    if (!pr) break;

    const { nodes, pageInfo } = pr.reviewThreads;
    for (const thread of nodes) {
      if (!thread.isResolved) continue; // discard unresolved — no fix to learn from
      if (thread.comments.nodes.length === 0) continue;
      resolvedThreads.push({
        threadId: thread.id,
        prNumber: pr.number,
        prTitle: pr.title,
        mergedAt: pr.mergedAt,
        mergeCommitSha: pr.mergeCommit?.oid || null,
        comments: thread.comments.nodes,
      });
    }

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return resolvedThreads;
}

// ─── Step 25: Fetch list of merged PRs ───────────────────────────────────────

const MERGED_PRS_QUERY = `
  query($owner: String!, $repo: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: MERGED, first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes { number title mergedAt }
      }
    }
  }
`;

export async function fetchMergedPRNumbers(owner, repo, limit = IMPORT_BATCH_SIZE) {
  const gql = getGraphQLClient();
  const prs = [];
  let after = null;
  let remaining = limit;

  while (remaining > 0) {
    const fetch_count = Math.min(remaining, 100);
    const data = await gql(MERGED_PRS_QUERY, { owner, repo, first: fetch_count, after });
    const { nodes, pageInfo } = data.repository.pullRequests;
    prs.push(...nodes);
    remaining -= nodes.length;
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return prs.slice(0, limit);
}

// ─── Step B: Fetch file content at a commit sha ───────────────────────────────

async function fetchFileAtSha(owner, repo, path, sha) {
  if (!sha) return null;
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${sha}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.content) return null;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function extractLineRegion(fileContent, targetLine, context = 5) {
  if (!fileContent || !targetLine) return null;
  const lines = fileContent.split('\n');
  const start = Math.max(0, targetLine - context - 1);
  const end = Math.min(lines.length, targetLine + context);
  return lines.slice(start, end).join('\n');
}

// ─── Step C: Embedding ───────────────────────────────────────────────────────

let _embeddingModel = null;

export async function getEmbeddingModel() {
  if (_embeddingModel) return _embeddingModel;

  const voyageKey = process.env.VOYAGE_API_KEY;

  if (voyageKey) {
    try {
      const { VoyageEmbeddings } = await import('@langchain/community/embeddings/voyage');
      _embeddingModel = new VoyageEmbeddings({
        apiKey: voyageKey,
        modelName: 'voyage-code-2',
      });
      console.log('✅ Using Voyage AI embeddings (code-optimized)');
      return _embeddingModel;
    } catch (err) {
      console.warn('⚠️  VOYAGE_API_KEY set but failed to initialize VoyageEmbeddings:', err.message);
    }
  }

  // Graceful fallback when VOYAGE_API_KEY is not set
  console.warn('⚠️  VOYAGE_API_KEY is not set. Falling back gracefully to keyword/text-index similarity (semantic matching is degraded).');
  return null;
}

/**
 * Get an embedding vector for text.
 * Returns float[] or null if no embedding provider is available.
 * This is the single swappable embedding function — callers never know which backend ran.
 */
export async function getEmbedding(text) {
  const model = await getEmbeddingModel();
  if (!model) return null;
  try {
    const vectors = await model.embedDocuments([text]);
    return vectors[0] || null;
  } catch (e) {
    console.warn(`⚠️  Embedding failed: ${e.message} — returning null`);
    return null;
  }
}

// ─── Step B+C: Extract incident from a resolved thread ───────────────────────

export async function extractAndEmbedIncident(owner, repo, thread) {
  const firstComment = thread.comments[0];
  const filePath = firstComment.path;
  const originalLine = firstComment.originalLine;
  const problemSnippet = firstComment.diffHunk || '';

  // Concatenate all comment bodies in thread order
  const reviewerComment = thread.comments
    .map((c) => c.body)
    .join('\n\n');

  const reviewerLogin = firstComment.author?.login || 'unknown';

  // "Problem side" = problemSnippet + "\n" + reviewerComment
  const problemText = `${problemSnippet}\n${reviewerComment}`;

  // Resolution snippet = file content at merge commit, around the affected line
  let resolutionSnippet = null;
  if (thread.mergeCommitSha && filePath) {
    const fileContent = await fetchFileAtSha(owner, repo, filePath, thread.mergeCommitSha);
    resolutionSnippet = extractLineRegion(fileContent, originalLine, 8);
  }

  // Embed the problem side (what to match future code against)
  const embedding = await getEmbedding(problemText);

  return {
    id: randomUUID().slice(0, 12),
    owner,
    repo,
    prNumber: thread.prNumber,
    prTitle: thread.prTitle,
    filePath,
    originalLine,
    problemSnippet,
    reviewerComment,
    reviewerLogin,
    resolutionSnippet,
    mergedAt: thread.mergedAt,
    embedding, // null when no embedding provider
  };
}

// ─── Step 28: Full import pipeline ───────────────────────────────────────────

/**
 * Import resolved review history from the last N merged PRs.
 * Called by POST /api/repos/:owner/:repo/import-history
 *
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export async function importReviewHistory(owner, repo, limit = IMPORT_BATCH_SIZE) {
  console.log(`📚 Review Memory: importing up to ${limit} merged PRs for ${owner}/${repo}`);
  let imported = 0;
  let skipped = 0;
  const errors = [];

  // Fetch merged PRs
  let mergedPRs;
  try {
    mergedPRs = await fetchMergedPRNumbers(owner, repo, limit);
  } catch (e) {
    throw new Error(`GraphQL fetch of merged PRs failed: ${e.message}`);
  }

  console.log(`  Found ${mergedPRs.length} merged PRs`);

  for (const pr of mergedPRs) {
    try {
      const threads = await fetchResolvedThreadsForPR(owner, repo, pr.number);
      const resolvedCount = threads.length;
      if (resolvedCount === 0) {
        skipped++;
        continue;
      }

      for (const thread of threads) {
        try {
          const incident = await extractAndEmbedIncident(owner, repo, thread);

          // Upsert: if same PR + file + line already stored, overwrite
          await Incident.findOneAndUpdate(
            { owner, repo, prNumber: incident.prNumber, filePath: incident.filePath, originalLine: incident.originalLine },
            incident,
            { upsert: true, new: true }
          );
          imported++;
          console.log(`  ✅ PR #${incident.prNumber} → ${incident.filePath}:${incident.originalLine} (${incident.embedding ? 'embedded' : 'text-index only'})`);
        } catch (threadErr) {
          errors.push(`PR #${pr.number} thread: ${threadErr.message}`);
        }
      }
    } catch (prErr) {
      errors.push(`PR #${pr.number}: ${prErr.message}`);
    }
  }

  console.log(`📚 Import complete: ${imported} incidents stored, ${skipped} PRs skipped (no resolved threads)`);
  return { imported, skipped, errors, total: mergedPRs.length };
}
