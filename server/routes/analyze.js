/**
 * POST /api/analyze
 * Full agentic pipeline: MCP → ESLint + ConcurrentRisk (parallel) → LLM → merge → save → return report
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
import { runESLintOnFiles } from '../staticAnalysis/eslintRunner.js';
import { runCodeReviewAgent } from '../agents/reviewAgent.js';
import { detectConcurrentModificationRisk, collisionsToIssues } from '../agents/concurrentRisk.js';
import { computeReportData } from '../agents/mergeAndScore.js';
import { Report } from '../models/Report.js';

const router = Router();

router.post('/analyze', async (req, res) => {
  const { owner, repo, pullNumber } = req.body;

  if (!owner || !repo || !pullNumber) {
    return res.status(400).json({ error: 'owner, repo, and pullNumber are required' });
  }

  const prNum = parseInt(pullNumber, 10);
  if (isNaN(prNum)) {
    return res.status(400).json({ error: 'pullNumber must be a number' });
  }

  try {
    console.log(`\n🔍 Starting analysis for ${owner}/${repo}#${prNum}`);

    // ── Step 4a: Initialize MCP and fetch PR data ─────────────────────────
    let prDetail, diff, prFiles;

    try {
      await getMCPClient(); // ensure MCP is ready (no-op if unavailable)
    } catch (mcpErr) {
      console.warn('⚠️  MCP init failed, using REST API fallback:', mcpErr.message);
    }

    try {
      prDetail = await getPullRequest(owner, repo, prNum);
    } catch (e) {
      console.warn('PR detail via MCP failed, using REST:', e.message);
      prDetail = await fetchPRDetailViaREST(owner, repo, prNum);
    }

    try {
      diff = await getPullRequestDiff(owner, repo, prNum);
    } catch (e) {
      console.warn('Diff via MCP failed, using REST:', e.message);
      diff = await fetchDiffViaREST(owner, repo, prNum);
    }

    try {
      prFiles = await getPullRequestFiles(owner, repo, prNum);
    } catch (e) {
      console.warn('PR files via MCP failed, using REST:', e.message);
      prFiles = await fetchPRFilesViaREST(owner, repo, prNum);
    }

    const prTitle  = prDetail?.title || `PR #${prNum}`;
    const headSha  = prDetail?.head?.sha;

    console.log(`📄 PR: "${prTitle}" | ${prFiles.length} changed files`);

    // ── Step 4a cont: Fetch full content of each changed JS file ──────────
    const jsFiles = (prFiles || []).filter((f) =>
      /\.(js|jsx|mjs|cjs)$/i.test(f.filename || f.path || '')
    );

    const nonJsCount = (prFiles?.length || 0) - jsFiles.length;
    console.log(
      `📁 ${jsFiles.length} JS file(s) to analyze${nonJsCount > 0 ? ` (${nonJsCount} non-JS files skipped by static analysis)` : ''}`
    );

    const fileContents = {};
    const fileContentArray = [];

    await Promise.all(
      jsFiles.map(async (f) => {
        const filename = f.filename || f.path;
        try {
          const content = await getFileContents(owner, repo, filename, headSha);
          if (content) {
            fileContents[filename] = content;
            fileContentArray.push({ filename, content });
          }
        } catch (e) {
          console.warn(`⚠️  Could not fetch content of ${filename}: ${e.message}`);
        }
      })
    );

    // ── Step 4b: Run ESLint + Concurrent Risk check IN PARALLEL ───────────
    console.log('🔧 Running ESLint static analysis + concurrent risk check (parallel)...');

    const [eslintFindings, collisions] = await Promise.all([
      // ESLint — synchronous, wrapped in promise to run in parallel with concurrent risk
      Promise.resolve(runESLintOnFiles(fileContentArray)),

      // Concurrent Modification Risk — async, runs fully in parallel
      detectConcurrentModificationRisk({
        owner,
        repo,
        pullNumber: prNum,
        prTitle,
        reviewedPRFiles: prFiles,   // full file objects with .patch from GitHub API
        diff: diff || '',
      }),
    ]);

    console.log(`✅ ESLint: ${eslintFindings.length} finding(s)`);

    // Convert collisions into issues shaped for the report
    const concurrentIssues = collisionsToIssues(collisions);

    // ── Step 4c–d: LLM Review ─────────────────────────────────────────────
    const llmResult = await runCodeReviewAgent({
      owner,
      repo,
      pullNumber: prNum,
      prTitle,
      diff: diff || '',
      fileContents,
      eslintFindings,
    });

    const llmIssues = llmResult.issues || [];

    // ── Step 4e–f: Merge, score, and compute report data ──────────────────
    // concurrentIssues are passed separately — excluded from FPR calc
    const reportData = computeReportData(eslintFindings, llmIssues, concurrentIssues);

    console.log(`\n📊 Report Summary:`);
    console.log(`   Risk Score: ${reportData.riskScore}/100`);
    console.log(`   Total Issues: ${reportData.totalIssues}`);
    console.log(`   False Positive Rate: ${reportData.falsePositiveRate}%`);
    console.log(`   Concurrent Modifications: ${reportData.concurrentModificationCount}`);
    console.log(`   Top 3 Issues: ${reportData.topThreeIssueIds.join(', ')}`);

    // ── Step 4g: Persist to MongoDB ───────────────────────────────────────
    const report = new Report({
      owner,
      repo,
      pullNumber: prNum,
      prTitle,
      prUrl: prDetail?.html_url,
      riskScore:           reportData.riskScore,
      falsePositiveRate:   reportData.falsePositiveRate,
      issues:              reportData.issues,
      topThreeIssueIds:    reportData.topThreeIssueIds,
      totalIssues:         reportData.totalIssues,
      staticIssuesCount:   reportData.staticIssuesCount,
      llmIssuesCount:      reportData.llmIssuesCount,
      combinedIssuesCount: reportData.combinedIssuesCount,
      concurrentModificationCount: reportData.concurrentModificationCount,
      analyzedFiles: jsFiles.map((f) => f.filename || f.path),
      status: 'complete',
    });

    await report.save();
    console.log(`✅ Report saved: ${report._id}`);

    res.json({
      reportId:   report._id,
      report:     report.toObject(),
      llmSummary: llmResult.summary || '',
      jsOnlyNote: nonJsCount > 0
        ? `⚠️  Note: ${nonJsCount} non-JavaScript file(s) were skipped. Static analysis is JS-only in this prototype.`
        : null,
      concurrentRiskNote: reportData.concurrentModificationCount > 0
        ? `⚠️  ${reportData.concurrentModificationCount} concurrent modification risk(s) detected in sibling open PRs.`
        : null,
    });
  } catch (e) {
    console.error('❌ Analysis pipeline error:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
