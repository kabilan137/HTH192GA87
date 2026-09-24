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

const TIER_META = {
  high:   { label: 'High Risk',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
  medium: { label: 'Med Risk',    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  low:    { label: 'Low Risk',    color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

function FutureRiskBadge({ tier }) {
  if (!tier) return null;
  const m = TIER_META[tier] || TIER_META.low;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: '9px',
        fontSize: '10px',
        fontWeight: 700,
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.color}50`,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
      }}
    >
      {tier === 'high' ? '🔴' : tier === 'medium' ? '🟡' : '⚪'} {m.label}
    </span>
  );
}

function PRStatusBadge({ siblingHasOpenPr }) {
  if (siblingHasOpenPr) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 7px',
          borderRadius: '9px',
          fontSize: '10px',
          fontWeight: 600,
          background: 'rgba(59,130,246,0.15)',
          color: '#3b82f6',
          border: '1px solid rgba(59,130,246,0.4)',
        }}
      >
        🔁 Open PR
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: '9px',
        fontSize: '10px',
        fontWeight: 600,
        background: 'rgba(168,85,247,0.15)',
        color: '#a855f7',
        border: '1px solid rgba(168,85,247,0.4)',
      }}
    >
      🌿 No PR yet
    </span>
  );
}

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
  // Accept both source values: old 'diff-overlap' (history) and new 'branch-diff-overlap'
  const concurrentIssues = (issues || []).filter(
    (i) =>
      i.category === 'Concurrent Modification Risk' &&
      (i.source === 'branch-diff-overlap' || i.source === 'diff-overlap')
  );

  const hasCollisions = concurrentIssues.length > 0;
  const lineLevelCount = concurrentIssues.filter((i) => i.collisionType === 'line-level').length;
  const fileLevelCount = concurrentIssues.filter((i) => i.collisionType === 'file-level').length;
  const noPRCount = concurrentIssues.filter((i) => i.siblingHasOpenPr === false).length;

  return (
    <div className="cmr-panel" id="concurrent-risk-panel">
      {/* Header */}
      <div className="cmr-header">
        <div className="cmr-header-left">
          <span className="cmr-header-icon">🔀</span>
          <div>
            <h2 className="cmr-title">Concurrent Modification Risk</h2>
            <p className="cmr-subtitle">
              Heuristic detection — line-range overlap ±3 lines between this branch and any active sibling branch (with or without a PR).
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
            {noPRCount > 0 && (
              <span className="cmr-count-badge" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                🌿 {noPRCount} no-PR branch{noPRCount > 1 ? 'es' : ''}
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
              No active branches (pushed within 14 days) in this repo modify the same files or line ranges as this branch.
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
                    {/* PR status badge — NEW */}
                    <PRStatusBadge siblingHasOpenPr={issue.siblingHasOpenPr} />
                    {/* Future risk tier badge — NEW */}
                    <FutureRiskBadge tier={issue.futureRiskTier} />
                    <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>
                  </div>
                  <div className="cmr-card-date">
                    {issue.lastPushedAt
                      ? `Pushed ${new Date(issue.lastPushedAt).toLocaleDateString()}`
                      : 'Date unknown'}
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
                  <LineRangeTag range={issue.lineRangeSelf}  label="This branch"  color="var(--accent-blue)" />
                  <span className="cmr-range-vs">vs</span>
                  <LineRangeTag
                    range={issue.lineRangeOther}
                    label={issue.conflictingPRNumber ? `PR #${issue.conflictingPRNumber}` : issue.conflictingBranch}
                    color={meta.color}
                  />
                </div>

                {/* Sibling branch info */}
                <div className="cmr-sibling-info">
                  <span className="cmr-sibling-icon">🌿</span>
                  <div className="cmr-sibling-details">
                    <span className="cmr-sibling-branch mono">{issue.conflictingBranch}</span>
                    <span className="cmr-sibling-pr">
                      {issue.siblingHasOpenPr
                        ? <>PR #{issue.conflictingPRNumber}{issue.conflictingPRTitle ? `: "${issue.conflictingPRTitle}"` : ''} by @{issue.conflictingAuthor}</>
                        : <>No PR yet · @{issue.conflictingAuthor}</>
                      }
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
        Detection is based on unified-diff line ranges (±3 line buffer) across all active branches (pushed within 14 days). These are <strong>not</strong> counted in the false-positive rate — overlap detection is deterministic from real diffs, not LLM inference.
      </div>
    </div>
  );
}
