import mongoose from 'mongoose';

const requirementItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
  category: {
    type: String,
    enum: ['functional', 'security', 'edge-case', 'non-functional'],
    default: 'functional',
  },
  addedAt: { type: Date, default: Date.now },
});

const featureSchema = new mongoose.Schema({
  owner: { type: String, required: true, index: true },
  repo: { type: String, required: true, index: true },
  title: { type: String, required: true },
  rawDescription: { type: String, required: true },
  requirements: [requirementItemSchema],
  status: { type: String, enum: ['active', 'done'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
});

featureSchema.index({ owner: 1, repo: 1, createdAt: -1 });

export const Feature = mongoose.model('Feature', featureSchema);
