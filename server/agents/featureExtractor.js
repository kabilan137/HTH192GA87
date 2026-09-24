import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { randomUUID } from 'crypto';

export const ExtractedRequirementsSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string().describe('Short identifier e.g. req-1, req-2'),
      text: z.string().describe('Atomic, single, independently-checkable requirement. Must not be compound (avoid "X and Y").'),
      category: z.enum(['functional', 'security', 'edge-case', 'non-functional']).describe('Requirement classification'),
    })
  ),
});

let _extractorChain = null;

function getExtractorChain() {
  if (_extractorChain) return _extractorChain;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const model = new ChatOpenAI({
    model: 'anthropic/claude-sonnet-5',
    apiKey,
    temperature: 0.1,
    maxTokens: 1000,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'CodeGuard AI' },
    },
  });

  _extractorChain = model.withStructuredOutput(ExtractedRequirementsSchema, {
    name: 'extracted_requirements',
  });
  return _extractorChain;
}

/**
 * Fallback parser when LLM is unavailable or credit-limited mid-hackathon.
 * Splits free-text into atomic bulleted items.
 */
function heuristicFallbackExtraction(rawDescription) {
  const lines = rawDescription
    .split(/\n|(?<=[.!?])\s+/)
    .map((l) => l.trim().replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((l) => l.length > 8);

  const reqs = [];
  let index = 1;
  for (const line of lines) {
    let category = 'functional';
    const lower = line.toLowerCase();
    if (lower.includes('security') || lower.includes('auth') || lower.includes('password') || lower.includes('token')) {
      category = 'security';
    } else if (lower.includes('error') || lower.includes('empty') || lower.includes('invalid') || lower.includes('edge')) {
      category = 'edge-case';
    } else if (lower.includes('performance') || lower.includes('scale') || lower.includes('fast') || lower.includes('logging')) {
      category = 'non-functional';
    }

    reqs.push({
      id: `req-${index++}`,
      text: line,
      category,
      addedAt: new Date(),
    });
  }

  if (reqs.length === 0) {
    reqs.push({
      id: 'req-1',
      text: rawDescription.trim() || 'Implement feature according to specifications',
      category: 'functional',
      addedAt: new Date(),
    });
  }

  return reqs;
}

/**
 * Extract atomic, independently-checkable requirements from a free-text feature description.
 *
 * @param {string} title
 * @param {string} rawDescription
 * @returns {Promise<Array<{ id: string, text: string, category: string, addedAt: Date }>>}
 */
export async function extractRequirementsFromDescription(title, rawDescription) {
  if (!rawDescription || !rawDescription.trim()) {
    return [];
  }

  const prompt = `You are a Senior Product Architect and Technical Lead.
A product owner or developer has provided the following feature request:

Feature Title: "${title || 'Feature'}"
Description:
"""
${rawDescription.slice(0, 3000)}
"""

Deconstruct this description into a list of ATOMIC, independently-checkable technical requirements:
1. Each requirement must describe ONE specific behavior or outcome. Avoid compound requirements ("X and Y" -> split into two separate requirements).
2. Categorize each requirement as:
   - "functional" (business logic, endpoints, UI state, data handling)
   - "security" (authentication, authorization, validation, sanitization)
   - "edge-case" (null/empty inputs, missing parameters, error boundaries, failure states)
   - "non-functional" (logging, diagnostics, response shape, performance)
3. Assign sequential IDs: "req-1", "req-2", etc.
4. Keep requirements concise, direct, and testable against source code diffs.`;

  try {
    const chain = getExtractorChain();
    const result = await chain.invoke([
      new SystemMessage('You extract atomic, checkable software requirements from free text. Return structured JSON.'),
      new HumanMessage(prompt),
    ]);

    const reqs = (result.requirements || []).map((r, i) => ({
      id: r.id || `req-${i + 1}`,
      text: r.text,
      category: r.category || 'functional',
      addedAt: new Date(),
    }));

    if (reqs.length > 0) return reqs;
  } catch (err) {
    console.warn(`⚠️  LLM requirement extraction warning: ${err.message}. Using heuristic fallback.`);
  }

  return heuristicFallbackExtraction(rawDescription);
}
