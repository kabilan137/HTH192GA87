/**
 * GitHub MCP Client
 * Uses the official GitHub MCP server via stdio transport (Docker).
 * If Docker is unavailable, sets mcpUnavailable=true so all callers
 * automatically fall back to the GitHub REST API.
 */

import { MultiServerMCPClient } from '@langchain/mcp-adapters';

let mcpClient = null;
let mcpTools = [];
let toolMap = {}; // name -> tool
let mcpUnavailable = false; // true when Docker not found — REST fallback is used

export async function getMCPClient() {
  if (mcpUnavailable) return null; // callers check for null and use REST
  if (mcpClient) return mcpClient;

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is not set in environment');
  }

  console.log('🔧 Initializing GitHub MCP client (requires Docker)...');

  try {
    mcpClient = new MultiServerMCPClient({
      mcpServers: {
        github: {
          command: 'docker',
          args: [
            'run', '-i', '--rm',
            '-e', `GITHUB_PERSONAL_ACCESS_TOKEN=${token}`,
            'ghcr.io/github/github-mcp-server',
          ],
          transport: 'stdio',
        },
      },
    });

    mcpTools = await mcpClient.getTools();

    console.log(`✅ MCP connected. Available tools (${mcpTools.length}):`);
    mcpTools.forEach((t) => {
      console.log(`   - ${t.name}: ${t.description?.slice(0, 80) || ''}`);
      toolMap[t.name] = t;
    });

    return mcpClient;
  } catch (err) {
    console.warn(
      `⚠️  GitHub MCP (Docker) unavailable: ${err.message}\n` +
      `   → Falling back to GitHub REST API for all operations.`
    );
    mcpUnavailable = true;
    mcpClient = null;
    return null;
  }
}

export function isMCPAvailable() {
  return !mcpUnavailable && mcpClient !== null;
}

export function getToolMap() {
  return toolMap;
}

export function getMCPTools() {
  return mcpTools;
}

/**
 * Call a tool by its exact name with given input.
 */
export async function callMCPTool(toolName, input) {
  const tool = toolMap[toolName];
  if (!tool) {
    throw new Error(
      `MCP tool "${toolName}" not found. Available: ${Object.keys(toolMap).join(', ')}`
    );
  }
  const result = await tool.invoke(input);
  try {
    return typeof result === 'string' ? JSON.parse(result) : result;
  } catch {
    return result;
  }
}

export async function closeMCPClient() {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    mcpTools = [];
    toolMap = {};
    console.log('🔒 MCP client closed');
  }
}
