/**
 * GET /api/reports        — list all past reports
 * GET /api/reports/:id    — fetch a single report by ID
 */

import { Router } from 'express';
import { Report } from '../models/Report.js';

const router = Router();

// List all reports (most recent first)
router.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find({}, {
      owner: 1,
      repo: 1,
      pullNumber: 1,
      prTitle: 1,
      createdAt: 1,
      riskScore: 1,
      falsePositiveRate: 1,
      totalIssues: 1,
      status: 1,
      prUrl: 1,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ reports, count: reports.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single report
router.get('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ report });
  } catch (e) {
    if (e.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid report ID format' });
    }
    res.status(500).json({ error: e.message });
  }
});

// Delete a report
router.delete('/reports/:id', async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
