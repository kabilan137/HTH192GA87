import { useState, useEffect } from 'react';
import './PullRequestList.css';

export default function PullRequestList({
  owner, repo, onAnalyze, onBack, analyzeError, analyzing, selectedPR
}) {
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/repos/${owner}/${repo}/pulls`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPrs(data.prs || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [owner, repo]);

  const filtered = prs.filter(
    (pr) =>
      !filter ||
      pr.title.toLowerCase().includes(filter.toLowerCase()) ||
      String(pr.number).includes(filter) ||
      (pr.user || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="pr-list-container">
      <div className="pr-list-header">
        <button className="btn btn-secondary btn-sm" onClick={onBack} id="pr-list-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="pr-list-repo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          <span className="mono">{owner}/{repo}</span>
        </div>
      </div>

      <div className="card pr-list-card">
        <div className="pr-list-top">
          <h2>Open Pull Requests</h2>
          {!loading && !error && (
            <div className="pr-count-badge">{prs.length} open</div>
          )}
        </div>

        {!loading && !error && prs.length > 0 && (
          <div className="pr-filter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="pr-filter-input"
              type="text"
              className="pr-filter-input"
              placeholder="Filter PRs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}

        {analyzeError && (
          <div className="pr-error-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <strong>Analysis failed:</strong> {analyzeError}
          </div>
        )}

        {loading && (
          <div className="pr-loading">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="pr-skeleton">
                <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '8px' }} />
                <div className="pr-skeleton-lines">
                  <div className="skeleton" style={{ height: '14px', width: '60%' }} />
                  <div className="skeleton" style={{ height: '12px', width: '40%', marginTop: '6px' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="pr-empty">
            <span className="pr-empty-icon">⚠️</span>
            <p>Failed to load pull requests</p>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>{error}</p>
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div className="pr-empty">
            <span className="pr-empty-icon">🎉</span>
            <p>No open pull requests</p>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
              {owner}/{repo} has no open PRs right now.
            </p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && prs.length > 0 && (
          <div className="pr-empty">
            <span className="pr-empty-icon">🔍</span>
            <p>No matching PRs</p>
          </div>
        )}

        <div className="pr-items">
          {filtered.map((pr) => (
            <PRItem
              key={pr.number}
              pr={pr}
              onAnalyze={onAnalyze}
              isAnalyzing={analyzing && selectedPR?.number === pr.number}
              disabled={analyzing}
            />
          ))}
        </div>
      </div>

      <div className="info-note warn-note mt-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          <strong>JS-Only Static Analysis:</strong> ESLint static analysis runs only on <code>.js</code> and <code>.jsx</code> files.
          Other file types (TypeScript, Python, etc.) will receive AI review only.
        </span>
      </div>
    </div>
  );
}

function PRItem({ pr, onAnalyze, isAnalyzing, disabled }) {
  const createdAt = pr.createdAt ? new Date(pr.createdAt).toLocaleDateString() : '';

  return (
    <div className={`pr-item ${disabled && !isAnalyzing ? 'pr-item-disabled' : ''}`}>
      <div className="pr-item-number">#{pr.number}</div>
      <div className="pr-item-body">
        <div className="pr-item-title">{pr.title}</div>
        <div className="pr-item-meta">
          <span>by {pr.user}</span>
          {createdAt && <span>opened {createdAt}</span>}
          {pr.draft && <span className="badge badge-low" style={{ fontSize: '10px' }}>Draft</span>}
          {pr.headRef && (
            <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {pr.headRef} → {pr.baseRef}
            </span>
          )}
          {pr.changedFiles != null && (
            <span>{pr.changedFiles} file{pr.changedFiles !== 1 ? 's' : ''}</span>
          )}
          {pr.additions != null && (
            <span>
              <span style={{ color: 'var(--low)' }}>+{pr.additions}</span>
              {' '}
              <span style={{ color: 'var(--critical)' }}>-{pr.deletions}</span>
            </span>
          )}
        </div>
      </div>
      <button
        id={`analyze-btn-${pr.number}`}
        className="btn btn-primary btn-sm pr-analyze-btn"
        onClick={() => onAnalyze(pr)}
        disabled={disabled}
      >
        {isAnalyzing ? (
          <>
            <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
            Analyzing...
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Analyze
          </>
        )}
      </button>
    </div>
  );
}
