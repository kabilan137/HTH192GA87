# CodeGuard AI — Agentic Code Review & Release-Risk Assistant

CodeGuard AI is a full-stack hackathon MVP that scans GitHub pull requests for bugs, security vulnerabilities, performance risks, and code smells — powered by Claude (via LangChain.js) and ESLint static analysis.

## ✨ Features

- **Agentic Pipeline**: GitHub MCP → ESLint static analysis → Claude LLM → merged, ranked issue list
- **Release Risk Score (0–100)**: Weighted sum of issue severity × confidence, scaled to 100
- **Transparent False-Positive Rate**: Prominently displayed — X% of AI flags are unconfirmed by static analysis
- **Top-3 Must-Fix Issues**: Highest-impact issues highlighted separately
- **Source Tagging**: Each issue tagged as `static+llm` (confirmed by both), `llm-only`, or `static-only`
- **Distinct Visual Categories**: Bug – Certain vs. Code Smell – Stylistic visually distinguished (never merged)
- **Persistent Reports**: All analyses saved to MongoDB for history review
- **JS-Only Static Analysis**: ESLint runs on `.js`/`.jsx` files only (prototype limitation — clearly labeled in UI)
- **Concurrent Modification Risk**: Compares the reviewed branch against ALL active sibling branches (not just those with open PRs). Detects line-range overlaps via the GitHub compare endpoint — no AST analysis, heuristic only. Surfaces a `futureRiskTier` (High/Medium/Low) and "No PR yet" vs "Open PR" badge per collision.
- **Branch-Mode Analysis**: Analyze any pushed branch directly (no PR required) via `POST /api/analyze { owner, repo, branch }`. Full ESLint + LLM + concurrent-risk pipeline runs identically to PR mode.

## 📋 Prerequisites

- Node.js 22+ (for `--env-file` support)
- MongoDB running locally or a MongoDB Atlas URI
- Docker (for the GitHub MCP server)
- An Anthropic API key
- A GitHub Personal Access Token (with `repo` read scope)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd codeguard-ai
npm run install:all
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual values:
```

```env
ANTHROPIC_API_KEY=sk-ant-your-actual-key
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your-actual-token
MONGODB_URI=mongodb://localhost:27017/codeguard
PORT=3001
```

### 3. Run

```bash
npm run dev
```

This starts:
- **Backend** at `http://localhost:3001`
- **Frontend** at `http://localhost:5173`

Open `http://localhost:5173` in your browser.

## 🏗️ Architecture

```
/server
  /mcp              → MultiServerMCPClient + GitHub tool wrappers (with REST fallbacks)
  /staticAnalysis   → ESLint programmatic runner + security plugin
  /agents           → LangChain review chain (Claude via ChatAnthropic) + merge/score logic
  /models           → Mongoose schemas (Report + Issue)
  /routes           → Express API routes
  server.js         → Entry point

/client/src
  /components
    Header              → Site navigation
    RepoSelector        → GitHub repo input + quick-select list
    PullRequestList     → Open PRs for a repo with Analyze button
    ReportView          → Full analysis report display
    RiskGauge           → SVG arc gauge (0–100 risk score)
    FalsePositiveBadge  → Always-visible FP rate with breakdown
    TopThreePanel       → Must-fix issue highlights
    ReportHistory       → Past analyses list
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:owner/:repo/pulls` | List open PRs for a repo |
| GET | `/api/repos/:owner/:repo/branches` | List branches (active within 30 days) |
| GET | `/api/repos/:owner/:repo/commits` | Recent commit history |
| POST | `/api/analyze` | Run full analysis pipeline (PR or branch mode) |
| POST | `/api/conflict-check` | Deep merge-conflict analysis via Claude |
| GET | `/api/reports` | List all past reports |
| GET | `/api/reports/:id` | Fetch a specific report |
| DELETE | `/api/reports/:id` | Delete a report |

### POST /api/analyze

**Request body — PR mode:**
```json
{
  "owner": "facebook",
  "repo": "react",
  "pullNumber": 12345
}
```

**Request body — Branch mode (no PR required):**
```json
{
  "owner": "facebook",
  "repo": "react",
  "branch": "feature/my-branch"
}
```

In branch mode the server fetches the branch diff via `GET /compare/{default}...{branch}` and runs the identical ESLint + LLM + concurrent-risk pipeline.

**Response:**
```json
{
  "reportId": "...",
  "report": { ... },
  "llmSummary": "...",
  "jsOnlyNote": "...",
  "concurrentRiskNote": "..."
}
```

## 📊 Scoring Logic

### Risk Score (0–100)

```
Category Weights:
  Security Vulnerability  = 10
  Bug - Certain           = 7
  Performance Risk        = 4
  Code Smell - Stylistic  = 1

Per-issue score = categoryWeight × confidence
Risk Score = min(100, (sum_of_per_issue_scores / 80) × 100)
```

### False-Positive Rate

```
FPR = (llm-only issues / total issues) × 100
```

Issues are `llm-only` when Claude flagged them but ESLint did not find the same location. Issues confirmed by both tools become `static+llm`.

## ⚠️ Known Limitations

1. **JS-Only Static Analysis**: ESLint only runs on `.js`/`.jsx` files. TypeScript (`.ts`/`.tsx`), Python, Go, and other files are analyzed by Claude only (no `static+llm` source confirmation). This is displayed in the UI.

2. **No Authentication**: Single-user prototype. API keys are server-side environment variables only.

3. **MCP Server via Docker**: The GitHub MCP server runs as a Docker container. If Docker is unavailable, the system automatically falls back to direct GitHub REST API calls.

4. **Rate Limiting**: Large PRs (100+ files) may hit GitHub API or Anthropic rate limits.

5. **Token Limits**: Very large diffs/files are truncated before being sent to Claude (8,000 chars per file, 12,000 chars for the diff).

## 🔧 MCP Configuration

The GitHub MCP server is configured to use Docker:

```
docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN=... ghcr.io/github/github-mcp-server
```

If Docker is not available, set `SKIP_MCP=true` in your `.env` and the system will use GitHub REST API exclusively.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Database | MongoDB + Mongoose |
| LLM Orchestration | LangChain.js (`langchain`, `@langchain/anthropic`, `@langchain/core`) |
| MCP Integration | `@langchain/mcp-adapters` (`MultiServerMCPClient`) |
| LLM | Claude Sonnet (via Anthropic API) |
| Static Analysis | ESLint 8 + `eslint-plugin-security` |
| Schema Validation | Zod (structured LLM output) |

## 📝 Data Schema

Each issue in a report:

```typescript
{
  file: string,          // relative path
  line: number,          // exact line number
  category: 'Bug - Certain' | 'Security Vulnerability' | 'Performance Risk' | 'Code Smell - Stylistic' | 'Concurrent Modification Risk',
  severity: 'critical' | 'high' | 'medium' | 'low',
  confidence: number,    // 0.0 to 1.0
  source: 'static+llm' | 'llm-only' | 'static-only' | 'branch-diff-overlap',
  explanation: string,
  suggestedFix: string,
  // Concurrent Modification Risk fields (only present on that category):
  conflictingBranch: string,
  conflictingAuthor: string,
  conflictingPRNumber: number | null,   // null when sibling has no PR yet
  conflictingPRTitle: string | null,
  lineRangeSelf: [number, number],
  lineRangeOther: [number, number],
  collisionType: 'line-level' | 'file-level',
  futureRiskTier: 'high' | 'medium' | 'low',
  siblingHasOpenPr: boolean,
  lastPushedAt: string,
}
```

## 🔀 Concurrent Modification Risk

Compares the branch/PR under review against **every active branch** in the repo (no PR required) via GitHub's compare endpoint:

```
GET /repos/{owner}/{repo}/compare/{base}...{branch}
```

### Configuration (`server/agents/concurrentRisk.js`)

| Constant | Default | Description |
|---|---|---|
| `ACTIVE_BRANCH_LOOKBACK_DAYS` | 14 | Ignore branches not pushed within this window |
| `COMPARE_CONCURRENCY` | 5 | Max simultaneous compare API calls (rate-limit guard) |
| `HIGH_RISK_RECENCY_DAYS` | 3 | Pushed within this → qualifies as "recent" for tier |
| `HUNK_BUFFER_LINES` | 3 | Line buffer applied when checking hunk overlap |

### futureRiskTier

| Tier | Condition |
|------|-----------|
| `high` | Line-level collision AND sibling pushed within 3 days |
| `medium` | Line-level but older, OR file-level and recent (≤3 days) |
| `low` | File-level collision AND older than 3 days |

**Caveats:** Heuristic only — line-range overlap ±3 lines from real unified diffs, not AST-level. `branch-diff-overlap` issues are excluded from the FPR denominator (deterministic, not LLM inference).
