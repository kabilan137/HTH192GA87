import { useState, useCallback } from 'react';
import Header from './components/Header.jsx';
import RepoSelector from './components/RepoSelector.jsx';
import PullRequestList from './components/PullRequestList.jsx';
import ReportView from './components/ReportView.jsx';
import ReportHistory from './components/ReportHistory.jsx';
import ConflictReport from './components/ConflictReport.jsx';
import './App.css';

export default function App() {
  // Views: 'home' | 'prs' | 'analyzing' | 'report' | 'history' | 'conflict-checking' | 'conflict'
  const [view, setView] = useState('home');
  const [repoInfo, setRepoInfo] = useState(null);
  const [selectedPR, setSelectedPR] = useState(null);
  const [report, setReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [llmSummary, setLlmSummary] = useState('');
  const [jsOnlyNote, setJsOnlyNote] = useState(null);

  // Conflict state
  const [conflictReport, setConflictReport] = useState(null);
  const [conflictChecking, setConflictChecking] = useState(false);
  const [conflictError, setConflictError] = useState(null);

  const handleRepoSelected = useCallback((owner, repo) => {
    setRepoInfo({ owner, repo });
    setSelectedPR(null);
    setReport(null);
    setConflictReport(null);
    setView('prs');
  }, []);

  const handleAnalyze = useCallback(async (pr) => {
    if (!repoInfo) return;
    setSelectedPR(pr);
    setAnalyzing(true);
    setAnalyzeError(null);
    setReport(null);
    setView('analyzing');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pullNumber: pr.number,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');

      setReport(data.report);
      setLlmSummary(data.llmSummary || '');
      setJsOnlyNote(data.jsOnlyNote || null);
      setView('report');
    } catch (e) {
      setAnalyzeError(e.message);
      setView('prs');
    } finally {
      setAnalyzing(false);
    }
  }, [repoInfo]);

  // ── Branch analysis handler — no PR number required ──────────────────────
  const handleAnalyzeBranch = useCallback(async (branchName) => {
    if (!repoInfo) return;
    setSelectedPR({ number: null, title: `branch: ${branchName}` });
    setAnalyzing(true);
    setAnalyzeError(null);
    setReport(null);
    setView('analyzing');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          branch: branchName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Branch analysis failed');

      setReport(data.report);
      setLlmSummary(data.llmSummary || '');
      setJsOnlyNote(data.jsOnlyNote || null);
      setView('report');
    } catch (e) {
      setAnalyzeError(e.message);
      setView('prs');
    } finally {
      setAnalyzing(false);
    }
  }, [repoInfo]);

  // ── NEW: Conflict Check handler ──────────────────────────────────────────

  const handleConflictCheck = useCallback(async (pr) => {
    if (!repoInfo) return;
    setSelectedPR(pr);
    setConflictChecking(true);
    setConflictError(null);
    setConflictReport(null);
    setView('conflict-checking');

    try {
      const res = await fetch('/api/conflict-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pullNumber: pr.number,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conflict check failed');

      setConflictReport(data.report);
      setView('conflict');
    } catch (e) {
      setConflictError(e.message);
      setView('prs');
    } finally {
      setConflictChecking(false);
    }
  }, [repoInfo]);

  const handleBack = useCallback(() => {
    if (view === 'report' || view === 'analyzing' || view === 'conflict' || view === 'conflict-checking') {
      setView('prs');
    } else {
      setView('home');
      setRepoInfo(null);
    }
  }, [view]);

  const handleViewReport = useCallback((reportData) => {
    setReport(reportData);
    setLlmSummary('');
    setJsOnlyNote(null);
    setView('report');
  }, []);

  return (
    <div className="app">
      <Header
        onHome={() => { setView('home'); setRepoInfo(null); }}
        onHistory={() => setView('history')}
        currentView={view}
      />

      <main className="app-main">
        <div className="container">
          {view === 'home' && (
            <div className="fade-in">
              <HeroSection />
              <RepoSelector onRepoSelected={handleRepoSelected} />
            </div>
          )}

          {view === 'prs' && repoInfo && (
            <div className="fade-in">
              <PullRequestList
                owner={repoInfo.owner}
                repo={repoInfo.repo}
                onAnalyze={handleAnalyze}
                onConflictCheck={handleConflictCheck}
                onAnalyzeBranch={handleAnalyzeBranch}
                onBack={() => { setView('home'); setRepoInfo(null); }}
                analyzeError={analyzeError}
                conflictError={conflictError}
                analyzing={analyzing}
                conflictChecking={conflictChecking}
                selectedPR={selectedPR}
              />
            </div>
          )}

          {view === 'analyzing' && (
            <AnalyzingOverlay pr={selectedPR} repoInfo={repoInfo} />
          )}

          {view === 'conflict-checking' && (
            <ConflictCheckingOverlay pr={selectedPR} repoInfo={repoInfo} />
          )}

          {view === 'report' && report && (
            <div className="fade-in">
              <ReportView
                report={report}
                llmSummary={llmSummary}
                jsOnlyNote={jsOnlyNote}
                onBack={() => setView('prs')}
                onNewRepo={() => { setView('home'); setRepoInfo(null); }}
              />
            </div>
          )}

          {view === 'conflict' && conflictReport && (
            <div className="fade-in">
              <ConflictReport
                report={conflictReport}
                onBack={() => setView('prs')}
                onNewRepo={() => { setView('home'); setRepoInfo(null); }}
              />
            </div>
          )}

          {view === 'history' && (
            <div className="fade-in">
              <ReportHistory
                onViewReport={handleViewReport}
                onBack={() => setView('home')}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function HeroSection() {
  return (
    <div className="hero">
      <div className="hero-badge">
        <span className="hero-badge-dot" />
        AI-Powered Code Intelligence
      </div>
      <h1 className="hero-title">
        Ship code with<br />
        <span className="hero-gradient">confidence.</span>
      </h1>
      <p className="hero-subtitle">
        CodeGuard AI scans your pull requests for bugs, security vulnerabilities,
        and performance risks — powered by Claude + static analysis, with a transparent
        false-positive rate so you trust every flag.
      </p>
      <div className="hero-stats">
        <div className="hero-stat">
          <span className="hero-stat-icon">🛡️</span>
          <span>Security Analysis</span>
        </div>
        <div className="hero-stat">
          <span className="hero-stat-icon">⚡</span>
          <span>Performance Risks</span>
        </div>
        <div className="hero-stat">
          <span className="hero-stat-icon">🔀</span>
          <span>Conflict Detection</span>
        </div>
        <div className="hero-stat">
          <span className="hero-stat-icon">📊</span>
          <span>False Positive Rate</span>
        </div>
      </div>
    </div>
  );
}

function AnalyzingOverlay({ pr, repoInfo }) {
  const steps = [
    { icon: '🔗', label: 'Fetching PR diff and changed files via GitHub MCP' },
    { icon: '🔧', label: 'Running ESLint static analysis on JavaScript files' },
    { icon: '🤖', label: 'Claude is reviewing your code for bugs & security issues' },
    { icon: '📊', label: 'Computing risk score and false-positive rate' },
    { icon: '💾', label: 'Saving analysis report to database' },
  ];

  return (
    <div className="analyzing-overlay fade-in">
      <div className="analyzing-card card">
        <div className="analyzing-spinner">
          <div className="spinner spinner-lg" />
          <div className="analyzing-pulse" />
        </div>
        <h2>Analyzing Pull Request</h2>
        {pr && (
          <p className="analyzing-pr-title">
            #{pr.number}: {pr.title}
          </p>
        )}
        {repoInfo && (
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
            {repoInfo.owner}/{repoInfo.repo}
          </p>
        )}
        <div className="analyzing-steps">
          {steps.map((step, i) => (
            <div key={i} className="analyzing-step" style={{ animationDelay: `${i * 0.4}s` }}>
              <span className="analyzing-step-icon">{step.icon}</span>
              <span className="analyzing-step-label">{step.label}</span>
            </div>
          ))}
        </div>
        <p className="analyzing-note">
          This may take 15–60 seconds depending on PR size and LLM response time.
        </p>
      </div>
    </div>
  );
}

function ConflictCheckingOverlay({ pr, repoInfo }) {
  const steps = [
    { icon: '🔗', label: 'Fetching PR metadata and changed file list via MCP' },
    { icon: '📄', label: 'Fetching base branch (main) file contents' },
    { icon: '📄', label: 'Fetching PR branch file contents' },
    { icon: '🔀', label: 'Claude is analysing line-level conflicts between branches' },
    { icon: '🛠️', label: 'Generating recommended merged code and resolution strategy' },
    { icon: '💾', label: 'Saving conflict report to database' },
  ];

  return (
    <div className="analyzing-overlay fade-in">
      <div className="analyzing-card card">
        <div className="analyzing-spinner">
          <div className="spinner spinner-lg" style={{ borderTopColor: '#f59e0b' }} />
          <div className="analyzing-pulse" style={{ background: 'rgba(245,158,11,0.15)' }} />
        </div>
        <h2>Checking for Merge Conflicts</h2>
        {pr && (
          <p className="analyzing-pr-title">
            #{pr.number}: {pr.title}
          </p>
        )}
        {repoInfo && (
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
            {repoInfo.owner}/{repoInfo.repo}
          </p>
        )}
        <div className="analyzing-steps">
          {steps.map((step, i) => (
            <div key={i} className="analyzing-step" style={{ animationDelay: `${i * 0.35}s` }}>
              <span className="analyzing-step-icon">{step.icon}</span>
              <span className="analyzing-step-label">{step.label}</span>
            </div>
          ))}
        </div>
        <p className="analyzing-note">
          This may take 20–60 seconds. Claude is comparing both branches file-by-file.
        </p>
      </div>
    </div>
  );
}
