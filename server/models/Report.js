import mongoose from 'mongoose';

const issueSchema = new mongoose.Schema({
  id: { type: String, required: true },
  file: { type: String, required: true },
  line: { type: Number, required: true },
  category: {
    type: String,
    enum: ['Bug - Certain', 'Security Vulnerability', 'Performance Risk', 'Code Smell - Stylistic'],
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
    enum: ['static+llm', 'llm-only', 'static-only'],
    required: true,
  },
  explanation: { type: String, required: true },
  suggestedFix: { type: String, required: true },
});

const reportSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  repo: { type: String, required: true },
  pullNumber: { type: Number, required: true },
  prTitle: { type: String, required: true },
  prUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  riskScore: { type: Number, min: 0, max: 100, required: true },
  falsePositiveRate: { type: Number, min: 0, max: 100, required: true },
  issues: [issueSchema],
  topThreeIssueIds: [{ type: String }],
  totalIssues: { type: Number, default: 0 },
  staticIssuesCount: { type: Number, default: 0 },
  llmIssuesCount: { type: Number, default: 0 },
  combinedIssuesCount: { type: Number, default: 0 },
  analyzedFiles: [{ type: String }],
  status: { type: String, enum: ['pending', 'complete', 'error'], default: 'complete' },
});

export const Report = mongoose.model('Report', reportSchema);
