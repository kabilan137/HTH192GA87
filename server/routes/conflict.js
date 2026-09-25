/**
 * POST /api/conflict-check
 *
 * Pipeline:
 *  1. Validate input (owner, repo, pullNumber)
 *  2. Fetch PR metadata + file list via MCP / REST
 *  3. For each changed file, fetch:
 *       - Base branch (main) content
 *       - PR branch (head) content
 *  4. Run ConflictAgent (Claude + LangChain structured output)
 *  5. Persist ConflictReport to MongoDB
 *  6. Return full report JSON
 *
 * GET /api/conflict-check/:id
 *  Returns a saved conflict report by ID.
 */

import { Router } from 'express';
import {
  getPullRequest,
  getPullRequestDiff,
  getPullRequestFiles,
  getFileContents,
  fetchPRDetailViaREST,
  fetchDiffViaREST,
  fetchPRFilesViaREST,
} from '../mcp/githubTools.js';
import { getMCPClient } from '../mcp/mcpClient.js';
import { runConflictAgent } from '../agents/conflictAgent.js';
import { ConflictReport } from '../models/ConflictReport.js';

const router = Router();

// ─── POST /api/conflict-check ─────────────────────────────────────────────────

router.post('/conflict-check', async (req, res) => {
  const { owner, repo, pullNumber } = req.body;

  if (!owner || !repo || !pullNumber) {
    return res.status(400).json({ error: 'owner, repo, and pullNumber are required' });
  }

  const prNum = parseInt(pullNumber, 10);
  if (isNaN(prNum)) {
    return res.status(400).json({ error: 'pullNumber must be a number' });
  }

  try {
    console.log(`\n🔀 Starting conflict check for ${owner}/${repo}#${prNum}`);

    // ── Step 1: Ensure MCP is initialised ─────────────────────────────────────
    try {
      await getMCPClient();
    } catch (mcpErr) {
      console.warn('⚠️  MCP init failed, using REST API fallback:', mcpErr.message);
    }

    // ── Step 2: Fetch PR metadata ──────────────────────────────────────────────
    let prDetail, diff, prFiles;

    try {
      prDetail = await getPullRequest(owner, repo, prNum);
    } catch {
      prDetail = await fetchPRDetailViaREST(owner, repo, prNum);
    }

    try {
      diff = await getPullRequestDiff(owner, repo, prNum);
    } catch {
      diff = await fetchDiffViaREST(owner, repo, prNum);
    }

    try {
      prFiles = await getPullRequestFiles(owner, repo, prNum);
    } catch {
      prFiles = await fetchPRFilesViaREST(owner, repo, prNum);
    }

    const prTitle   = prDetail?.title || `PR #${prNum}`;
    const headSha   = prDetail?.head?.sha;
    const baseBranch = prDetail?.base?.ref || 'main';
    const prUrl     = prDetail?.html_url;

    const changedFilenames = (prFiles || [])
      .map((f) => f.filename || f.path)
      .filter(Boolean);

    console.log(`📄 PR: "${prTitle}" | base: ${baseBranch} | ${changedFilenames.length} changed files`);

    // ── Step 3: Fetch file content from BOTH branches for each changed file ────
    const baseFiles = {};
    const prFiles_  = {};

    await Promise.all(
      changedFilenames.map(async (filename) => {
        // Base-branch content (the current state of main before PR merges)
        try {
          const content = await getFileContents(owner, repo, filename, baseBranch);
          if (content) baseFiles[filename] = content;
        } catch (e) {
          console.warn(`⚠️  Could not fetch base content for ${filename}: ${e.message}`);
        }

        // PR-branch content (what the PR proposes)
        try {
          const content = await getFileContents(owner, repo, filename, headSha || 'HEAD');
          if (content) prFiles_[filename] = content;
        } catch (e) {
          console.warn(`⚠️  Could not fetch PR content for ${filename}: ${e.message}`);
        }
      })
    );

    console.log(
      `📦 Fetched content: ${Object.keys(baseFiles).length} base files, ${Object.keys(prFiles_).length} PR files`
    );

    // ── Step 4: Run Conflict Agent ─────────────────────────────────────────────
    const agentResult = await runConflictAgent({
      owner,
      repo,
      pullNumber: prNum,
      prTitle,
      diff: diff || '',
      changedFiles: changedFilenames,
      baseFiles,
      prFiles: prFiles_,
      isMergeable: prDetail?.mergeable,
      mergeableState: prDetail?.mergeable_state,
    });

    const conflictingCount = agentResult.conflicts.filter((c) => c.mergeConflict).length;

    console.log(`\n📊 Conflict Summary:`);
    console.log(`   Overall Conflict: ${agentResult.overallConflictDetected}`);
    console.log(`   Conflicting Files: ${conflictingCount}/${changedFilenames.length}`);

    // ── Step 5: Persist to MongoDB ─────────────────────────────────────────────
    const conflictReport = new ConflictReport({
      owner,
      repo,
      pullNumber: prNum,
      prTitle,
      prUrl,
      overallConflictDetected: agentResult.overallConflictDetected,
      conflicts: agentResult.conflicts,
      summary: agentResult.summary,
      totalFilesAnalyzed: changedFilenames.length,
      conflictingFilesCount: conflictingCount,
      status: 'complete',
    });

    await conflictReport.save();
    console.log(`✅ Conflict report saved: ${conflictReport._id}`);

    // ── Step 6: Return ────────────────────────────────────────────────────────
    res.json({
      reportId: conflictReport._id,
      report: conflictReport.toObject(),
    });
  } catch (e) {
    console.error('❌ Conflict check pipeline error:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ─── GET /api/conflict-check/:id ─────────────────────────────────────────────

router.get('/conflict-check/:id', async (req, res) => {
  try {
    const report = await ConflictReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: 'Conflict report not found' });
    res.json({ report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
