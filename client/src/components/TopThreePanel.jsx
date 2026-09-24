import './TopThreePanel.css';

const CATEGORY_META = {
  'Bug - Certain':           { icon: '🐛', color: 'var(--bug-color)' },
  'Security Vulnerability':  { icon: '🔒', color: 'var(--security-color)' },
  'Performance Risk':        { icon: '⚡', color: 'var(--performance-color)' },
  'Code Smell - Stylistic':  { icon: '✨', color: 'var(--style-color)' },
};

export default function TopThreePanel({ issues }) {
  return (
    <div className="top3-panel" id="top-three-panel">
      <div className="top3-header">
        <span className="top3-icon">🚨</span>
        <div>
          <h2 className="top3-title">Top 3 Must-Fix Issues</h2>
          <p className="top3-subtitle">
            Ranked by impact: category weight × confidence × severity
          </p>
        </div>
      </div>
      <div className="top3-list">
        {issues.map((issue, idx) => {
          const meta = CATEGORY_META[issue.category] || { icon: '•', color: 'var(--text-muted)' };
          return (
            <div
              key={issue.id || idx}
              className="top3-item fade-in"
              style={{ animationDelay: `${idx * 0.1}s`, borderLeftColor: meta.color }}
              id={`top3-issue-${idx + 1}`}
            >
              <div className="top3-rank" style={{ color: meta.color }}>#{idx + 1}</div>
              <div className="top3-icon-cat">{meta.icon}</div>
              <div className="top3-content">
                <div className="top3-badges">
                  <span className="badge badge-critical" style={{ background: `${meta.color}20`, color: meta.color, borderColor: `${meta.color}50` }}>
                    {issue.category}
                  </span>
                  <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>
                </div>
                <div className="top3-location">
                  <span className="mono" style={{ fontSize: '12px', color: 'var(--accent-blue)' }}>
                    {issue.file}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    line {issue.line}
                  </span>
                </div>
                <p className="top3-explanation">{issue.explanation}</p>
                <div className="top3-fix">
                  <span className="top3-fix-label">Fix:</span>
                  <span className="top3-fix-text">{issue.suggestedFix?.slice(0, 200)}{issue.suggestedFix?.length > 200 ? '...' : ''}</span>
                </div>
              </div>
              <div className="top3-confidence">
                <div className="top3-conf-num">{Math.round((issue.confidence || 0) * 100)}%</div>
                <div className="top3-conf-label">confidence</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
