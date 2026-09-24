import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Feature } from '../models/Feature.js';
import { FeatureSnapshot } from '../models/FeatureSnapshot.js';

export const RequirementStatusSchema = z.object({
  requirementId: z.string(),
  status: z.enum(['met', 'partial', 'not_addressed', 'not_applicable']),
  evidence: z.string().describe('Concrete explanation citing specific lines or absence of code. Must cite code if met.'),
  fileRefs: z.array(
    z.object({
      file: z.string(),
      line: z.number().nullable().describe('Line number if known, or null'),
    })
  ).describe('Files and lines demonstrating compliance or partial compliance'),
});

export const FeatureCoverageReportSchema = z.object({
  evaluations: z.array(RequirementStatusSchema),
});

let _coverageChain = null;

function getCoverageChain() {
  if (_coverageChain) return _coverageChain;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const model = new ChatOpenAI({
    model: 'anthropic/claude-sonnet-5',
    apiKey,
    temperature: 0.1,
    maxTokens: 1200,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'CodeGuard AI' },
    },
  });

  _coverageChain = model.withStructuredOutput(FeatureCoverageReportSchema, {
    name: 'feature_coverage_eval',
  });
  return _coverageChain;
}

/**
 * Pure transition logic for changeSinceLast.
 *
 * @param {string|null} prevStatus - 'met' | 'partial' | 'not_addressed' | 'not_applicable' | null
 * @param {string} currentStatus   - 'met' | 'partial' | 'not_addressed' | 'not_applicable'
 * @param {boolean} isNewRequirement - added after the last snapshot
 * @returns {'first_check' | 'resolved' | 'still_open' | 'regressed' | 'newly_addressed' | 'unchanged'}
 */
export function computeChangeSinceLast(prevStatus, currentStatus, isNewRequirement = false) {
  if (!prevStatus) {
    if (isNewRequirement && currentStatus === 'met') return 'newly_addressed';
    return 'first_check';
  }

  // Moved from incomplete (not_addressed/partial) to met
  if ((prevStatus === 'not_addressed' || prevStatus === 'partial') && currentStatus === 'met') {
    return 'resolved';
  }

  // Moved from met down to partial or not_addressed
  if (prevStatus === 'met' && (currentStatus === 'partial' || currentStatus === 'not_addressed')) {
    return 'regressed';
  }

  // Newly addressed requirement (e.g. from not_addressed to partial)
  if (prevStatus === 'not_addressed' && currentStatus === 'partial') {
    return 'newly_addressed';
  }

  // Unchanged incomplete
  if (prevStatus === currentStatus && (currentStatus === 'not_addressed' || currentStatus === 'partial')) {
    return 'still_open';
  }

  // Otherwise unchanged (e.g. met -> met, not_applicable -> not_applicable)
  return 'unchanged';
}

/**
 * Step E: Compute overallCompletionPercent
 * Formula: (count of "met" + 0.5 × count of "partial") / (count of requirements excluding "not_applicable") × 100
 */
export function computeOverallCompletionPercent(requirementStatuses) {
  if (!requirementStatuses || requirementStatuses.length === 0) return 0;

  const applicable = requirementStatuses.filter((r) => r.status !== 'not_applicable');
  if (applicable.length === 0) return 100;

  const metCount = applicable.filter((r) => r.status === 'met').length;
  const partialCount = applicable.filter((r) => r.status === 'partial').length;

  const score = ((metCount + 0.5 * partialCount) / applicable.length) * 100;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Fallback evaluator when LLM is unavailable.
 * Inspects diff for matching keywords.
 */
function heuristicCoverageEvaluation(requirements, cumulativeDiff, prevStatusMap, isFirstSnapshot) {
  const diffLower = (cumulativeDiff || '').toLowerCase();

  return requirements.map((req) => {
    const textLower = req.text.toLowerCase();
    const keywords = textLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['must', 'should', 'with', 'from', 'system', 'able'].includes(w));

    let matchCount = 0;
    for (const kw of keywords) {
      if (diffLower.includes(kw)) matchCount++;
    }

    const ratio = keywords.length > 0 ? matchCount / keywords.length : 0;
    let status = 'not_addressed';
    let evidence = 'No code addressing this requirement was identified in the cumulative diff.';
    const fileRefs = [];

    if (ratio >= 0.5) {
      status = 'met';
      evidence = `Code changes match key terms (${keywords.slice(0, 3).join(', ')}) corresponding to this requirement.`;
      fileRefs.push({ file: 'cumulative-diff', line: 1 });
    } else if (ratio > 0.2) {
      status = 'partial';
      evidence = `Partial matches found in cumulative diff, but complete implementation could not be verified.`;
      fileRefs.push({ file: 'cumulative-diff', line: 1 });
    }

    const prev = prevStatusMap[req.id];
    const isNew = !isFirstSnapshot && prev === undefined;
    const changeSinceLast = computeChangeSinceLast(prev || null, status, isNew);

    return {
      requirementId: req.id,
      status,
      evidence,
      fileRefs,
      changeSinceLast,
    };
  });
}

/**
 * Step D & E: Evaluate cumulative diff against feature requirements and produce a new snapshot.
 *
 * @param {Object} options
 * @param {string} options.featureId
 * @param {string} options.triggeredByPr  - e.g. "PR #2" or "branch: yoga"
 * @param {string} options.cumulativeDiff - full diff against default branch
 * @returns {Promise<FeatureSnapshot>}
 */
export async function trackFeatureRequirements({ featureId, triggeredByPr, cumulativeDiff }) {
  const feature = await Feature.findById(featureId).lean();
  if (!feature) {
    throw new Error(`Feature ${featureId} not found`);
  }

  const requirements = feature.requirements || [];
  if (requirements.length === 0) {
    throw new Error(`Feature "${feature.title}" has no requirements to evaluate`);
  }

  // Fetch the most recent snapshot for this feature (if one exists)
  const previousSnapshot = await FeatureSnapshot.findOne({ featureId })
    .sort({ analyzedAt: -1 })
    .lean();

  const prevStatusMap = {};
  if (previousSnapshot && previousSnapshot.requirementStatuses) {
    for (const rs of previousSnapshot.requirementStatuses) {
      prevStatusMap[rs.requirementId] = rs.status;
    }
  }

  const isFirstSnapshot = !previousSnapshot;

  const reqListPrompt = requirements
    .map(
      (r) =>
        `- ID: "${r.id}" [${r.category}]
  Requirement: ${r.text}
  Previous Status: ${prevStatusMap[r.id] || '(none - new requirement or first check)'}`
    )
    .join('\n');

  const prompt = `You are evaluating software implementation progress against feature requirements.

FEATURE: "${feature.title}"
SPECIFICATION / GOALS:
"""
${feature.rawDescription.slice(0, 1500)}
"""

REQUIREMENTS CHECKLIST:
${reqListPrompt}

CUMULATIVE CODE CHANGES (Full diff against main branch so far):
\`\`\`diff
${(cumulativeDiff || 'No changes found.').slice(0, 15000)}
\`\`\`

YOUR TASK:
For EACH requirement ID in the checklist, determine:
1. "status":
   - "met": The requirement is completely and demonstrably implemented in the cumulative diff.
     CRITICAL RULE: You MUST cite specific code / fileRefs for "met". Do NOT mark "met" without specific evidence in the diff.
   - "partial": Scaffolding, partial logic, or incomplete implementation is present.
   - "not_addressed": No relevant implementation appears in the diff.
   - "not_applicable": The requirement is obsolete or superseded.
2. "evidence": A clear, 1-2 sentence statement explaining the verdict and citing the specific code or its absence.
3. "fileRefs": Array of { file, line } where the code resides.

Return a structured JSON report evaluating ALL ${requirements.length} requirements.`;

  let requirementStatuses = [];

  try {
    const chain = getCoverageChain();
    const result = await chain.invoke([
      new SystemMessage('You are a rigorous code auditor evaluating feature completeness against diffs. Ground all "met" statuses in cited code.'),
      new HumanMessage(prompt),
    ]);

    const evalMap = {};
    for (const ev of result.evaluations || []) {
      evalMap[ev.requirementId] = ev;
    }

    requirementStatuses = requirements.map((req) => {
      const ev = evalMap[req.id];
      let status = ev?.status || 'not_addressed';
      let evidence = ev?.evidence || 'No evidence provided.';
      let fileRefs = ev?.fileRefs || [];

      // Guard: enforce evidence/fileRefs for "met"
      if (status === 'met' && (!fileRefs || fileRefs.length === 0 || !evidence || evidence.trim().length < 5)) {
        status = 'partial';
        evidence = `Marked partial: LLM signaled completion but did not provide specific code file references and evidence.`;
      }

      const prev = prevStatusMap[req.id];
      const isNew = !isFirstSnapshot && prev === undefined;
      const changeSinceLast = computeChangeSinceLast(prev || null, status, isNew);

      return {
        requirementId: req.id,
        status,
        evidence,
        fileRefs,
        changeSinceLast,
      };
    });
  } catch (err) {
    console.warn(`⚠️  Coverage LLM evaluation warning: ${err.message}. Using heuristic coverage.`);
    requirementStatuses = heuristicCoverageEvaluation(requirements, cumulativeDiff, prevStatusMap, isFirstSnapshot);
  }

  // Step E: Compute completion percentage
  const overallCompletionPercent = computeOverallCompletionPercent(requirementStatuses);

  // Save new FeatureSnapshot (NEVER overwrite previous snapshots)
  const snapshot = new FeatureSnapshot({
    featureId: feature._id,
    triggeredByPr,
    analyzedAt: new Date(),
    requirementStatuses,
    overallCompletionPercent,
  });

  await snapshot.save();
  console.log(
    `✅ FeatureSnapshot created for "${feature.title}": ${overallCompletionPercent}% complete (${requirementStatuses.filter((r) => r.status === 'met').length}/${requirements.length} met)`
  );

  return snapshot;
}
