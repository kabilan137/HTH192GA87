import { useState, useCallback } from 'react';
import Header from './components/Header.jsx';
import RepoSelector from './components/RepoSelector.jsx';
import PullRequestList from './components/PullRequestList.jsx';
import ReportView from './components/ReportView.jsx';
import ReportHistory from './components/ReportHistory.jsx';
import './App.css';

export default function App() {
  const [view, setView] = useState('home'); // 'home' | 'prs' | 'analyzing' | 'report' | 'history'
  const [repoInfo, setRepoInfo] = useState(null); // { owner, repo }
  const [selectedPR, setSelectedPR] = useState(null);
  const [report, setReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [llmSummary, setLlmSummary] = useState('');
  const [jsOnlyNote, setJsOnlyNote] = useState(null);

  const handleRepoSelected = useCallback((owner, repo) => {
    setRepoInfo({ owner, repo });
    setSelectedPR(null);
    setReport(null);
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

      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

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

  const handleBack = useCallback(() => {
    if (view === 'report' || view === 'analyzing') {
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
                onBack={() => { setView('home'); setRepoInfo(null); }}
                analyzeError={analyzeError}
                analyzing={analyzing}
                selectedPR={selectedPR}
              />
            </div>
          )}

          {view === 'analyzing' && (
            <AnalyzingOverlay pr={selectedPR} repoInfo={repoInfo} />
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
          <span className="hero-stat-icon">🎯</span>
          <span>Release Risk Score</span>
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
