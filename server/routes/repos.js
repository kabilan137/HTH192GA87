/**
 * GET /api/repos/:owner/:repo/pulls
 * Lists open pull requests for a GitHub repository.
 *
 * GET /api/repos/:owner/:repo/commits
 * Lists recent commits — used to prove MCP connectivity when no PRs exist.
 */

import { Router } from 'express';
import { listOpenPullRequests, listCommits } from '../mcp/githubTools.js';
import { isMCPAvailable } from '../mcp/mcpClient.js';

const router = Router();

router.get('/repos/:owner/:repo/pulls', async (req, res) => {
  const { owner } = req.params;
  const repo = req.params.repo.replace(/\.git$/, ''); // strip .git suffix if present

  try {
    console.log(`📋 Fetching open PRs for ${owner}/${repo}`);
    const prs = await listOpenPullRequests(owner, repo);

    // Normalize PR data
    const normalized = prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      user: pr.user?.login || 'unknown',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
      draft: pr.draft || false,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      headRef: pr.head?.ref,
      baseRef: pr.base?.ref,
    }));

    res.json({ prs: normalized, count: normalized.length });
  } catch (e) {
    console.error(`❌ Failed to list PRs: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/repos/:owner/:repo/commits
 * Fetches commit history via MCP (falls back to REST).
 * Used when a repo has no open PRs to prove the MCP pipeline is working.
 */
router.get('/repos/:owner/:repo/commits', async (req, res) => {
  const { owner } = req.params;
  const repo = req.params.repo.replace(/\.git$/, ''); // strip .git suffix if present
  const perPage = Math.min(parseInt(req.query.per_page || '20', 10), 50);

  try {
    console.log(`📜 Fetching commit history for ${owner}/${repo} via MCP`);
    const raw = await listCommits(owner, repo, { perPage });
    const mcpUsed = isMCPAvailable();

    const normalized = raw.map((c) => ({
      sha: c.sha,
      shortSha: c.sha?.slice(0, 7),
      message: c.commit?.message?.split('\n')[0] || '',
      author: c.commit?.author?.name || c.author?.login || 'unknown',
      authorLogin: c.author?.login || null,
      authorAvatar: c.author?.avatar_url || null,
      date: c.commit?.author?.date,
      url: c.html_url,
    }));

    console.log(`✅ Returned ${normalized.length} commits (MCP: ${mcpUsed})`);
    res.json({
      commits: normalized,
      count: normalized.length,
      source: mcpUsed ? 'mcp' : 'rest',
      mcpActive: mcpUsed,
    });
  } catch (e) {
    console.error(`❌ Failed to fetch commits: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

export default router;
