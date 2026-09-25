import { useState } from 'react';
import './FeatureCreateModal.css';
import { apiFetch } from '../api.js';

export default function FeatureCreateModal({ owner, repo, onClose, onFeatureCreated }) {
  const [title, setTitle] = useState('');
  const [rawDescription, setRawDescription] = useState('');
  const [requirements, setRequirements] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleExtract = async () => {
    if (!rawDescription.trim()) return;
    setExtracting(true);
    setError(null);

    try {
      const res = await apiFetch('/api/features/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rawDescription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract requirements');
      setRequirements(data.requirements || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleRequirementChange = (index, field, value) => {
    setRequirements((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleRemoveRequirement = (index) => {
    setRequirements((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddRequirement = () => {
    setRequirements((prev) => [
      ...prev,
      {
        id: `req-${prev.length + 1}`,
        text: '',
        category: 'functional',
      },
    ]);
  };

  const handleSaveFeature = async () => {
    if (!title.trim() || !rawDescription.trim()) {
      setError('Title and description are required.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const res = await apiFetch('/api/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          repo,
          title: title.trim(),
          rawDescription: rawDescription.trim(),
          requirements: requirements.filter((r) => r.text.trim().length > 0),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save feature');

      if (onFeatureCreated) {
        onFeatureCreated(data.feature);
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fcm-overlay" onClick={onClose}>
      <div className="fcm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fcm-header">
          <div className="fcm-title">
            <span>🎯</span> Create Feature for Tracking
          </div>
          <button
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="fcm-body">
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: '12px' }}>
              {error}
            </div>
          )}

          <div className="fcm-field">
            <label className="fcm-label">Feature Title *</label>
            <input
              type="text"
              className="fcm-input"
              placeholder="e.g. User Authentication & Session Refresh"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="fcm-field">
            <label className="fcm-label">Raw Requirements / Description *</label>
            <textarea
              className="fcm-input fcm-textarea"
              placeholder="Describe the feature in plain English. State business rules, security expectations, error handling, etc."
              value={rawDescription}
              onChange={(e) => setRawDescription(e.target.value)}
            />
          </div>

          <button
            className="btn btn-secondary fcm-extract-btn"
            onClick={handleExtract}
            disabled={extracting || !rawDescription.trim()}
          >
            {extracting ? (
              <>
                <span className="spinner-border spinner-border-sm" />
                Extracting Atomic Requirements...
              </>
            ) : (
              <>
                <span>✨</span> Extract Requirements with AI
              </>
            )}
          </button>

          {/* Editable Requirements List */}
          {requirements.length > 0 && (
            <div className="fcm-reqs-section">
              <div className="fcm-reqs-header">
                <span className="fcm-reqs-title">
                  Requirements Checklist ({requirements.length}) — Review &amp; Edit:
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddRequirement}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                >
                  + Add Requirement
                </button>
              </div>

              {requirements.map((req, idx) => (
                <div key={idx} className="fcm-req-item">
                  <select
                    className="fcm-cat-select"
                    value={req.category}
                    onChange={(e) => handleRequirementChange(idx, 'category', e.target.value)}
                  >
                    <option value="functional">Functional</option>
                    <option value="security">Security</option>
                    <option value="edge-case">Edge Case</option>
                    <option value="non-functional">Non-functional</option>
                  </select>

                  <input
                    type="text"
                    className="fcm-req-text-input"
                    value={req.text}
                    onChange={(e) => handleRequirementChange(idx, 'text', e.target.value)}
                    placeholder="Atomic requirement..."
                  />

                  <button
                    type="button"
                    className="fcm-del-btn"
                    onClick={() => handleRemoveRequirement(idx)}
                    title="Remove requirement"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fcm-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveFeature}
            disabled={saving || !title.trim() || !rawDescription.trim()}
          >
            {saving ? 'Saving...' : 'Save & Track Feature'}
          </button>
        </div>
      </div>
    </div>
  );
}
