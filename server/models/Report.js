import mongoose from 'mongoose';

const issueSchema = new mongoose.Schema({
  id: { type: String, required: true },
  file: { type: String, required: true },
  line: { type: Number, required: true },
  category: {
    type: String,
    enum: [
      'Bug - Certain',
      'Security Vulnerability',
      'Performance Risk',
      'Code Smell - Stylistic',
      'Concurrent Modification Risk',   // Step E — new category
    ],
    required: true,
  },
  severity: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low'],
    required: true,
  },
  confidence: { type: Number, min: 0, max: 1, required: true },
  source: {
    type: String,
    enum: ['static+llm', 'llm-only', 'static-only', 'diff-overlap'], // diff-overlap = deterministic
    required: true,
  },
  explanation: { type: String, required: true },
  suggestedFix: { type: String, required: true },

  // ── Concurrent Modification Risk fields (populated only for that category) ──
  conflictingBranch:   { type: String },
  conflictingAuthor:   { type: String },
  conflictingPRNumber: { type: Number },
  conflictingPRTitle:  { type: String },
  lineRangeSelf:       { type: [Number] }, // [start, end]
  lineRangeOther:      { type: [Number] }, // [start, end]
  collisionType:       { type: String, enum: ['line-level', 'file-level'] },
  lastPushedAt:        { type: String },
});

const reportSchema = new mongoose.Schema({
  owner:     { type: String, required: true },
  repo:      { type: String, required: true },
  pullNumber:{ type: Number, required: true },
  prTitle:   { type: String, required: true },
  prUrl:     { type: String },
  createdAt: { type: Date, default: Date.now },
  riskScore: { type: Number, min: 0, max: 100, required: true },
  falsePositiveRate:   { type: Number, min: 0, max: 100, required: true },
  issues:              [issueSchema],
  topThreeIssueIds:    [{ type: String }],
  totalIssues:         { type: Number, default: 0 },
  staticIssuesCount:   { type: Number, default: 0 },
  llmIssuesCount:      { type: Number, default: 0 },
  combinedIssuesCount: { type: Number, default: 0 },

  // ── Step F — Concurrent Modification Risk summary ──
  concurrentModificationCount: { type: Number, default: 0 },

  analyzedFiles: [{ type: String }],
  status: { type: String, enum: ['pending', 'complete', 'error'], default: 'complete' },
});

export const Report = mongoose.model('Report', reportSchema);
