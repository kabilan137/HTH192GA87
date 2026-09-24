import { Router } from 'express';
import { Feature } from '../models/Feature.js';
import { FeatureSnapshot } from '../models/FeatureSnapshot.js';
import { extractRequirementsFromDescription } from '../agents/featureExtractor.js';

const router = Router();

/**
 * POST /api/features/extract
 * Extracts atomic requirements from free-text description for human review before final save.
 */
router.post('/features/extract', async (req, res) => {
  const { title, rawDescription } = req.body || {};
  if (!rawDescription || !rawDescription.trim()) {
    return res.status(400).json({ error: 'rawDescription is required' });
  }

  try {
    const requirements = await extractRequirementsFromDescription(title, rawDescription);
    res.json({ success: true, requirements });
  } catch (e) {
    console.error('❌ Failed to extract requirements:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/features
 * Creates a new Feature with atomic requirements.
 * If requirements are not provided, extracts them from rawDescription.
 */
router.post('/features', async (req, res) => {
  const { owner, repo, title, rawDescription, requirements: providedReqs } = req.body || {};

  if (!owner || !repo || !title || !rawDescription) {
    return res.status(400).json({ error: 'owner, repo, title, and rawDescription are required' });
  }

  try {
    let requirements = providedReqs;
    if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
      requirements = await extractRequirementsFromDescription(title, rawDescription);
    }

    const feature = new Feature({
      owner,
      repo: repo.replace(/\.git$/, ''),
      title,
      rawDescription,
      requirements,
      status: 'active',
    });

    await feature.save();
    console.log(`✅ Feature created: "${feature.title}" (${feature._id}) with ${feature.requirements.length} requirement(s)`);
    res.status(201).json({ success: true, feature });
  } catch (e) {
    console.error('❌ Failed to create feature:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/features
 * Lists features for an owner/repo, optionally populated with latest snapshot summary.
 */
router.get('/features', async (req, res) => {
  const { owner, repo, status } = req.query;

  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner and repo query params are required' });
  }

  try {
    const query = { owner, repo: repo.replace(/\.git$/, '') };
    if (status) query.status = status;

    const features = await Feature.find(query).sort({ createdAt: -1 }).lean();

    // Fetch latest snapshot for each feature
    const featuresWithLatest = await Promise.all(
      features.map(async (f) => {
        const latestSnapshot = await FeatureSnapshot.findOne({ featureId: f._id })
          .sort({ analyzedAt: -1 })
          .lean();
        const totalSnapshots = await FeatureSnapshot.countDocuments({ featureId: f._id });

        return {
          ...f,
          latestSnapshot,
          totalSnapshots,
          completionPercent: latestSnapshot ? latestSnapshot.overallCompletionPercent : 0,
        };
      })
    );

    res.json({ features: featuresWithLatest, count: featuresWithLatest.length });
  } catch (e) {
    console.error('❌ Failed to list features:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/features/:id
 * Fetches a single feature with its complete snapshot history.
 */
router.get('/features/:id', async (req, res) => {
  try {
    const feature = await Feature.findById(req.params.id).lean();
    if (!feature) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const snapshots = await FeatureSnapshot.find({ featureId: feature._id })
      .sort({ analyzedAt: -1 })
      .lean();

    res.json({ feature, snapshots });
  } catch (e) {
    console.error('❌ Failed to get feature:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /api/features/:id
 * Updates feature title, rawDescription, status, or requirements (edit/add/delete).
 * Historical snapshots are preserved as-is.
 */
router.patch('/features/:id', async (req, res) => {
  const { title, rawDescription, requirements, status } = req.body || {};

  try {
    const feature = await Feature.findById(req.params.id);
    if (!feature) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    if (title !== undefined) feature.title = title;
    if (rawDescription !== undefined) feature.rawDescription = rawDescription;
    if (status !== undefined) feature.status = status;
    if (requirements !== undefined && Array.isArray(requirements)) {
      feature.requirements = requirements.map((r, i) => ({
        id: r.id || `req-${i + 1}`,
        text: r.text,
        category: r.category || 'functional',
        addedAt: r.addedAt || new Date(),
      }));
    }

    await feature.save();
    console.log(`✅ Feature updated: "${feature.title}" (${feature._id})`);
    res.json({ success: true, feature });
  } catch (e) {
    console.error('❌ Failed to update feature:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/features/:id
 */
router.delete('/features/:id', async (req, res) => {
  try {
    await Feature.findByIdAndDelete(req.params.id);
    await FeatureSnapshot.deleteMany({ featureId: req.params.id });
    res.json({ success: true, message: 'Feature and snapshots deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
