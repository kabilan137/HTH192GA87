import './ConflictReport.css';

const SEVERITY_META = {
  high:   { label: 'High',   emoji: '🔴', cls: 'sev-high' },
  medium: { label: 'Medium', emoji: '🟡', cls: 'sev-medium' },
  low:    { label: 'Low',    emoji: '🟢', cls: 'sev-low' },
  none:   { label: 'None',   emoji: '✅', cls: 'sev-none' },
};

export default function ConflictReport({ report, onBack, onNewRepo }) {
  if (!report) return null;

  const {
    owner, repo, pullNumber, prTitle, prUrl,
    overallConflictDetected,
    conflicts = [],
    summary,
    totalFilesAnalyzed,
    conflictingFilesCount,
    createdAt,
  } = report;

  const realConflicts = conflicts.filter((c) => c.mergeConflict);
  const safeFiles     = conflicts.filter((c) => !c.mergeConflict);

  return (
    <div className="cr-container fade-in">

      {/* ── Top nav ── */}
      <div className="cr-nav">
        <button className="btn btn-secondary btn-sm" onClick={onBack} id="cr-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to PRs
        </button>
        <div className="cr-nav-repo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          <span className="mono">{owner}/{repo}</span>
          <span className="cr-pr-num">#{pullNumber}</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onNewRepo} id="cr-new-repo-btn">
          New Repo
        </button>
      </div>

      {/* ── Hero banner ── */}
      <div className={`cr-hero card ${overallConflictDetected ? 'cr-hero-conflict' : 'cr-hero-clean'}`}>
        <div className="cr-hero-icon">
          {overallConflictDetected ? '⚠️' : '✅'}
        </div>
        <div className="cr-hero-body">
          <h1 className="cr-hero-title">
            {overallConflictDetected ? 'Merge Conflicts Detected' : 'No Merge Conflicts'}
          </h1>
          <p className="cr-hero-subtitle">
            {prUrl
              ? <a href={prUrl} target="_blank" rel="noreferrer" className="cr-pr-link">{prTitle}</a>
              : prTitle}
          </p>
          {summary && <p className="cr-hero-summary">{summary}</p>}
        </div>
        <div className="cr-hero-stats">
          <StatPill label="Files Analyzed" value={totalFilesAnalyzed} />
          <StatPill label="Conflicts" value={conflictingFilesCount} danger={conflictingFilesCount > 0} />
          <StatPill label="Clean Files" value={safeFiles.length} safe />
        </div>
      </div>

      {/* ── Notification banner (if any conflict) ── */}
      {realConflicts.length > 0 && (
        <div className="cr-notification-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <div>
            <strong>Collaborator Alert</strong>
            <div className="cr-notification-msgs">
              {realConflicts.map((c, i) =>
                c.notificationMessage ? (
                  <p key={i} className="cr-notification-msg">{c.notificationMessage}</p>
                ) : null
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict cards ── */}
      {realConflicts.length > 0 && (
        <section className="cr-section">
          <h2 className="cr-section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Conflicting Files ({realConflicts.length})
          </h2>
          <div className="cr-conflict-list">
            {realConflicts.map((c, i) => (
              <ConflictCard key={i} conflict={c} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* ── Clean files ── */}
      {safeFiles.length > 0 && (
        <section className="cr-section">
          <h2 className="cr-section-title cr-section-title-safe">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Auto-Mergeable Files ({safeFiles.length})
          </h2>
          <div className="cr-safe-list">
            {safeFiles.map((c, i) => (
              <div key={i} className="cr-safe-row">
                <span className="cr-safe-icon">✅</span>
                <span className="mono cr-safe-file">{c.file || '(unknown file)'}</span>
                <span className="cr-safe-reason">{c.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <div className="cr-footer">
        <span>Generated by CodeGuard AI Conflict Agent</span>
        {createdAt && <span>{new Date(createdAt).toLocaleString()}</span>}
      </div>
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────
function StatPill({ label, value, danger, safe }) {
  return (
    <div className={`cr-stat-pill ${danger ? 'cr-stat-danger' : safe ? 'cr-stat-safe' : ''}`}>
      <span className="cr-stat-val">{value ?? '—'}</span>
      <span className="cr-stat-label">{label}</span>
    </div>
  );
}

// ─── Single conflict card ─────────────────────────────────────────────────────
function ConflictCard({ conflict, index }) {
  const sev = SEVERITY_META[conflict.conflictSeverity] || SEVERITY_META.high;

  return (
    <div className={`cr-card card cr-card-${sev.cls}`} id={`conflict-card-${index}`}>

      {/* Header */}
      <div className="cr-card-header">
        <div className="cr-card-title-row">
          <span className={`cr-sev-badge cr-sev-${sev.cls}`}>
            {sev.emoji} {sev.label} Severity
          </span>
          <code className="cr-card-file">{conflict.file}</code>
          {conflict.functionName && (
            <code className="cr-card-fn">fn: {conflict.functionName}()</code>
          )}
          {conflict.startLine > 0 && (
            <span className="cr-card-lines">
              Lines {conflict.startLine}–{conflict.endLine}
            </span>
          )}
        </div>
      </div>

      {/* Reason */}
      <p className="cr-card-reason">{conflict.reason}</p>

      {/* Two-column: Dev A vs Dev B */}
      <div className="cr-changes-grid">
        <div className="cr-change-col cr-change-a">
          <div className="cr-change-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 8 8 12 12 16"/><line x1="16" y1="12" x2="8" y2="12"/>
            </svg>
            Base / main branch
          </div>
          <p className="cr-change-text">{conflict.developerAChanges || 'No description'}</p>
        </div>
        <div className="cr-change-col cr-change-b">
          <div className="cr-change-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 16 16 12 12 8"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            PR branch
          </div>
          <p className="cr-change-text">{conflict.developerBChanges || 'No description'}</p>
        </div>
      </div>

      {/* Recommended merged code */}
      {conflict.recommendedMergedCode && (
        <div className="cr-merged-code">
          <div className="cr-merged-code-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            Recommended Merged Code
          </div>
          <pre className="cr-code-block"><code>{conflict.recommendedMergedCode}</code></pre>
        </div>
      )}

      {/* Explanation */}
      {conflict.explanation && (
        <div className="cr-explanation">
          <div className="cr-explanation-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Merge Strategy Explanation
          </div>
          <p className="cr-explanation-text">{conflict.explanation}</p>
        </div>
      )}
    </div>
  );
}
