import { useState, useEffect } from 'react';
import './PullRequestList.css';

export default function PullRequestList({
  owner, repo, onAnalyze, onConflictCheck, onBack, onAnalyzeBranch,
  analyzeError, conflictError, analyzing, conflictChecking, selectedPR
}) {
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  // Branch selector state
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [branchPanelOpen, setBranchPanelOpen] = useState(false);

  // Commit-history state — shown when there are no open PRs to prove MCP works
  const [commits, setCommits] = useState(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState(null);
  const [commitsSource, setCommitsSource] = useState(null); // 'mcp' | 'rest'

  // Review Memory seeding state
  const [importingHistory, setImportingHistory] = useState(false);
  const [importHistoryResult, setImportHistoryResult] = useState(null);

  const handleImportHistory = async () => {
    if (!owner || !repo || importingHistory) return;
    setImportingHistory(true);
    setImportHistoryResult(null);
    try {
      const res = await fetch(`/api/repos/${owner}/${repo}/import-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setImportHistoryResult(
        data.message || `Imported ${data.imported} incident(s) from the last ${data.total || 20} merged PR(s).`
      );
    } catch (e) {
      setImportHistoryResult(`Import failed: ${e.message}`);
    } finally {
      setImportingHistory(false);
    }
  };

  // Fetch open PRs
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

  // Auto-fetch commits once we confirm there are no open PRs
  useEffect(() => {
    if (!loading && !error && prs.length === 0) {
      setCommitsLoading(true);
      setCommitsError(null);
      fetch(`/api/repos/${owner}/${repo}/commits?per_page=20`)
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setCommits(data.commits || []);
          setCommitsSource(data.source || 'rest');
        })
        .catch((e) => setCommitsError(e.message))
        .finally(() => setCommitsLoading(false));
    }
  }, [loading, error, prs.length, owner, repo]);
  // Fetch branches lazily when panel opens
  useEffect(() => {
    if (!branchPanelOpen || branches.length > 0) return;
    setBranchesLoading(true);
    fetch(`/api/repos/${owner}/${repo}/branches`)
      .then((r) => r.json())
      .then((data) => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setBranchesLoading(false));
  }, [branchPanelOpen, owner, repo, branches.length]);

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
        <div className="pr-list-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2>Open Pull Requests</h2>
            {!loading && !error && (
              <div className="pr-count-badge">{prs.length} open</div>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleImportHistory}
            disabled={importingHistory}
            id="pr-list-import-history-btn"
            title="Import resolved review comments from merged PRs as searchable institutional memory"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {importingHistory ? (
              <>
                <span className="spinner-border spinner-border-sm" />
                Importing PR history...
              </>
            ) : (
              <>
                <span>🧠</span> Import PR history
              </>
            )}
          </button>
        </div>

        {importHistoryResult && (
          <div
            style={{
              padding: '8px 14px',
              margin: '12px 0',
              borderRadius: '8px',
              fontSize: '12px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#60a5fa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{importHistoryResult}</span>
            <button
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              onClick={() => setImportHistoryResult(null)}
            >
              ✕
            </button>
          </div>
        )}

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

        {conflictError && (
          <div className="pr-error-banner" style={{ borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <strong>Conflict check failed:</strong> {conflictError}
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

        {/* When there are no open PRs, fall back to commit history to prove MCP connectivity */}
        {!loading && !error && prs.length === 0 && (
          <CommitHistoryFallback
            owner={owner}
            repo={repo}
            commits={commits}
            loading={commitsLoading}
            error={commitsError}
            source={commitsSource}
          />
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
              onConflictCheck={onConflictCheck}
              isAnalyzing={analyzing && selectedPR?.number === pr.number}
              isConflictChecking={conflictChecking && selectedPR?.number === pr.number}
              disabled={analyzing || conflictChecking}
            />
          ))}
        </div>
      </div>

      {/* Branch Selector Panel — Step 22 */}
      <BranchSelector
        owner={owner}
        repo={repo}
        branches={branches}
        branchesLoading={branchesLoading}
        panelOpen={branchPanelOpen}
        onToggle={() => setBranchPanelOpen((v) => !v)}
        selectedBranch={selectedBranch}
        onSelectBranch={setSelectedBranch}
        branchFilter={branchFilter}
        onBranchFilterChange={setBranchFilter}
        onAnalyzeBranch={onAnalyzeBranch}
        analyzing={analyzing}
      />


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

// ─── Commit History Fallback Panel ───────────────────────────────────────────

function CommitHistoryFallback({ owner, repo, commits, loading, error, source }) {
  return (
    <div className="commit-fallback">
      {/* Header: explains no PRs + shows MCP/REST status */}
      <div className="commit-fallback-header">
        <div className="commit-fallback-title-row">
          <span className="commit-fallback-icon">🎉</span>
          <div>
            <p className="commit-fallback-title">No open pull requests</p>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '2px' }}>
              {owner}/{repo} has no open PRs — fetching commit history via the MCP pipeline to confirm connectivity.
            </p>
          </div>
        </div>

        {/* Source badge — appears once data arrives */}
        {source && (
          <div className={`mcp-source-badge ${source === 'mcp' ? 'mcp-badge-mcp' : 'mcp-badge-rest'}`}>
            {source === 'mcp' ? (
              <>
                <span className="mcp-dot mcp-dot-green" />
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
                MCP Active — GitHub MCP Server (Docker)
              </>
            ) : (
              <>
                <span className="mcp-dot mcp-dot-amber" />
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                REST Fallback — GitHub REST API
              </>
            )}
          </div>
        )}
      </div>

      {/* Commit list */}
      <div className="commit-list-section">
        <div className="commit-list-heading">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <line x1="3" y1="12" x2="9" y2="12" />
            <line x1="15" y1="12" x2="21" y2="12" />
          </svg>
          Recent Commits
          {commits && <span className="commit-count-chip">{commits.length}</span>}
        </div>

        {loading && (
          <div className="commit-skeleton-list">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="commit-skeleton-row">
                <div className="skeleton" style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: '13px', width: '70%' }} />
                  <div className="skeleton" style={{ height: '11px', width: '40%', marginTop: '5px' }} />
                </div>
                <div className="skeleton" style={{ width: '55px', height: '22px', borderRadius: '6px' }} />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="commit-error">
            <span>⚠️</span>
            <span>Could not load commit history: {error}</span>
          </div>
        )}

        {!loading && !error && commits && commits.length === 0 && (
          <div className="commit-empty">No commits found.</div>
        )}

        {!loading && !error && commits && commits.length > 0 && (
          <div className="commit-rows">
            {commits.map((c, idx) => (
              <CommitRow key={c.sha || idx} commit={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommitRow({ commit }) {
  const date = commit.date
    ? new Date(commit.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="commit-row" id={`commit-${commit.shortSha}`}>
      {/* Avatar or initials */}
      <div className="commit-avatar">
        {commit.authorAvatar ? (
          <img src={commit.authorAvatar} alt={commit.author} className="commit-avatar-img" />
        ) : (
          <div className="commit-avatar-initials">
            {(commit.author || '?')[0].toUpperCase()}
          </div>
        )}
      </div>

      <div className="commit-body">
        <div className="commit-message">{commit.message}</div>
        <div className="commit-meta">
          <span className="commit-author">{commit.authorLogin || commit.author}</span>
          {date && <span className="commit-date">{date}</span>}
        </div>
      </div>

      <a
        href={commit.url}
        target="_blank"
        rel="noreferrer"
        className="commit-sha-chip"
        title="View on GitHub"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </svg>
        {commit.shortSha}
      </a>
    </div>
  );
}

function PRItem({ pr, onAnalyze, onConflictCheck, isAnalyzing, isConflictChecking, disabled }) {
  const createdAt = pr.createdAt ? new Date(pr.createdAt).toLocaleDateString() : '';

  return (
    <div className={`pr-item ${disabled && !isAnalyzing && !isConflictChecking ? 'pr-item-disabled' : ''}`}>
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

      {/* Action buttons */}
      <div className="pr-item-actions">
        {/* Conflict check button */}
        <button
          id={`conflict-btn-${pr.number}`}
          className="btn btn-secondary btn-sm pr-conflict-btn"
          onClick={() => onConflictCheck && onConflictCheck(pr)}
          disabled={disabled}
          title="Check for merge conflicts between this PR and main branch"
        >
          {isConflictChecking ? (
            <>
              <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderTopColor: '#f59e0b' }} />
              Checking...
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Conflicts
            </>
          )}
        </button>

        {/* Analyze button */}
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
    </div>
  );
}

// ─── Branch Selector Panel ────────────────────────────────────────────────────

function BranchSelector({
  branches, branchesLoading, panelOpen, onToggle,
  selectedBranch, onSelectBranch, branchFilter, onBranchFilterChange,
  onAnalyzeBranch, analyzing,
}) {
  const filtered = branches.filter((b) =>
    !branchFilter || b.name.toLowerCase().includes(branchFilter.toLowerCase())
  );

  return (
    <div className="card" style={{ marginTop: '16px', padding: 0, overflow: 'hidden' }} id="branch-selector-panel">
      {/* Toggle header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', padding: '14px 20px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)',
          fontSize: '14px', fontWeight: 600,
        }}
        id="branch-selector-toggle"
      >
        <span style={{ fontSize: '16px' }}>🌿</span>
        <span style={{ flex: 1 }}>Analyze a Branch (no PR required)</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '8px' }}>
          Run full analysis on any pushed branch
        </span>
        <span style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: panelOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {panelOpen && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)' }}>
          {branchesLoading && (
            <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: '13px' }}>Loading branches…</div>
          )}
          {!branchesLoading && branches.length > 0 && (
            <>
              <div style={{ marginTop: '14px', marginBottom: '8px' }}>
                <input
                  id="branch-filter-input"
                  type="text"
                  placeholder="Filter branches…"
                  value={branchFilter}
                  onChange={(e) => onBranchFilterChange(e.target.value)}
                  style={{
                    width: '100%', padding: '7px 12px', borderRadius: '8px',
                    border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
                  }}
                />
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                {filtered.map((b) => (
                  <div
                    key={b.name}
                    onClick={() => onSelectBranch(b.name)}
                    style={{
                      padding: '9px 14px', cursor: 'pointer', fontSize: '13px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: selectedBranch === b.name ? 'rgba(99,102,241,0.15)' : 'transparent',
                      borderLeft: selectedBranch === b.name ? '3px solid var(--accent-blue)' : '3px solid transparent',
                      color: selectedBranch === b.name ? 'var(--accent-blue)' : 'var(--text-primary)',
                    }}
                    id={`branch-option-${b.name.replace(/[^a-z0-9]/gi, '-')}`}
                  >
                    <span className="mono">{b.name}</span>
                    {b.lastPushedAt && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Date(b.lastPushedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                id="analyze-branch-btn"
                className="btn btn-primary"
                style={{ marginTop: '12px', width: '100%' }}
                disabled={!selectedBranch || analyzing}
                onClick={() => selectedBranch && onAnalyzeBranch && onAnalyzeBranch(selectedBranch)}
              >
                {analyzing ? 'Analyzing…' : `🔍 Analyze Branch${selectedBranch ? `: ${selectedBranch}` : ''}`}
              </button>
            </>
          )}
          {!branchesLoading && branches.length === 0 && (
            <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: '13px' }}>No branches found.</div>
          )}
        </div>
      )}
    </div>
  );
}
