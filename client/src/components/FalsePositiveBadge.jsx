import './FalsePositiveBadge.css';

export default function FalsePositiveBadge({
  rate, llmOnlyCount, totalCount, staticOnlyCount, combinedCount
}) {
  const clampedRate = Math.min(100, Math.max(0, Math.round(rate)));
  const confirmedCount = staticOnlyCount + combinedCount;

  return (
    <div className="fp-badge card" id="false-positive-badge">
      <h3 className="fp-title">False Positive Rate</h3>

      {/* Big number — always visible, never buried */}
      <div className="fp-rate-display">
        <span className="fp-rate-number" style={{
          color: clampedRate > 60 ? 'var(--medium)' : clampedRate > 30 ? 'var(--accent-blue)' : 'var(--low)'
        }}>
          {clampedRate}%
        </span>
        <span className="fp-rate-label">of AI flags are unconfirmed</span>
      </div>

      {/* Breakdown bar */}
      <div className="fp-bar-container">
        <div className="fp-bar">
          {totalCount > 0 && confirmedCount > 0 && (
            <div
              className="fp-bar-confirmed"
              style={{ width: `${(confirmedCount / totalCount) * 100}%` }}
              title={`${confirmedCount} confirmed by static analysis`}
            />
          )}
          {totalCount > 0 && llmOnlyCount > 0 && (
            <div
              className="fp-bar-llmonly"
              style={{ width: `${(llmOnlyCount / totalCount) * 100}%` }}
              title={`${llmOnlyCount} AI-only (unconfirmed)`}
            />
          )}
        </div>
        <div className="fp-bar-legend">
          <span className="fp-legend-item fp-legend-confirmed">
            <span className="fp-legend-dot" />
            {confirmedCount} confirmed
          </span>
          <span className="fp-legend-item fp-legend-ai">
            <span className="fp-legend-dot" />
            {llmOnlyCount} AI-only
          </span>
        </div>
      </div>

      {/* Visible label */}
      <div className="fp-label-always-visible">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          <strong>{clampedRate}%</strong> of flagged issues are AI-inferred and not confirmed by static analysis
        </span>
      </div>

      <div className="fp-source-breakdown">
        <div className="fp-source-item">
          <span className="badge badge-static-llm" style={{ fontSize: '10px' }}>🔬 Static + AI</span>
          <span className="fp-source-count">{combinedCount}</span>
        </div>
        <div className="fp-source-item">
          <span className="badge badge-static-only" style={{ fontSize: '10px' }}>🔧 Static Only</span>
          <span className="fp-source-count">{staticOnlyCount}</span>
        </div>
        <div className="fp-source-item">
          <span className="badge badge-llm-only" style={{ fontSize: '10px' }}>🤖 AI Only</span>
          <span className="fp-source-count">{llmOnlyCount}</span>
        </div>
      </div>
    </div>
  );
}
