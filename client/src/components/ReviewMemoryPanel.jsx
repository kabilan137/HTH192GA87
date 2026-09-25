import { useState, useEffect } from 'react';
import './ReviewMemoryPanel.css';
import { apiFetch } from '../api.js';

export default function ReviewMemoryPanel({ issues = [], owner, repo }) {
  const [incidentsCount, setIncidentsCount] = useState(null);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [appliedFixes, setAppliedFixes] = useState({});

  // Filter issues for review-memory matches
  const memoryIssues = issues.filter(
    (i) => i.category === 'Known Pattern - Previously Flagged' || i.source === 'review-history-match'
  );

  // Check how many incidents exist for this repository
  const checkStoredIncidents = async () => {
    if (!owner || !repo) return;
    setLoadingIncidents(true);
    try {
      const res = await apiFetch(`/api/repos/${owner}/${repo}/incidents`);
      const data = await res.json();
      if (typeof data.count === 'number') {
        setIncidentsCount(data.count);
      }
    } catch {
      // Ignore network errors
    } finally {
      setLoadingIncidents(false);
    }
  };

  useEffect(() => {
    checkStoredIncidents();
  }, [owner, repo]);

  // Handle "Import PR history"
  const handleImportHistory = async () => {
    if (!owner || !repo || importing) return;
    setImporting(true);
    setImportResult(null);

    try {
      const res = await apiFetch(`/api/repos/${owner}/${repo}/import-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setImportResult({
        success: true,
        message: data.message || `Imported ${data.imported} incident(s) from the last ${data.total || 20} merged PR(s).`,
      });
      setIncidentsCount((prev) => (prev || 0) + (data.imported || 0));
    } catch (e) {
      setImportResult({
        success: false,
        message: `Import failed: ${e.message}`,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleApplySuggestion = (issueId, code) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setAppliedFixes((prev) => ({ ...prev, [issueId]: true }));
    setTimeout(() => {
      setAppliedFixes((prev) => ({ ...prev, [issueId]: false }));
    }, 3000);
  };

  return (
    <div className="rmp-panel card">
      {/* Header */}
      <div className="rmp-header">
        <div className="rmp-header-left">
          <div className="rmp-header-icon">🧠</div>
          <div>
            <div className="rmp-title">
              Review Memory & Precedents
              <span className="rmp-heuristic-pill">Similarity Heuristic (Worth a Look)</span>
            </div>
            <div className="rmp-subtitle">
              Grounds reviews in historical resolved PR comments from this team. High similarity flags patterns previously caught and fixed in merged PRs.
            </div>
          </div>
        </div>

        <div className="rmp-header-actions">
          <button
            className="btn btn-secondary rmp-import-btn"
            onClick={handleImportHistory}
            disabled={importing}
            id="import-pr-history-btn"
          >
            {importing ? (
              <>
                <span className="spinner-border spinner-border-sm" />
                Importing PR history...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Import PR history
              </>
            )}
          </button>
        </div>
      </div>

      {/* Import Result Notification */}
      {importResult && (
        <div className={`rmp-import-result ${importResult.success ? '' : 'warn'}`}>
          <span>{importResult.message}</span>
          <button
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            onClick={() => setImportResult(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty State 1: No incidents in repo at all */}
      {incidentsCount === 0 && memoryIssues.length === 0 && (
        <div className="rmp-empty-state">
          <div className="rmp-empty-icon">📭</div>
          <div className="rmp-empty-title">Institutional Memory is Empty</div>
          <p className="rmp-empty-desc">
            No resolved review comment threads have been imported for <span className="mono">{owner}/{repo}</span> yet.
            Click &ldquo;Import PR history&rdquo; above to scan merged PRs and seed institutional review memory.
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleImportHistory}
            disabled={importing}
          >
            {importing ? 'Importing PR history...' : 'Import PR history now'}
          </button>
        </div>
      )}

      {/* Empty State 2: Repo has incidents, but none matched this PR */}
      {incidentsCount > 0 && memoryIssues.length === 0 && (
        <div className="rmp-empty-state">
          <div className="rmp-empty-icon">🛡️</div>
          <div className="rmp-empty-title">No Recurring Pattern Collisions</div>
          <p className="rmp-empty-desc">
            Scanned against {incidentsCount} stored review incident(s) from merged PRs. No past reviewer-flagged patterns matched this code change above the 82% similarity threshold.
          </p>
        </div>
      )}

      {/* Matched Incident Cards */}
      {memoryIssues.length > 0 && (
        <div className="rmp-cards-list">
          {memoryIssues.map((issue) => {
            const isApplied = appliedFixes[issue.id];
            const simPercent = Math.round(
              (issue.similarityScore ? issue.similarityScore : (issue.confidence || 0.85)) * 100
            );

            return (
              <div key={issue.id} className="rmp-card">
                <div className="rmp-card-header">
                  <div className="rmp-card-loc">
                    <span className="mono">{issue.file}:{issue.line}</span>
                    <span className="badge badge-medium">Known Pattern</span>
                  </div>
                  <div className="rmp-sim-badge">
                    ⚡ {simPercent}% Similarity Match
                  </div>
                </div>

                {/* Precedent reference */}
                <div className="rmp-precedent-ref">
                  <span>🏛️ Precedent:</span>
                  <span>Flagged by <strong>@{issue.matchedReviewerLogin || 'reviewer'}</strong> in <strong>PR #{issue.matchedPrNumber || 'history'}</strong></span>
                </div>

                {/* Explanation */}
                <div className="rmp-explanation">
                  {issue.explanation}
                </div>

                {/* Drafted fix */}
                {issue.suggestedFix && (
                  <div className="rmp-fix-box">
                    <div className="rmp-fix-label">Precedent-Grounded Fix Suggestion</div>
                    <pre className="rmp-fix-code">{issue.suggestedFix}</pre>
                  </div>
                )}

                {/* Card footer */}
                <div className="rmp-card-footer">
                  <span className="rmp-heuristic-pill">
                    Included in False-Positive Rate calculation (probabilistic)
                  </span>
                  <button
                    className={`rmp-apply-btn ${isApplied ? 'applied' : ''}`}
                    onClick={() => handleApplySuggestion(issue.id, issue.suggestedFix)}
                  >
                    {isApplied ? (
                      <>
                        ✓ Copied to clipboard!
                      </>
                    ) : (
                      <>
                        📋 Apply as suggestion
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
