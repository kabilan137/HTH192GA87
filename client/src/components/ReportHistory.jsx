import { useState, useEffect } from 'react';
import './ReportHistory.css';

function getRiskColor(score) {
  if (score >= 75) return 'var(--critical)';
  if (score >= 50) return 'var(--high)';
  if (score >= 25) return 'var(--medium)';
  return 'var(--low)';
}

export default function ReportHistory({ onViewReport, onBack }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/reports')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReports(data.reports || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleView = async (reportId) => {
    try {
      const res = await fetch(`/api/reports/${reportId}`);
      const data = await res.json();
      if (data.report) {
        onViewReport(data.report);
      }
    } catch (e) {
      alert('Failed to load report: ' + e.message);
    }
  };

  const handleDelete = async (reportId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this report?')) return;
    try {
      await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
      setReports((prev) => prev.filter((r) => r._id !== reportId));
    } catch (e) {
      alert('Failed to delete report');
    }
  };

  return (
    <div className="history-container">
      <div className="history-header">
        <button className="btn btn-secondary btn-sm" onClick={onBack} id="history-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className="history-title">Analysis History</h1>
        <button className="btn btn-secondary btn-sm" onClick={load} id="history-refresh-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {loading && (
        <div className="history-loading">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card history-skeleton">
              <div className="skeleton" style={{ height: '16px', width: '40%', marginBottom: '8px' }} />
              <div className="skeleton" style={{ height: '12px', width: '25%' }} />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--critical)' }}>
          Failed to load history: {error}
        </div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="card history-empty">
          <span style={{ fontSize: '40px' }}>📋</span>
          <h3>No Analyses Yet</h3>
          <p className="text-muted">Analyze a pull request to see reports here.</p>
        </div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div className="history-list">
          {reports.map((report) => (
            <div
              key={report._id}
              className="card history-item"
              onClick={() => handleView(report._id)}
              id={`history-item-${report._id}`}
            >
              <div className="history-item-left">
                <div
                  className="history-risk-badge"
                  style={{
                    color: getRiskColor(report.riskScore),
                    background: `${getRiskColor(report.riskScore)}18`,
                    borderColor: `${getRiskColor(report.riskScore)}40`,
                  }}
                >
                  {report.riskScore}
                </div>
              </div>
              <div className="history-item-body">
                <div className="history-item-title">{report.prTitle}</div>
                <div className="history-item-meta">
                  <span className="mono">{report.owner}/{report.repo}</span>
                  <span>·</span>
                  <span>PR #{report.pullNumber}</span>
                  <span>·</span>
                  <span>{report.totalIssues || 0} issues</span>
                  <span>·</span>
                  <span>{Math.round(report.falsePositiveRate || 0)}% FPR</span>
                  <span>·</span>
                  <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="history-item-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleView(report._id); }}
                  id={`view-report-${report._id}`}
                >
                  View Report
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => handleDelete(report._id, e)}
                  id={`delete-report-${report._id}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
