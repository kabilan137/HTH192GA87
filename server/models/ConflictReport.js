import mongoose from 'mongoose';

const conflictResultSchema = new mongoose.Schema({
  mergeConflict:        { type: Boolean, required: true },
  conflictSeverity:     { type: String, enum: ['high', 'medium', 'low', 'none'], required: true },
  file:                 { type: String, default: '' },
  functionName:         { type: String, default: '' },
  startLine:            { type: Number, default: 0 },
  endLine:              { type: Number, default: 0 },
  reason:               { type: String, default: '' },
  developerAChanges:    { type: String, default: '' },
  developerBChanges:    { type: String, default: '' },
  recommendedMergedCode:{ type: String, default: '' },
  explanation:          { type: String, default: '' },
  notificationMessage:  { type: String, default: '' },
});

const conflictReportSchema = new mongoose.Schema({
  owner:                    { type: String, required: true },
  repo:                     { type: String, required: true },
  pullNumber:               { type: Number, required: true },
  prTitle:                  { type: String, required: true },
  prUrl:                    { type: String },
  createdAt:                { type: Date, default: Date.now },
  overallConflictDetected:  { type: Boolean, required: true },
  conflicts:                [conflictResultSchema],
  summary:                  { type: String, default: '' },
  totalFilesAnalyzed:       { type: Number, default: 0 },
  conflictingFilesCount:    { type: Number, default: 0 },
  status:                   { type: String, enum: ['pending', 'complete', 'error'], default: 'complete' },
});

export const ConflictReport = mongoose.model('ConflictReport', conflictReportSchema);
