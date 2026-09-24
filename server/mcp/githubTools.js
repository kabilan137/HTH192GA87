/**
 * GitHub MCP Tool Wrappers
 *
 * These wrappers use the actual tool names discovered at runtime from the MCP server.
 * They adapt the dynamic tool list to a stable API used by the rest of the app.
 */

import { getMCPClient, callMCPTool, getToolMap, findTool } from './mcpClient.js';

// Ensure MCP is initialized before any call
async function ensureInit() {
  await getMCPClient();
}

/**
 * List open pull requests for a repo.
 */
export async function listOpenPullRequests(owner, repo) {
  await ensureInit();
  const toolMap = getToolMap();

  // Try to find the list_pull_requests tool (or equivalent)
  const toolName = Object.keys(toolMap).find(
    (k) => k.includes('list_pull_requests') || k.includes('list_prs')
  );

  if (!toolName) {
    // Fallback: use GitHub REST API directly
    return await fetchPRsViaREST(owner, repo);
  }

  const result = await callMCPTool(toolName, {
    owner,
    repo,
    state: 'open',
  });

  // Normalize to array of PR objects
  if (Array.isArray(result)) return result;
  if (result?.data) return result.data;
  return [];
}

/**
 * Get details of a specific pull request.
 */
export async function getPullRequest(owner, repo, pullNumber) {
  await ensureInit();
  const toolMap = getToolMap();

  const toolName = Object.keys(toolMap).find(
    (k) =>
      (k.includes('get_pull_request') || k.includes('get_pr')) &&
      !k.includes('diff') &&
      !k.includes('file') &&
      !k.includes('review') &&
      !k.includes('comment')
  );

  if (!toolName) {
    return await fetchPRDetailViaREST(owner, repo, pullNumber);
  }

  const result = await callMCPTool(toolName, { owner, repo, pullNumber });
  if (result?.data) return result.data;
  return result;
}

/**
 * Get the diff for a pull request.
 */
export async function getPullRequestDiff(owner, repo, pullNumber) {
  await ensureInit();
  const toolMap = getToolMap();

  // Try diff-specific tool first
  const diffTool = Object.keys(toolMap).find(
    (k) => k.includes('diff') && (k.includes('pull') || k.includes('pr'))
  );

  if (diffTool) {
    const result = await callMCPTool(diffTool, { owner, repo, pullNumber });
    if (typeof result === 'string') return result;
    if (result?.diff) return result.diff;
    if (result?.data) return result.data;
    return String(result);
  }

  // Fallback: GitHub REST API
  return await fetchDiffViaREST(owner, repo, pullNumber);
}

/**
 * Get the list of files changed in a pull request.
 */
export async function getPullRequestFiles(owner, repo, pullNumber) {
  await ensureInit();
  const toolMap = getToolMap();

  const filesTool = Object.keys(toolMap).find(
    (k) =>
      (k.includes('file') || k.includes('files')) &&
      (k.includes('pull') || k.includes('pr'))
  );

  if (filesTool) {
    const result = await callMCPTool(filesTool, { owner, repo, pullNumber });
    if (Array.isArray(result)) return result;
    if (result?.data && Array.isArray(result.data)) return result.data;
    return [];
  }

  return await fetchPRFilesViaREST(owner, repo, pullNumber);
}

/**
 * Get the full content of a file from the repository.
 */
export async function getFileContents(owner, repo, path, ref) {
  await ensureInit();
  const toolMap = getToolMap();

  const contentTool = Object.keys(toolMap).find(
    (k) => k.includes('get_file') || k.includes('file_content') || k.includes('read_file')
  );

  if (contentTool) {
    try {
      const result = await callMCPTool(contentTool, {
        owner,
        repo,
        path,
        ref: ref || 'HEAD',
      });

      if (typeof result === 'string') {
        // May be base64 encoded
        try {
          return Buffer.from(result, 'base64').toString('utf-8');
        } catch {
          return result;
        }
      }
      if (result?.content) {
        try {
          return Buffer.from(result.content, 'base64').toString('utf-8');
        } catch {
          return result.content;
        }
      }
      return JSON.stringify(result);
    } catch (e) {
      console.warn(`⚠️  MCP getFileContents failed for ${path}: ${e.message}`);
      return null;
    }
  }

  return await fetchFileViaREST(owner, repo, path, ref);
}

// ─── REST API Fallbacks ──────────────────────────────────────────────────────

async function ghFetch(path, accept = 'application/vnd.github+json') {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} → ${res.status}: ${body}`);
  }
  return res;
}

export async function fetchPRsViaREST(owner, repo) {
  const res = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=30`);
  return res.json();
}

export async function fetchPRDetailViaREST(owner, repo, pullNumber) {
  const res = await ghFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  return res.json();
}

export async function fetchDiffViaREST(owner, repo, pullNumber) {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/pulls/${pullNumber}`,
    'application/vnd.github.v3.diff'
  );
  return res.text();
}

export async function fetchPRFilesViaREST(owner, repo, pullNumber) {
  const res = await ghFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`);
  return res.json();
}

export async function fetchFileViaREST(owner, repo, path, ref) {
  try {
    const refParam = ref ? `?ref=${ref}` : '';
    const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}${refParam}`);
    const data = await res.json();
    if (data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch (e) {
    console.warn(`⚠️  REST getFile failed for ${path}: ${e.message}`);
    return null;
  }
}
