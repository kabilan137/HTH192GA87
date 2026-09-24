import { useState, useEffect } from 'react';
import './FeatureDashboard.css';

export default function FeatureDashboard({ owner, repo, onCreateFeature, onSelectFeature }) {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFeatures = async () => {
    if (!owner || !repo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/features?owner=${owner}&repo=${repo}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch features');
      setFeatures(data.features || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeatures();
  }, [owner, repo]);

  return (
    <div className="fd-container">
      <div className="fd-top-bar">
        <div className="fd-title-area">
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
            🎯 Feature Requirements Tracking
          </h2>
          <span className="badge badge-medium">{features.length} Tracked</span>
        </div>

        <button
          className="btn btn-primary btn-sm"
          onClick={onCreateFeature}
          id="dashboard-new-feature-btn"
        >
          + New Feature
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
          <span className="spinner-border spinner-border-sm" /> Loading feature trackers...
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {!loading && !error && features.length === 0 && (
        <div className="fd-empty">
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>No Features Tracked Yet</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto 16px' }}>
            Record a feature&apos;s requirements once in plain English. Every PR submitted against it will track cumulative completion progress.
          </p>
          <button className="btn btn-primary btn-sm" onClick={onCreateFeature}>
            + Create Your First Feature
          </button>
        </div>
      )}

      {!loading && !error && features.length > 0 && (
        <div className="fd-card-grid">
          {features.map((f) => {
            const percent = f.completionPercent ?? 0;
            const progressColor = percent >= 80 ? '#4ade80' : percent >= 50 ? '#fbbf24' : '#f87171';

            return (
              <div key={f._id} className="fd-feature-card">
                <div className="fd-card-top">
                  <div>
                    <div className="fd-feature-title">{f.title}</div>
                    <div className="fd-feature-meta">
                      {f.requirements?.length || 0} requirements · Created {new Date(f.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      background: f.status === 'active' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)',
                      color: f.status === 'active' ? '#60a5fa' : '#4ade80',
                    }}
                  >
                    {f.status}
                  </span>
                </div>

                {/* Completion Progress Bar */}
                <div className="fd-completion-box">
                  <div className="fd-completion-header">
                    <span>Cumulative Progress</span>
                    <span style={{ color: progressColor }}>{percent}%</span>
                  </div>
                  <div className="fd-progress-bar">
                    <div
                      className="fd-progress-fill"
                      style={{ width: `${percent}%`, background: progressColor }}
                    />
                  </div>
                </div>

                {/* PR Snapshots History */}
                <div className="fd-snapshots-timeline">
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#cbd5e1' }}>
                    Tracking History: {f.totalSnapshots || 0} PR check(s)
                  </div>
                  {f.latestSnapshot ? (
                    <div className="fd-snapshot-row">
                      <span>Latest: {f.latestSnapshot.triggeredByPr}</span>
                      <span>{f.latestSnapshot.overallCompletionPercent}%</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
                      No PRs checked yet. Link this feature during PR analysis.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
