/**
 * Review Memory — Retrieval + Grounded Fix Generation (Steps 29–31)
 *
 * Step 29: cosineSimilarity + findSimilarIncidents (pure functions)
 * Step 30: retrieveMatchesForHunks (wires into analyze pipeline)
 * Step 31: generateGroundedFix (LLM pass with precedent context)
 * Step G:  reviewMemoryIssuesToIssues (schema + FPR handling)
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { Incident } from '../models/Incident.js';
import { getEmbedding } from './reviewMemory.js';
import { randomUUID } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

export const SIMILARITY_THRESHOLD = 0.82; // named constant — tune this during demo
export const MAX_MATCHES_PER_HUNK = 3;
export const CONTEXT_LINES = 5; // lines of context to extract around each changed hunk

// ─── Step 29: Pure similarity functions ──────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 * Returns value in [-1, 1]. 1.0 = identical direction.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find incidents similar to hunkEmbedding above SIMILARITY_THRESHOLD.
 * Scope: incidents from this repo only (never cross-repo).
 *
 * @param {number[]} hunkEmbedding - Embedding of the current code hunk
 * @param {Array}    repoIncidents - All Incident docs for this repo (already fetched)
 * @param {number}   threshold     - Minimum cosine similarity to include
 * @returns {Array}  Sorted matches: [{ incident, similarity }], capped at MAX_MATCHES_PER_HUNK
 */
export function findSimilarIncidents(
  hunkEmbedding,
  repoIncidents,
  threshold = SIMILARITY_THRESHOLD
) {
  const matches = [];
  for (const incident of repoIncidents) {
    if (!incident.embedding || incident.embedding.length === 0) continue;
    const sim = cosineSimilarity(hunkEmbedding, incident.embedding);
    if (sim >= threshold) {
      matches.push({ incident, similarity: sim });
    }
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, MAX_MATCHES_PER_HUNK);
}

// ─── Text-index fallback similarity (when no embeddings) ─────────────────────

/**
 * MongoDB $text search fallback — used when incident has no embedding vector.
 * Returns matched incidents scored by MongoDB's text score.
 */
async function textIndexFallbackSearch(owner, repo, hunkText, limit = MAX_MATCHES_PER_HUNK) {
  try {
    // Extract keywords: alphanumeric words >= 3 chars
    const keywords = hunkText
      .replace(/[^a-zA-Z0-9_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['true', 'false', 'return', 'function', 'const', 'let', 'var'].includes(w.toLowerCase()))
      .slice(0, 15)
      .join(' ');

    if (!keywords.trim()) return [];

    const results = await Incident.find(
      { owner, repo, $text: { $search: keywords } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();

    return results.map((doc) => ({
      incident: doc,
      similarity: Math.min(0.95, Math.max(SIMILARITY_THRESHOLD, (doc.score || 1) / 2.5)),
    }));
  } catch (err) {
    console.warn(`⚠️  textIndexFallbackSearch: ${err.message}`);
    return [];
  }
}

// ─── Step 30: Extract hunks from PR files ────────────────────────────────────

/**
 * Extract "problem-side" text from a PR file for embedding.
 * Retains hunk headers and unified diff lines.
 */
export function extractHunkTexts(prFile) {
  const patch = prFile.patch || '';
  if (!patch) return [];

  const hunkRegex = /(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@[\s\S]*?)(?=(?:@@\s+-\d+)|$)/g;
  const hunks = [];
  let match;
  while ((match = hunkRegex.exec(patch)) !== null) {
    const text = match[1].trim();
    if (text) hunks.push(text.slice(0, 2000));
  }
  if (hunks.length === 0 && patch.trim()) {
    hunks.push(patch.trim().slice(0, 2000));
  }
  return hunks;
}

// ─── Step 31: LLM grounded fix generation ────────────────────────────────────

const GroundedFixSchema = z.object({
  fixes: z.array(
    z.object({
      matchedIncidentId: z.string(),
      explanation: z.string().describe(
        'One-paragraph explanation naming the precedent PR and reviewer, explaining the pattern, and how to fix the current code.'
      ),
      suggestedFix: z.string().describe(
        'Concrete code-level fix for the CURRENT code, following the same resolution pattern as the precedent — not a verbatim copy.'
      ),
    })
  ),
});

let _groundedFixChain = null;

function getGroundedFixChain() {
  if (_groundedFixChain) return _groundedFixChain;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const model = new ChatOpenAI({
    model: 'anthropic/claude-sonnet-5',
    apiKey,
    temperature: 0.1,
    maxTokens: 1000,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'CodeGuard AI' },
    },
  });

  _groundedFixChain = model.withStructuredOutput(GroundedFixSchema, {
    name: 'grounded_fix',
  });
  return _groundedFixChain;
}

async function generateGroundedFix(currentHunkText, matches, filePath) {
  if (matches.length === 0) return [];

  const matchContext = matches.map(({ incident, similarity }) => `
--- PRECEDENT (ID: ${incident._id || incident.id}) ---
From PR #${incident.prNumber} ("${incident.prTitle || ''}")
File: ${incident.filePath}
Reviewer @${incident.reviewerLogin} flagged this code:
${incident.problemSnippet}

Reviewer's comment:
${incident.reviewerComment}

How it was resolved (file at merge commit, lines around the fix):
${incident.resolutionSnippet || '(resolution snippet not available)'}

Similarity score: ${(similarity * 100).toFixed(1)}%
`).join('\n\n');

  const prompt = `You are CodeGuard AI's Review Memory analyst.

A new code change in "${filePath}" resembles patterns that were previously flagged and resolved in this team's PR history.

CURRENT CODE CHANGE (the hunk under review now):
${currentHunkText.slice(0, 1500)}

MATCHED HISTORICAL PRECEDENTS:
${matchContext}

For EACH precedent (identified by its ID), generate:
1. An explanation that explicitly names the precedent: "This matches a pattern flagged by @reviewer in PR #N and fixed by [resolution approach] — applying the same approach here: [specific recommendation for current code]."
2. A suggested fix for the CURRENT code that follows the same resolution PATTERN — not a verbatim copy of the old fix, and not a generic suggestion.

The fix should be specific to the current code, not the historical code.`;

  try {
    const chain = getGroundedFixChain();
    const result = await chain.invoke([
      new SystemMessage('You are a precise code reviewer with institutional memory. Reference specific PRs and reviewers. Return structured JSON.'),
      new HumanMessage(prompt),
    ]);
    return result.fixes || [];
  } catch (e) {
    console.warn(`⚠️  Grounded fix LLM call failed: ${e.message}`);
    // Fallback: synthesize from incident data directly
    return matches.map(({ incident, similarity }) => ({
      matchedIncidentId: String(incident._id || incident.id),
      explanation: `This matches a pattern flagged by @${incident.reviewerLogin} in PR #${incident.prNumber} — "${incident.reviewerComment.slice(0, 120)}...". Similarity: ${(similarity * 100).toFixed(1)}%.`,
      suggestedFix: `Review and apply the same resolution approach used in PR #${incident.prNumber}. Original fix context:\n\n${incident.resolutionSnippet || '(not available)'}`,
    }));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Step D+E+F: Main retrieval pipeline — runs inside the existing analyze pipeline.
 *
 * For each changed file, embed its hunks, find similar incidents, generate grounded fixes.
 * Returns raw "memory match" records — call reviewMemoryIssuesToIssues() to convert.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Array}  reviewedPRFiles  - GitHub file objects with .filename, .patch
 * @returns {Promise<Array>} memory match records
 */
export async function retrieveReviewMemoryMatches({ owner, repo, reviewedPRFiles }) {
  // Fetch ALL incidents for this repo once (brute-force cosine over hackathon-scale data)
  const repoIncidents = await Incident.find({ owner, repo }).lean();

  if (repoIncidents.length === 0) {
    console.log('📚 Review Memory: no incidents stored for this repo — skipping retrieval');
    return [];
  }

  const hasEmbeddings = repoIncidents.some((i) => i.embedding && i.embedding.length > 0);
  console.log(`📚 Review Memory: ${repoIncidents.length} incidents for ${owner}/${repo} (${hasEmbeddings ? 'vector search' : 'text-index fallback'})`);

  const allMatches = [];

  for (const prFile of (reviewedPRFiles || [])) {
    const hunks = extractHunkTexts(prFile);
    if (hunks.length === 0) continue;

    for (const hunkText of hunks) {
      let matches = [];

      if (hasEmbeddings) {
        const hunkEmbedding = await getEmbedding(hunkText);
        if (hunkEmbedding) {
          matches = findSimilarIncidents(hunkEmbedding, repoIncidents);
        } else {
          matches = await textIndexFallbackSearch(owner, repo, hunkText);
        }
      } else {
        matches = await textIndexFallbackSearch(owner, repo, hunkText);
      }

      if (matches.length === 0) continue;

      console.log(`   📚 ${prFile.filename}: ${matches.length} memory match(es)`);

      // Generate grounded fixes via LLM
      const fixes = await generateGroundedFix(hunkText, matches, prFile.filename);

      for (let i = 0; i < matches.length; i++) {
        const { incident, similarity } = matches[i];
        const fix = fixes.find((f) => f.matchedIncidentId === String(incident._id)) || fixes[i] || null;

        allMatches.push({
          id: randomUUID().slice(0, 8),
          file: prFile.filename,
          hunkText,
          incident,
          similarity,
          explanation: fix?.explanation || `Matches pattern from PR #${incident.prNumber} by @${incident.reviewerLogin} (${(similarity * 100).toFixed(1)}% similarity).`,
          suggestedFix: fix?.suggestedFix || `Apply the same resolution used in PR #${incident.prNumber}.`,
        });
      }
    }
  }

  console.log(`📚 Review Memory: ${allMatches.length} total match(es) found`);
  return allMatches;
}

/**
 * Step G: Convert memory match records into issues for the report schema.
 *
 * source = 'review-history-match' — IS counted in FPR (probabilistic similarity, not deterministic).
 */
export function reviewMemoryIssuesToIssues(matches) {
  return matches.map((m) => ({
    id: m.id,
    file: m.file,
    line: m.incident.originalLine || 1,
    category: 'Known Pattern - Previously Flagged',
    severity: 'medium', // heuristic match — not a confirmed bug
    confidence: Math.round(m.similarity * 100) / 100, // e.g. 0.87
    source: 'review-history-match', // COUNTED in FPR — probabilistic, not deterministic
    explanation: m.explanation,
    suggestedFix: m.suggestedFix,
    // Memory-specific fields
    matchedIncidentId: String(m.incident._id),
    matchedPrNumber: m.incident.prNumber,
    matchedReviewerLogin: m.incident.reviewerLogin,
    similarityScore: m.similarity,
  }));
}
