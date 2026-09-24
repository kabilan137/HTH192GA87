import './RiskGauge.css';

function getRiskColor(score) {
  if (score >= 75) return { color: 'var(--critical)', label: 'Critical Risk', bg: 'rgba(239,68,68,0.15)' };
  if (score >= 50) return { color: 'var(--high)', label: 'High Risk', bg: 'rgba(249,115,22,0.15)' };
  if (score >= 25) return { color: 'var(--medium)', label: 'Moderate Risk', bg: 'rgba(234,179,8,0.15)' };
  return { color: 'var(--low)', label: 'Low Risk', bg: 'rgba(34,197,94,0.12)' };
}

export default function RiskGauge({ score }) {
  const { color, label, bg } = getRiskColor(score);
  const clampedScore = Math.min(100, Math.max(0, score));

  // SVG arc parameters
  const radius = 56;
  const cx = 70;
  const cy = 70;
  const circumference = Math.PI * radius; // semicircle
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  return (
    <div className="risk-gauge card" id="risk-gauge">
      <h3 className="risk-gauge-title">Release Risk Score</h3>
      <div className="risk-gauge-visual">
        <svg viewBox="0 0 140 80" className="risk-gauge-svg">
          {/* Track */}
          <path
            d="M 14 70 A 56 56 0 0 1 126 70"
            fill="none"
            stroke="var(--bg-secondary)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* Progress */}
          <path
            d="M 14 70 A 56 56 0 0 1 126 70"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="risk-gauge-progress"
            style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
          />
        </svg>
        <div className="risk-gauge-center">
          <div className="risk-gauge-score" style={{ color }}>{clampedScore}</div>
          <div className="risk-gauge-max">/100</div>
        </div>
      </div>
      <div
        className="risk-gauge-label"
        style={{ background: bg, color, border: `1px solid ${color}40` }}
      >
        {label}
      </div>
      <p className="risk-gauge-hint">
        Weighted sum of issue severity × confidence, normalized to 100.
      </p>
    </div>
  );
}
