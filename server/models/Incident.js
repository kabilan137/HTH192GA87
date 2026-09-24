/**
 * Incident — stored resolved review thread (review memory)
 *
 * Each document represents one resolved reviewer comment thread from a merged PR,
 * with the "problem" embedding used for future similarity search.
 */

import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema({
  // Repository scope
  owner: { type: String, required: true, index: true },
  repo:  { type: String, required: true, index: true },

  // PR context
  prNumber:     { type: Number, required: true },
  prTitle:      { type: String },
  mergedAt:     { type: String }, // ISO date

  // Code location
  filePath:     { type: String, required: true },
  originalLine: { type: Number },

  // Problem side (what the reviewer flagged) — INDEXED for text-fallback search
  problemSnippet:  { type: String, required: true }, // diffHunk
  reviewerComment: { type: String, required: true }, // concatenated comment bodies

  // Reviewer identity
  reviewerLogin: { type: String },

  // Resolution side (how it was fixed at merge commit)
  resolutionSnippet: { type: String },

  // Embedding vector (null when no embedding provider was available)
  // Stored as plain JS array — brute-force cosine similarity in Node
  embedding: { type: [Number], default: null },

  // Record metadata
  createdAt: { type: Date, default: Date.now },
});

// Text index on problem side — used as fallback when embedding is null
incidentSchema.index(
  { problemSnippet: 'text', reviewerComment: 'text' },
  { name: 'incident_text_search' }
);

// Compound index for repo scoping + uniqueness guard
incidentSchema.index({ owner: 1, repo: 1, prNumber: 1, filePath: 1, originalLine: 1 });

export const Incident = mongoose.model('Incident', incidentSchema);
