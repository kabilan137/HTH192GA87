/**
 * GitHub MCP Tool Wrappers
 *
 * These wrappers use the actual tool names discovered at runtime from the MCP server.
 * They adapt the dynamic tool list to a stable API used by the rest of the app.
 */

import { getMCPClient, callMCPTool, getToolMap } from './mcpClient.js';

// Ensure MCP is initialized; returns true if MCP is available, false if REST fallback should be used
async function ensureInit() {
  const client = await getMCPClient();
  return client !== null;
}

/**
 * List open pull requests for a repo.
 */
export async function listOpenPullRequests(owner, repo) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchPRsViaREST(owner, repo);

  const toolMap = getToolMap();
  const toolName = Object.keys(toolMap).find(
    (k) => k.includes('list_pull_requests') || k.includes('list_prs')
  );
  if (!toolName) return await fetchPRsViaREST(owner, repo);

  const result = await callMCPTool(toolName, { owner, repo, state: 'open' });
  if (Array.isArray(result)) return result;
  if (result?.data) return result.data;
  return [];
}

/**
 * Get details of a specific pull request.
 */
export async function getPullRequest(owner, repo, pullNumber) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchPRDetailViaREST(owner, repo, pullNumber);

  const toolMap = getToolMap();
  const toolName = Object.keys(toolMap).find(
    (k) =>
      (k.includes('get_pull_request') || k.includes('get_pr')) &&
      !k.includes('diff') && !k.includes('file') &&
      !k.includes('review') && !k.includes('comment')
  );
  if (!toolName) return await fetchPRDetailViaREST(owner, repo, pullNumber);

  const result = await callMCPTool(toolName, { owner, repo, pullNumber });
  if (result?.data) return result.data;
  return result;
}

/**
 * Get the diff for a pull request.
 */
export async function getPullRequestDiff(owner, repo, pullNumber) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchDiffViaREST(owner, repo, pullNumber);

  const toolMap = getToolMap();
  const diffTool = Object.keys(toolMap).find(
    (k) => k.includes('diff') && (k.includes('pull') || k.includes('pr'))
  );
  if (!diffTool) return await fetchDiffViaREST(owner, repo, pullNumber);

  const result = await callMCPTool(diffTool, { owner, repo, pullNumber });
  if (typeof result === 'string') return result;
  if (result?.diff) return result.diff;
  if (result?.data) return result.data;
  return await fetchDiffViaREST(owner, repo, pullNumber);
}

/**
 * Get the list of files changed in a pull request.
 */
export async function getPullRequestFiles(owner, repo, pullNumber) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchPRFilesViaREST(owner, repo, pullNumber);

  const toolMap = getToolMap();
  const filesTool = Object.keys(toolMap).find(
    (k) =>
      (k.includes('file') || k.includes('files')) &&
      (k.includes('pull') || k.includes('pr'))
  );
  if (!filesTool) return await fetchPRFilesViaREST(owner, repo, pullNumber);

  const result = await callMCPTool(filesTool, { owner, repo, pullNumber });
  if (Array.isArray(result)) return result;
  if (result?.data && Array.isArray(result.data)) return result.data;
  return await fetchPRFilesViaREST(owner, repo, pullNumber);
}

/**
 * List recent commits for a repository branch.
 * Used as a fallback proof-of-MCP when no PRs exist.
 */
export async function listCommits(owner, repo, options = {}) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchCommitsViaREST(owner, repo, options);

  const toolMap = getToolMap();
  const toolName = Object.keys(toolMap).find(
    (k) => k.includes('list_commits') || k.includes('get_commits')
  );
  if (!toolName) return await fetchCommitsViaREST(owner, repo, options);

  try {
    const result = await callMCPTool(toolName, {
      owner,
      repo,
      sha: options.sha || 'HEAD',
      perPage: options.perPage || 20,
    });
    if (Array.isArray(result)) return result;
    if (result?.data) return result.data;
    return await fetchCommitsViaREST(owner, repo, options);
  } catch (e) {
    console.warn(`⚠️  MCP listCommits failed: ${e.message}, falling back to REST`);
    return await fetchCommitsViaREST(owner, repo, options);
  }
}

/**
 * Get the full content of a file from the repository.
 */
export async function getFileContents(owner, repo, path, ref) {
  const mcpAvailable = await ensureInit();
  if (!mcpAvailable) return await fetchFileViaREST(owner, repo, path, ref);

  const toolMap = getToolMap();
  const contentTool = Object.keys(toolMap).find(
    (k) => k.includes('get_file') || k.includes('file_content') || k.includes('read_file')
  );
  if (!contentTool) return await fetchFileViaREST(owner, repo, path, ref);

  try {
    const result = await callMCPTool(contentTool, { owner, repo, path, ref: ref || 'HEAD' });
    if (typeof result === 'string') {
      try { return Buffer.from(result, 'base64').toString('utf-8'); } catch { return result; }
    }
    if (result?.content) {
      try { return Buffer.from(result.content, 'base64').toString('utf-8'); } catch { return result.content; }
    }
    return JSON.stringify(result);
  } catch (e) {
    console.warn(`⚠️  MCP getFileContents failed for ${path}: ${e.message}`);
    return await fetchFileViaREST(owner, repo, path, ref);
  }
}

// ─── REST API Fallbacks ──────────────────────────────────────────────────────

export async function fetchCommitsViaREST(owner, repo, options = {}) {
  const perPage = options.perPage || 20;
  const sha = options.sha ? `&sha=${options.sha}` : '';
  const res = await ghFetch(`/repos/${owner}/${repo}/commits?per_page=${perPage}${sha}`);
  return res.json();
}

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
