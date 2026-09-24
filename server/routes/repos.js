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

/**
 * GET /api/repos/:owner/:repo/branches
 * Lists branches for the branch selector (active-only: pushed within 30 days).
 */
router.get('/repos/:owner/:repo/branches', async (req, res) => {
  const { owner } = req.params;
  const repo = req.params.repo.replace(/\.git$/, '');

  try {
    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const branches = [];
    let page = 1;
    while (true) {
      const r = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (!r.ok) throw new Error(`GitHub branches → ${r.status}`);
      const page_data = await r.json();
      branches.push(...page_data);
      if (page_data.length < 100) break;
      page++;
    }

    const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - LOOKBACK_MS;

    const normalized = branches
      .filter((b) => {
        const date = b.commit?.commit?.committer?.date || b.commit?.commit?.author?.date;
        return date ? new Date(date).getTime() >= cutoff : true;
      })
      .map((b) => ({
        name: b.name,
        sha: b.commit?.sha,
        lastPushedAt: b.commit?.commit?.committer?.date || b.commit?.commit?.author?.date,
        isProtected: b.protected || false,
      }));

    res.json({ branches: normalized, count: normalized.length });
  } catch (e) {
    console.error(`❌ Failed to list branches: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

export default router;

