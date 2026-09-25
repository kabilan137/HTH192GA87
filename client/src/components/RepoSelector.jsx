import { useState } from 'react';
import './RepoSelector.css';
import { apiFetch } from '../api.js';

const POPULAR_REPOS = [
  { owner: 'facebook', repo: 'react', desc: 'React library' },
  { owner: 'expressjs', repo: 'express', desc: 'Node.js web framework' },
  { owner: 'lodash', repo: 'lodash', desc: 'JS utility library' },
  { owner: 'axios', repo: 'axios', desc: 'HTTP client' },
];

export default function RepoSelector({ onRepoSelected }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmed = input.trim();
    if (!trimmed) {
      setError('Please enter a repository in owner/repo format.');
      return;
    }

    // Normalise: handle https://, git@, and bare "owner/repo" inputs
    // Also strip trailing .git and any stray slashes
    const normalized = trimmed
      .replace(/^git@github\.com:/, '')      // git@github.com:owner/repo.git
      .replace(/^https?:\/\/github\.com\//, '') // https://github.com/owner/repo
      .replace(/\.git$/, '')                  // strip .git suffix
      .replace(/\/+$/, '');                  // strip trailing slashes

    const parts = normalized.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      setError('Enter a valid GitHub repository as "owner/repo" or paste the full GitHub URL.');
      return;
    }

    const owner = parts[0].trim();
    const repo  = parts[1].trim().replace(/\.git$/, ''); // belt-and-suspenders

    setLoading(true);
    try {
      // Quick validation: check if repo exists via our health endpoint
      const res = await apiFetch(`/api/repos/${owner}/${repo}/pulls`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Repository ${owner}/${repo} not found or inaccessible.`);
      }
      onRepoSelected(owner, repo);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = (owner, repo) => {
    setInput(`${owner}/${repo}`);
    onRepoSelected(owner, repo);
  };

  return (
    <div className="repo-selector card">
      <div className="repo-selector-header">
        <div className="repo-selector-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
        </div>
        <div>
          <h2 className="repo-selector-title">Select a Repository</h2>
          <p className="repo-selector-subtitle">Enter a GitHub repository to monitor pull requests</p>
        </div>
      </div>

      <form className="repo-form" onSubmit={handleSubmit} id="repo-selector-form">
        <div className="repo-input-group">
          <div className="repo-input-prefix">github.com/</div>
          <input
            id="repo-input"
            type="text"
            className="input repo-input"
            placeholder="owner/repository"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(''); }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="repo-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <button
          id="repo-submit-btn"
          type="submit"
          className="btn btn-primary btn-lg w-full"
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <>
              <div className="spinner" />
              Connecting...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              View Open Pull Requests
            </>
          )}
        </button>
      </form>

      <div className="repo-divider">
        <span>or try a popular repository</span>
      </div>

      <div className="repo-quick-list">
        {POPULAR_REPOS.map(({ owner, repo, desc }) => (
          <button
            key={`${owner}/${repo}`}
            id={`quick-repo-${owner}-${repo}`}
            className="repo-quick-item"
            onClick={() => handleQuickSelect(owner, repo)}
          >
            <div className="repo-quick-avatar">{owner[0].toUpperCase()}</div>
            <div className="repo-quick-info">
              <span className="repo-quick-name">{owner}/{repo}</span>
              <span className="repo-quick-desc">{desc}</span>
            </div>
            <svg className="repo-quick-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ))}
      </div>

      <div className="info-note mt-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>
          <strong>JS-Only Static Analysis:</strong> ESLint runs only on <code>.js</code> / <code>.jsx</code> files.
          TypeScript, Python, Go, and other languages receive LLM review only (no static analysis confirmation).
        </span>
      </div>
    </div>
  );
}
