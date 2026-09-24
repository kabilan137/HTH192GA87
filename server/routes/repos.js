/**
 * GET /api/repos/:owner/:repo/pulls
 * Lists open pull requests for a GitHub repository.
 */

import { Router } from 'express';
import { listOpenPullRequests } from '../mcp/githubTools.js';

const router = Router();

router.get('/repos/:owner/:repo/pulls', async (req, res) => {
  const { owner, repo } = req.params;

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

export default router;
