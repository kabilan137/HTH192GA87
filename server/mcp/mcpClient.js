/**
 * GitHub MCP Client
 * Uses the official GitHub MCP server via stdio transport.
 * We connect, list available tools, and expose helper methods that use
 * the actual tool names returned by the server (no hardcoding assumed names).
 */

import { MultiServerMCPClient } from '@langchain/mcp-adapters';

let mcpClient = null;
let mcpTools = [];
let toolMap = {}; // name -> tool

export async function getMCPClient() {
  if (mcpClient) return mcpClient;

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN is not set in environment');
  }

  console.log('🔧 Initializing GitHub MCP client...');

  mcpClient = new MultiServerMCPClient({
    mcpServers: {
      github: {
        command: 'docker',
        args: [
          'run',
          '-i',
          '--rm',
          '-e', `GITHUB_PERSONAL_ACCESS_TOKEN=${token}`,
          'ghcr.io/github/github-mcp-server',
        ],
        transport: 'stdio',
      },
    },
  });

  // Load and list all available tools
  mcpTools = await mcpClient.getTools();

  console.log(`✅ MCP connected. Available tools (${mcpTools.length}):`);
  mcpTools.forEach((t) => {
    console.log(`   - ${t.name}: ${t.description?.slice(0, 80) || ''}`);
    toolMap[t.name] = t;
  });

  return mcpClient;
}

export function getToolMap() {
  return toolMap;
}

export function getMCPTools() {
  return mcpTools;
}

/**
 * Find a tool by partial name match (case-insensitive).
 * Tries exact match first, then partial.
 */
export function findTool(partialName) {
  const lower = partialName.toLowerCase();
  // Exact
  if (toolMap[partialName]) return toolMap[partialName];
  // Partial
  const match = Object.keys(toolMap).find((k) => k.toLowerCase().includes(lower));
  if (match) return toolMap[match];
  throw new Error(
    `MCP tool not found matching "${partialName}". Available: ${Object.keys(toolMap).join(', ')}`
  );
}

/**
 * Call a tool by its exact name with given input.
 * Returns the parsed output content.
 */
export async function callMCPTool(toolName, input) {
  const tool = toolMap[toolName];
  if (!tool) {
    throw new Error(
      `MCP tool "${toolName}" not found. Available: ${Object.keys(toolMap).join(', ')}`
    );
  }
  const result = await tool.invoke(input);
  // MCP tools return content as string or JSON
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
