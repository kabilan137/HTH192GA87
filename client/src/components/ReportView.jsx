import { useState } from 'react';
import RiskGauge from './RiskGauge.jsx';
import FalsePositiveBadge from './FalsePositiveBadge.jsx';
import TopThreePanel from './TopThreePanel.jsx';
import './ReportView.css';

const CATEGORY_META = {
  'Bug - Certain':           { color: 'bug',      icon: '🐛', label: 'Bug — Certain' },
  'Security Vulnerability':  { color: 'security', icon: '🔒', label: 'Security Vulnerability' },
  'Performance Risk':        { color: 'perf',     icon: '⚡', label: 'Performance Risk' },
  'Code Smell - Stylistic':  { color: 'style',    icon: '✨', label: 'Code Smell — Stylistic' },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export default function ReportView({ report, llmSummary, jsOnlyNote, onBack, onNewRepo }) {
  const issues = report.issues || [];
  const topIds = new Set(report.topThreeIssueIds || []);

  const sortedIssues = [...issues].sort((a, b) => {
    const aTop = topIds.has(a.id) ? -1 : 0;
    const bTop = topIds.has(b.id) ? -1 : 0;
    if (aTop !== bTop) return aTop - bTop;
    return (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4);
  });

  const topThreeIssues = issues.filter((i) => topIds.has(i.id));

  const categoryBreakdown = issues.reduce((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="report-view">
      {/* Breadcrumb */}
      <div className="report-breadcrumb">
        <button className="btn btn-secondary btn-sm" onClick={onBack} id="report-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to PRs
        </button>
        <span className="report-breadcrumb-sep">›</span>
        <span className="mono text-secondary" style={{ fontSize: '13px' }}>
          {report.owner}/{report.repo}
        </span>
        <span className="report-breadcrumb-sep">›</span>
        <span className="text-secondary" style={{ fontSize: '13px' }}>PR #{report.pullNumber}</span>
      </div>

      {/* PR Title */}
      <div className="report-pr-header">
        <div className="report-pr-badge">
          <span className="report-pr-dot" />
          Analysis Report
        </div>
        <h1 className="report-pr-title">{report.prTitle}</h1>
        <div className="report-pr-meta">
          <span className="mono">#{report.pullNumber}</span>
          <span>·</span>
          <span className="mono">{report.owner}/{report.repo}</span>
          <span>·</span>
          <span>{new Date(report.createdAt).toLocaleString()}</span>
          {report.prUrl && (
            <>
              <span>·</span>
              <a href={report.prUrl} target="_blank" rel="noopener noreferrer" className="report-gh-link">
                View on GitHub ↗
              </a>
            </>
          )}
        </div>
      </div>

      {jsOnlyNote && (
        <div className="info-note warn-note mb-4">
          <span>{jsOnlyNote}</span>
        </div>
      )}

      {/* Score Row */}
      <div className="report-score-row">
        <RiskGauge score={report.riskScore} />
        <FalsePositiveBadge
          rate={report.falsePositiveRate}
          llmOnlyCount={report.llmIssuesCount || 0}
          totalCount={report.totalIssues || issues.length}
          staticOnlyCount={report.staticIssuesCount || 0}
          combinedCount={report.combinedIssuesCount || 0}
        />
        <div className="report-summary-stats card">
          <h3 className="report-stats-title">Issue Breakdown</h3>
          <div className="report-stats-grid">
            <StatItem label="Total Issues" value={issues.length} />
            <StatItem label="JS Files Analyzed" value={(report.analyzedFiles || []).length} />
            {Object.entries(categoryBreakdown).map(([cat, count]) => {
              const meta = CATEGORY_META[cat];
              return (
                <StatItem
                  key={cat}
                  label={meta?.label || cat}
                  value={count}
                  color={meta?.color}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* LLM Summary */}
      {llmSummary && (
        <div className="report-llm-summary card">
          <div className="report-llm-header">
            <span className="report-llm-icon">🤖</span>
            <h3>AI Review Summary</h3>
          </div>
          <p className="report-llm-text">{llmSummary}</p>
        </div>
      )}

      {/* Top 3 Must-Fix */}
      {topThreeIssues.length > 0 && (
        <TopThreePanel issues={topThreeIssues} />
      )}

      {/* Full Issue List */}
      <div className="report-issues-section">
        <div className="report-issues-header">
          <h2>All Issues ({issues.length})</h2>
          <div className="report-issues-legend">
            <span className="badge badge-bug">🐛 Bug</span>
            <span className="badge badge-security">🔒 Security</span>
            <span className="badge badge-perf">⚡ Performance</span>
            <span className="badge badge-style">✨ Stylistic</span>
          </div>
        </div>

        {issues.length === 0 ? (
          <div className="report-no-issues card">
            <span style={{ fontSize: '40px' }}>✅</span>
            <h3>No Issues Found</h3>
            <p className="text-muted">This PR looks clean! No bugs, security issues, or performance risks were detected.</p>
          </div>
        ) : (
          <div className="report-issue-list">
            {sortedIssues.map((issue, idx) => (
              <IssueCard
                key={issue.id || idx}
                issue={issue}
                isTop={topIds.has(issue.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Analyzed Files */}
      {report.analyzedFiles?.length > 0 && (
        <div className="card report-files-card mt-4">
          <h3>Analyzed JavaScript Files</h3>
          <div className="report-files-list mt-2">
            {report.analyzedFiles.map((f) => (
              <span key={f} className="report-file-tag mono">{f}</span>
            ))}
          </div>
          <p className="text-muted mt-2" style={{ fontSize: '12px' }}>
            ⚠️ Static analysis (ESLint) is restricted to .js/.jsx files only — a known prototype limitation.
          </p>
        </div>
      )}

      <div className="report-actions">
        <button className="btn btn-secondary" onClick={onBack} id="report-analyze-another-btn">
          Analyze Another PR
        </button>
        <button className="btn btn-primary" onClick={onNewRepo} id="report-new-repo-btn">
          New Repository
        </button>
      </div>
    </div>
  );
}

function StatItem({ label, value, color }) {
  return (
    <div className={`report-stat-item ${color ? `report-stat-${color}` : ''}`}>
      <span className="report-stat-value">{value}</span>
      <span className="report-stat-label">{label}</span>
    </div>
  );
}

export function IssueCard({ issue, isTop }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[issue.category] || { color: 'style', icon: '•', label: issue.category };

  return (
    <div className={`issue-card card ${isTop ? 'issue-card-top' : ''} issue-severity-${issue.severity}`}>
      {isTop && <div className="issue-top-marker">🚨 Must Fix</div>}

      <div className="issue-card-header" onClick={() => setExpanded((v) => !v)}>
        <div className="issue-card-left">
          <span className="issue-icon">{meta.icon}</span>
          <div className="issue-card-info">
            <div className="issue-card-title">
              <span className={`badge badge-${meta.color}`}>{meta.label}</span>
              <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>
              <SourceBadge source={issue.source} />
            </div>
            <div className="issue-card-location">
              <span className="mono issue-file">{issue.file}</span>
              <span className="issue-line">line {issue.line}</span>
              <span className="issue-confidence">
                {Math.round((issue.confidence || 0) * 100)}% confidence
              </span>
            </div>
          </div>
        </div>
        <div className="issue-card-right">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              color: 'var(--text-muted)',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="issue-card-body fade-in">
          <div className="issue-explanation">
            <h4>Explanation</h4>
            <p>{issue.explanation}</p>
          </div>
          <div className="issue-fix">
            <h4>Suggested Fix</h4>
            <pre className="issue-fix-code"><code>{issue.suggestedFix}</code></pre>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }) {
  const map = {
    'static+llm':  { cls: 'badge-static-llm',  icon: '🔬', label: 'Static + AI' },
    'llm-only':    { cls: 'badge-llm-only',     icon: '🤖', label: 'AI Only' },
    'static-only': { cls: 'badge-static-only',  icon: '🔧', label: 'Static Only' },
  };
  const m = map[source] || map['llm-only'];
  return <span className={`badge ${m.cls}`}>{m.icon} {m.label}</span>;
}
