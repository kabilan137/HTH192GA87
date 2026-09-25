/**
 * POST /api/analyze
 *
 * Accepts:
 *   { owner, repo, pullNumber }  — analyze a specific PR
 *   { owner, repo, branch }      — analyze a branch directly (no PR required)
 *
 * Full agentic pipeline: GitHub data → ESLint + ConcurrentRisk (parallel) → LLM → merge → save → return
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
import { retrieveReviewMemoryMatches, reviewMemoryIssuesToIssues } from '../agents/reviewRetrieval.js';
import { trackFeatureRequirements } from '../agents/featureCoverage.js';
import { computeReportData } from '../agents/mergeAndScore.js';
import { Report } from '../models/Report.js';

const router = Router();

// ─── Helper: get default branch for repo ─────────────────────────────────────

async function getDefaultBranch(owner, repo) {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`Could not fetch repo metadata: ${res.status}`);
  const data = await res.json();
  return data.default_branch || 'main';
}

// ─── Helper: fetch branch diff via compare endpoint ───────────────────────────

async function fetchBranchDiffAndFiles(owner, repo, baseBranch, headBranch) {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseBranch}...${headBranch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Compare ${baseBranch}...${headBranch} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  // files[] from compare has same shape as PR files: { filename, patch, status, ... }
  const files = data.files || [];
  // Build a unified diff string from patches
  const diff = files
    .filter((f) => f.patch)
    .map((f) => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
    .join('\n\n');
  return { files, diff, aheadBy: data.ahead_by };
}

// ─── Helper: fetch file content from a specific ref ──────────────────────────

async function fetchFileContentsForBranch(owner, repo, files, ref) {
  const jsFiles = (files || []).filter((f) =>
    /\.(js|jsx|mjs|cjs)$/i.test(f.filename || '')
  );
  const fileContents = {};
  const fileContentArray = [];
  await Promise.all(
    jsFiles.map(async (f) => {
      const filename = f.filename;
      try {
        const content = await getFileContents(owner, repo, filename, ref);
        if (content) {
          fileContents[filename] = content;
          fileContentArray.push({ filename, content });
        }
      } catch (e) {
        console.warn(`⚠️  Could not fetch content of ${filename}: ${e.message}`);
      }
    })
  );
  return { jsFiles, fileContents, fileContentArray };
}

// ─── Main route ───────────────────────────────────────────────────────────────

router.post('/analyze', async (req, res) => {
  const { owner, repo, pullNumber, branch, featureId } = req.body;

  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo are required' });
  }
  if (!pullNumber && !branch) {
    return res.status(400).json({ error: 'Either pullNumber or branch is required' });
  }

  const isBranchMode = !pullNumber && !!branch;
  const prNum = pullNumber ? parseInt(pullNumber, 10) : null;
  if (!isBranchMode && isNaN(prNum)) {
    return res.status(400).json({ error: 'pullNumber must be a number' });
  }

  try {
    // ── Initialize MCP (best effort) ─────────────────────────────────────────
    try {
      await getMCPClient();
    } catch (mcpErr) {
      console.warn('⚠️  MCP init failed, using REST API fallback:', mcpErr.message);
    }

    let prDetail, diff, prFiles, reviewedBranch, baseBranch, headSha, prTitle, nonJsCount;

    if (isBranchMode) {
      // ── BRANCH MODE: no PR required ────────────────────────────────────────
      console.log(`\n🔍 Starting branch analysis for ${owner}/${repo}@${branch}`);

      baseBranch = await getDefaultBranch(owner, repo);
      reviewedBranch = branch;

      const compareResult = await fetchBranchDiffAndFiles(owner, repo, baseBranch, branch);
      prFiles = compareResult.files;
      diff = compareResult.diff;
      headSha = null; // branch tip — we'll use branch name for file fetching

      prTitle = `branch: ${branch}`;
      prDetail = null;

      console.log(`📄 Branch "${branch}" (${compareResult.aheadBy} commits ahead of ${baseBranch}) | ${prFiles.length} changed files`);

      const jsFileObjs = prFiles.filter((f) =>
        /\.(js|jsx|mjs|cjs)$/i.test(f.filename || '')
      );
      nonJsCount = prFiles.length - jsFileObjs.length;

      const fileContents = {};
      const fileContentArray = [];
      await Promise.all(
        jsFileObjs.map(async (f) => {
          try {
            // Use branch name as the ref for file content fetch
            const content = await getFileContents(owner, repo, f.filename, branch);
            if (content) {
              fileContents[f.filename] = content;
              fileContentArray.push({ filename: f.filename, content });
            }
          } catch (e) {
            console.warn(`⚠️  Could not fetch ${f.filename}: ${e.message}`);
          }
        })
      );

      // ── ESLint + ConcurrentRisk + ReviewMemory in parallel ──────────────
      console.log('🔧 Running ESLint + concurrent risk check + review memory retrieval (parallel)...');
      const [eslintFindings, collisions, rawMemoryMatches] = await Promise.all([
        Promise.resolve(runESLintOnFiles(fileContentArray)),
        detectConcurrentModificationRisk({
          owner,
          repo,
          reviewedBranch: branch,
          baseBranch,
          prTitle,
          reviewedPRFiles: prFiles,
          diff,
        }),
        retrieveReviewMemoryMatches({
          owner,
          repo,
          reviewedPRFiles: prFiles,
        }),
      ]);

      console.log(`✅ ESLint: ${eslintFindings.length} finding(s)`);
      const concurrentIssues = collisionsToIssues(collisions);
      const reviewMemoryIssues = reviewMemoryIssuesToIssues(rawMemoryMatches);
      console.log(`✅ Review Memory: ${reviewMemoryIssues.length} issue(s) generated`);

      // ── LLM Review ───────────────────────────────────────────────────────
      const llmResult = await runCodeReviewAgent({
        owner,
        repo,
        pullNumber: null,
        prTitle,
        diff: diff || '',
        fileContents,
        eslintFindings,
      });

      const llmIssues = llmResult.issues || [];
      const reportData = computeReportData(eslintFindings, llmIssues, concurrentIssues, reviewMemoryIssues);

      console.log(`\n📊 Report Summary (branch mode):`);
      console.log(`   Risk Score: ${reportData.riskScore}/100`);
      console.log(`   Total Issues: ${reportData.totalIssues}`);
      console.log(`   Concurrent Modifications: ${reportData.concurrentModificationCount}`);
      console.log(`   Review Memory Precedents: ${reportData.reviewMemoryCount}`);

      const report = new Report({
        owner,
        repo,
        pullNumber: null,
        prTitle,
        prUrl: null,
        riskScore: reportData.riskScore,
        falsePositiveRate: reportData.falsePositiveRate,
        issues: reportData.issues,
        topThreeIssueIds: reportData.topThreeIssueIds,
        totalIssues: reportData.totalIssues,
        staticIssuesCount: reportData.staticIssuesCount,
        llmIssuesCount: reportData.llmIssuesCount,
        combinedIssuesCount: reportData.combinedIssuesCount,
        concurrentModificationCount: reportData.concurrentModificationCount,
        reviewMemoryCount: reportData.reviewMemoryCount,
        analyzedFiles: jsFileObjs.map((f) => f.filename),
        status: 'complete',
      });
      await report.save();
      console.log(`✅ Report saved: ${report._id}`);

      // ── Step D & E: Feature Requirement Tracking (optional) ───────────────
      let featureSnapshot = null;
      if (featureId) {
        console.log(`📋 Running Feature Requirement Tracking for featureId: ${featureId}...`);
        try {
          featureSnapshot = await trackFeatureRequirements({
            featureId,
            triggeredByPr: `branch: ${branch}`,
            cumulativeDiff: diff || '',
          });
        } catch (feErr) {
          console.warn(`⚠️  Feature requirement tracking error: ${feErr.message}`);
        }
      }

      return res.json({
        reportId: report._id,
        report: report.toObject(),
        featureSnapshot: featureSnapshot ? featureSnapshot.toObject() : null,
        llmSummary: llmResult.summary || '',
        jsOnlyNote: nonJsCount > 0
          ? `⚠️  Note: ${nonJsCount} non-JavaScript file(s) were skipped. Static analysis is JS-only in this prototype.`
          : null,
        concurrentRiskNote: reportData.concurrentModificationCount > 0
          ? `⚠️  ${reportData.concurrentModificationCount} concurrent modification risk(s) detected across active branches in this repo.`
          : null,
        reviewMemoryNote: reportData.reviewMemoryCount > 0
          ? `💡 ${reportData.reviewMemoryCount} known issue pattern(s) matched against historical resolved PR reviews.`
          : null,
      });

    } else {
      // ── PR MODE: existing pullNumber path ─────────────────────────────────
      console.log(`\n🔍 Starting analysis for ${owner}/${repo}#${prNum}`);

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

      prTitle = prDetail?.title || `PR #${prNum}`;
      headSha = prDetail?.head?.sha;
      reviewedBranch = prDetail?.head?.ref || `pr-${prNum}`;
      baseBranch = prDetail?.base?.ref || await getDefaultBranch(owner, repo);

      console.log(`📄 PR: "${prTitle}" | ${prFiles.length} changed files`);

      const jsFiles = (prFiles || []).filter((f) =>
        /\.(js|jsx|mjs|cjs)$/i.test(f.filename || f.path || '')
      );
      nonJsCount = (prFiles?.length || 0) - jsFiles.length;
      console.log(
        `📁 ${jsFiles.length} JS file(s) to analyze${nonJsCount > 0 ? ` (${nonJsCount} non-JS files skipped)` : ''}`
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

      // ── ESLint + ConcurrentRisk + ReviewMemory in parallel ──────────────
      console.log('🔧 Running ESLint static analysis + concurrent risk check + review memory retrieval (parallel)...');
      const [eslintFindings, collisions, rawMemoryMatches] = await Promise.all([
        Promise.resolve(runESLintOnFiles(fileContentArray)),
        detectConcurrentModificationRisk({
          owner,
          repo,
          reviewedBranch,
          baseBranch,
          prTitle,
          reviewedPRFiles: prFiles,
          diff: diff || '',
        }),
        retrieveReviewMemoryMatches({
          owner,
          repo,
          reviewedPRFiles: prFiles,
        }),
      ]);

      console.log(`✅ ESLint: ${eslintFindings.length} finding(s)`);
      const concurrentIssues = collisionsToIssues(collisions);
      const reviewMemoryIssues = reviewMemoryIssuesToIssues(rawMemoryMatches);
      console.log(`✅ Review Memory: ${reviewMemoryIssues.length} issue(s) generated`);

      // ── LLM Review ───────────────────────────────────────────────────────
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
      const reportData = computeReportData(eslintFindings, llmIssues, concurrentIssues, reviewMemoryIssues);

      console.log(`\n📊 Report Summary:`);
      console.log(`   Risk Score: ${reportData.riskScore}/100`);
      console.log(`   Total Issues: ${reportData.totalIssues}`);
      console.log(`   False Positive Rate: ${reportData.falsePositiveRate}%`);
      console.log(`   Concurrent Modifications: ${reportData.concurrentModificationCount}`);
      console.log(`   Review Memory Precedents: ${reportData.reviewMemoryCount}`);
      console.log(`   Top 3 Issues: ${reportData.topThreeIssueIds.join(', ')}`);

      const report = new Report({
        owner,
        repo,
        pullNumber: prNum,
        prTitle,
        prUrl: prDetail?.html_url,
        riskScore: reportData.riskScore,
        falsePositiveRate: reportData.falsePositiveRate,
        issues: reportData.issues,
        topThreeIssueIds: reportData.topThreeIssueIds,
        totalIssues: reportData.totalIssues,
        staticIssuesCount: reportData.staticIssuesCount,
        llmIssuesCount: reportData.llmIssuesCount,
        combinedIssuesCount: reportData.combinedIssuesCount,
        concurrentModificationCount: reportData.concurrentModificationCount,
        reviewMemoryCount: reportData.reviewMemoryCount,
        analyzedFiles: jsFiles.map((f) => f.filename || f.path),
        status: 'complete',
      });

      await report.save();
      console.log(`✅ Report saved: ${report._id}`);

      // ── Step D & E: Feature Requirement Tracking (optional) ───────────────
      let featureSnapshot = null;
      if (featureId) {
        console.log(`📋 Running Feature Requirement Tracking for featureId: ${featureId}...`);
        try {
          featureSnapshot = await trackFeatureRequirements({
            featureId,
            triggeredByPr: `PR #${prNum}`,
            cumulativeDiff: diff || '',
          });
        } catch (feErr) {
          console.warn(`⚠️  Feature requirement tracking error: ${feErr.message}`);
        }
      }

      return res.json({
        reportId: report._id,
        report: report.toObject(),
        featureSnapshot: featureSnapshot ? featureSnapshot.toObject() : null,
        llmSummary: llmResult.summary || '',
        jsOnlyNote: nonJsCount > 0
          ? `⚠️  Note: ${nonJsCount} non-JavaScript file(s) were skipped. Static analysis is JS-only in this prototype.`
          : null,
        concurrentRiskNote: reportData.concurrentModificationCount > 0
          ? `⚠️  ${reportData.concurrentModificationCount} concurrent modification risk(s) detected in active sibling branches.`
          : null,
        reviewMemoryNote: reportData.reviewMemoryCount > 0
          ? `💡 ${reportData.reviewMemoryCount} known issue pattern(s) matched against historical resolved PR reviews.`
          : null,
      });
    }

  } catch (e) {
    console.error('❌ Analysis pipeline error:', e);
    res.status(500).json({
      error: e.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: e.stack }),
    });
  }
});

export default router;
