import './ConcurrentRiskPanel.css';

const COLLISION_META = {
  'line-level': {
    label: 'Line-Level',
    badge: 'badge-critical',
    color: 'var(--critical)',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.3)',
    icon: '⚡',
    tip: 'Same or adjacent lines modified in both branches — high merge conflict risk',
  },
  'file-level': {
    label: 'File-Level',
    badge: 'badge-medium',
    color: 'var(--medium)',
    bg: 'rgba(234,179,8,0.08)',
    border: 'rgba(234,179,8,0.3)',
    icon: '📄',
    tip: 'Same file touched in different regions — coordinate to avoid unintended overwrites',
  },
};

function LineRangeTag({ range, label, color }) {
  const [start, end] = range || [0, 0];
  const text = start === 0 ? 'unknown range' : start === end ? `line ${start}` : `lines ${start}–${end}`;
  return (
    <span className="cmr-range-tag" style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
      {label}: {text}
    </span>
  );
}

export default function ConcurrentRiskPanel({ issues }) {
  const concurrentIssues = (issues || []).filter(
    (i) => i.category === 'Concurrent Modification Risk' && i.source === 'diff-overlap'
  );

  const hasCollisions = concurrentIssues.length > 0;
  const lineLevelCount = concurrentIssues.filter((i) => i.collisionType === 'line-level').length;
  const fileLevelCount = concurrentIssues.filter((i) => i.collisionType === 'file-level').length;

  return (
    <div className="cmr-panel" id="concurrent-risk-panel">
      {/* Header */}
      <div className="cmr-header">
        <div className="cmr-header-left">
          <span className="cmr-header-icon">🔀</span>
          <div>
            <h2 className="cmr-title">Concurrent Modification Risk</h2>
            <p className="cmr-subtitle">
              Heuristic detection — line-range overlap ±3 lines between this PR and other open branches.
              {' '}Not a full AST-level conflict analyzer.
            </p>
          </div>
        </div>
        {hasCollisions && (
          <div className="cmr-badge-row">
            {lineLevelCount > 0 && (
              <span className="cmr-count-badge cmr-count-critical">
                ⚡ {lineLevelCount} line-level
              </span>
            )}
            {fileLevelCount > 0 && (
              <span className="cmr-count-badge cmr-count-medium">
                📄 {fileLevelCount} file-level
              </span>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!hasCollisions && (
        <div className="cmr-empty" id="concurrent-risk-empty">
          <span className="cmr-empty-icon">✅</span>
          <div>
            <div className="cmr-empty-title">No concurrent modifications detected</div>
            <div className="cmr-empty-sub">
              No other open PRs in this repo (updated within 30 days) modify the same files or line ranges as this PR.
            </div>
          </div>
        </div>
      )}

      {/* Collision cards */}
      {hasCollisions && (
        <div className="cmr-list">
          {concurrentIssues.map((issue, idx) => {
            const meta = COLLISION_META[issue.collisionType] || COLLISION_META['file-level'];
            return (
              <div
                key={issue.id || idx}
                className="cmr-card fade-in"
                style={{
                  background: meta.bg,
                  borderColor: meta.border,
                  animationDelay: `${idx * 0.08}s`,
                }}
                id={`cmr-card-${issue.id || idx}`}
              >
                {/* Card top row */}
                <div className="cmr-card-top">
                  <span className="cmr-card-icon">{meta.icon}</span>
                  <div className="cmr-card-badges">
                    <span
                      className="badge"
                      style={{ background: `${meta.color}20`, color: meta.color, border: `1px solid ${meta.color}40`, fontSize: '10px' }}
                      title={meta.tip}
                    >
                      {meta.label}
                    </span>
                    <span className="badge" style={{ fontSize: '10px' }}>diff-overlap</span>
                    <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>
                  </div>
                  <div className="cmr-card-date">
                    Updated {new Date(issue.lastPushedAt).toLocaleDateString()}
                  </div>
                </div>

                {/* File + branch */}
                <div className="cmr-card-file">
                  <span className="mono" style={{ color: 'var(--accent-blue)', fontSize: '13px' }}>
                    {issue.file}
                  </span>
                </div>

                {/* Line ranges */}
                <div className="cmr-ranges">
                  <LineRangeTag range={issue.lineRangeSelf}  label="This PR"      color="var(--accent-blue)" />
                  <span className="cmr-range-vs">vs</span>
                  <LineRangeTag range={issue.lineRangeOther} label={`#${issue.conflictingPRNumber}`} color={meta.color} />
                </div>

                {/* Sibling branch info */}
                <div className="cmr-sibling-info">
                  <span className="cmr-sibling-icon">🌿</span>
                  <div className="cmr-sibling-details">
                    <span className="cmr-sibling-branch mono">{issue.conflictingBranch}</span>
                    <span className="cmr-sibling-pr">
                      PR #{issue.conflictingPRNumber}{issue.conflictingPRTitle ? `: "${issue.conflictingPRTitle}"` : ''} by @{issue.conflictingAuthor}
                    </span>
                  </div>
                </div>

                {/* LLM explanation */}
                {issue.explanation && (
                  <div className="cmr-explanation">
                    <span className="cmr-expl-icon">🤖</span>
                    <span className="cmr-expl-text">{issue.explanation}</span>
                  </div>
                )}

                {/* Suggested fix */}
                <div className="cmr-fix">
                  <span className="cmr-fix-label">Action:</span>
                  <span className="cmr-fix-text">{issue.suggestedFix}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Heuristic disclaimer */}
      <div className="cmr-disclaimer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        Detection is based on unified-diff line ranges (±3 line buffer). These are <strong>not</strong> counted in the false-positive rate — overlap detection is deterministic from real diffs.
      </div>
    </div>
  );
}
