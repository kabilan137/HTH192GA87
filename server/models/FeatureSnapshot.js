import mongoose from 'mongoose';

const fileRefSchema = new mongoose.Schema(
  {
    file: { type: String, required: true },
    line: { type: Number },
  },
  { _id: false }
);

const requirementStatusSchema = new mongoose.Schema(
  {
    requirementId: { type: String, required: true },
    status: {
      type: String,
      enum: ['met', 'partial', 'not_addressed', 'not_applicable'],
      required: true,
    },
    evidence: { type: String, default: '' },
    fileRefs: [fileRefSchema],
    changeSinceLast: {
      type: String,
      enum: ['first_check', 'resolved', 'still_open', 'regressed', 'newly_addressed', 'unchanged'],
      default: 'first_check',
    },
  },
  { _id: false }
);

const featureSnapshotSchema = new mongoose.Schema({
  featureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Feature', required: true, index: true },
  triggeredByPr: { type: String, required: true }, // e.g. "PR #2" or "branch: yoga"
  analyzedAt: { type: Date, default: Date.now },
  requirementStatuses: [requirementStatusSchema],
  overallCompletionPercent: { type: Number, min: 0, max: 100, required: true },
});

featureSnapshotSchema.index({ featureId: 1, analyzedAt: -1 });

export const FeatureSnapshot = mongoose.model('FeatureSnapshot', featureSnapshotSchema);
