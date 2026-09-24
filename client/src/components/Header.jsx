import './Header.css';

export default function Header({ onHome, onHistory, currentView }) {
  return (
    <header className="header">
      <div className="container">
        <div className="header-inner">
          <button className="header-logo" onClick={onHome} id="header-logo-btn">
            <div className="header-logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
            <div className="header-logo-text">
              <span className="header-logo-name">CodeGuard</span>
              <span className="header-logo-ai">AI</span>
            </div>
          </button>

          <nav className="header-nav">
            <div className="header-nav-pill">
              <span className="header-nav-dot" />
              PR Risk Intelligence
            </div>
          </nav>

          <div className="header-actions">
            <button
              className={`btn btn-secondary btn-sm ${currentView === 'history' ? 'active' : ''}`}
              onClick={onHistory}
              id="header-history-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h6l3 9 4-6h5" />
                <path d="M21 21H3" />
              </svg>
              History
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
