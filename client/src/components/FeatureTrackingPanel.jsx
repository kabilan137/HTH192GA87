import { useState, useEffect } from 'react';
import './FeatureTrackingPanel.css';

const STATUS_META = {
  met:            { label: 'Met',            icon: '✅', className: 'ftp-status-met' },
  partial:        { label: 'Partial',        icon: '⚠️', className: 'ftp-status-partial' },
  not_addressed:  { label: 'Not Addressed',  icon: '❌', className: 'ftp-status-not_addressed' },
  not_applicable: { label: 'N/A',            icon: '⚪', className: 'ftp-status-not_applicable' },
};

const CHANGE_META = {
  resolved:        { label: 'Resolved since last PR', icon: '🟢', className: 'ftp-change-resolved' },
  regressed:       { label: 'Regressed',              icon: '🔴', className: 'ftp-change-regressed' },
  still_open:      { label: 'Still open',             icon: '🟡', className: 'ftp-change-still_open' },
  newly_addressed: { label: 'Newly addressed',        icon: '🔵', className: 'ftp-change-newly_addressed' },
  first_check:     { label: 'First check',            icon: '🟣', className: 'ftp-change-first_check' },
  unchanged:       { label: 'Unchanged',              icon: '⚪', className: 'ftp-change-unchanged' },
};

export default function FeatureTrackingPanel({ snapshot, featureId, owner, repo }) {
  const [feature, setFeature] = useState(null);
  const [loading, setLoading] = useState(false);

  // If featureId is given, fetch feature details to display title & full text
  useEffect(() => {
    const fId = snapshot?.featureId || featureId;
    if (!fId) return;

    setLoading(true);
    fetch(`/api/features/${fId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.feature) setFeature(data.feature);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [snapshot, featureId]);

  if (!snapshot) return null;

  const percent = snapshot.overallCompletionPercent ?? 0;
  const percentClass =
    percent >= 80 ? 'ftp-percent-high' : percent >= 50 ? 'ftp-percent-mid' : 'ftp-percent-low';

  // Build map of requirement text from feature document
  const reqMap = {};
  for (const r of feature?.requirements || []) {
    reqMap[r.id] = r;
  }

  return (
    <div className="ftp-panel card" id="feature-tracking-panel">
      {/* Header */}
      <div className="ftp-header">
        <div className="ftp-header-left">
          <div className="ftp-header-icon">🎯</div>
          <div>
            <div className="ftp-title">
              Feature Requirement Tracking: {feature?.title || 'Feature Verification'}
            </div>
            <div className="ftp-subtitle">
              Cumulative evaluation against defined requirements checklist. Evaluated against all changes relative to the base branch. Triggered by <strong>{snapshot.triggeredByPr}</strong>.
            </div>
          </div>
        </div>

        <div className="ftp-score-box">
          <div className={`ftp-percent-badge ${percentClass}`}>
            {percent}% Completed
          </div>
          <div className="ftp-progress-bar-bg">
            <div
              className="ftp-progress-bar-fill"
              style={{
                width: `${percent}%`,
                background: percent >= 80 ? '#4ade80' : percent >= 50 ? '#fbbf24' : '#f87171',
              }}
            />
          </div>
        </div>
      </div>

      <div className="ftp-disclaimer">
        ℹ️ <strong>Heuristic evaluation:</strong> Requirement verdicts are AI assessments grounded in cited diff evidence, not an automatic guarantee or merge gate.
      </div>

      {/* Requirement List */}
      <div className="ftp-req-list">
        {(snapshot.requirementStatuses || []).map((rs) => {
          const reqDef = reqMap[rs.requirementId];
          const sm = STATUS_META[rs.status] || STATUS_META.not_addressed;
          const cm = CHANGE_META[rs.changeSinceLast] || CHANGE_META.unchanged;

          return (
            <div key={rs.requirementId} className="ftp-req-card">
              <div className="ftp-req-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ftp-req-id-badge">{rs.requirementId}</span>
                  {reqDef?.category && (
                    <span className={`ftp-req-cat-badge ftp-cat-${reqDef.category}`}>
                      {reqDef.category}
                    </span>
                  )}
                </div>

                <div className="ftp-badges-row">
                  {/* changeSinceLast badge */}
                  <span className={`ftp-change-badge ${cm.className}`}>
                    {cm.icon} {cm.label}
                  </span>

                  {/* status badge */}
                  <span className={`ftp-status-badge ${sm.className}`}>
                    {sm.icon} {sm.label}
                  </span>
                </div>
              </div>

              {/* Requirement text */}
              <div className="ftp-req-text">
                {reqDef?.text || `Requirement ${rs.requirementId}`}
              </div>

              {/* Cited Evidence */}
              {rs.evidence && (
                <div className="ftp-evidence-box">
                  <div className="ftp-evidence-label">Evidence in Code:</div>
                  <div>{rs.evidence}</div>

                  {rs.fileRefs && rs.fileRefs.length > 0 && (
                    <div className="ftp-file-refs">
                      {rs.fileRefs.map((fr, idx) => (
                        <span key={idx} className="ftp-file-tag">
                          📄 {fr.file}{fr.line ? `:${fr.line}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
