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
- **Review Memory & Institutional Precedents**: Ingests resolved review comment threads from merged PRs via GitHub GraphQL as stored "incidents". When analyzing new code changes, embeds diff hunks and searches for similar past problems; if a match exceeds the similarity threshold (0.82), generates a grounded suggested fix referencing past PRs and reviewers before human review.
- **Feature Requirement Tracking**: Record feature requirements once in plain language with LLM-assisted atomic extraction. As PRs and branches are submitted over time, evaluates the cumulative code state against the requirement checklist, tracking gap resolution (`resolved`, `still_open`, `regressed`), code citations, and running completion percentage across immutable snapshots.

## 📋 Prerequisites

- Node.js 22+ (for `--env-file` support)
- MongoDB running locally or a MongoDB Atlas URI
- Docker (for the GitHub MCP server)
- An OpenRouter or Anthropic API key
- A GitHub Personal Access Token (with `repo` read scope)
- `VOYAGE_API_KEY` (*optional* — for Voyage AI code embeddings; falls back gracefully to MongoDB text index if not provided)

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
| POST | `/api/repos/:owner/:repo/import-history` | Ingest resolved review comment threads from merged PRs (seeding step) |
| GET | `/api/repos/:owner/:repo/incidents` | Query stored review incidents for a repo |
| POST | `/api/features/extract` | LLM-assisted requirement extraction from free-text |
| POST | `/api/features` | Create a new tracked feature |
| GET | `/api/features` | List tracked features for a repo |
| GET | `/api/features/:id` | Get feature details and latest snapshot |
| PATCH | `/api/features/:id` | Edit feature requirements or status |
| DELETE | `/api/features/:id` | Delete a tracked feature and its snapshots |
| POST | `/api/analyze` | Run full analysis pipeline (PR or branch mode, optional featureId) |
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
  category: 'Bug - Certain' | 'Security Vulnerability' | 'Performance Risk' | 'Code Smell - Stylistic' | 'Concurrent Modification Risk' | 'Known Pattern - Previously Flagged',
  severity: 'critical' | 'high' | 'medium' | 'low',
  confidence: number,    // 0.0 to 1.0
  source: 'static+llm' | 'llm-only' | 'static-only' | 'branch-diff-overlap' | 'review-history-match',
  explanation: string,
  suggestedFix: string,
  // Concurrent Modification Risk fields (only present on that category):
  conflictingBranch?: string,
  conflictingAuthor?: string,
  conflictingPRNumber?: number | null,   // null when sibling has no PR yet
  conflictingPRTitle?: string | null,
  lineRangeSelf?: [number, number],
  lineRangeOther?: [number, number],
  collisionType?: 'line-level' | 'file-level',
  futureRiskTier?: 'high' | 'medium' | 'low',
  siblingHasOpenPr?: boolean,
  lastPushedAt?: string,
  // Known Pattern fields (only present on review-history-match category):
  matchedIncidentId?: string,
  matchedPrNumber?: number,
  matchedReviewerLogin?: string,
  similarityScore?: number,
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

## 🧠 Review Memory (Institutional Precedents)

A two-part system that captures resolved review comment threads from merged PRs and matches new incoming changes against team history:

1. **Ingestion (Background / Manual Trigger)**: Scans merged PRs via GitHub GraphQL (`reviewThreads`), extracts resolved comment threads (diff hunk, reviewer comment, merge-commit resolution), computes embeddings on the problem side (`problemSnippet + "\n" + reviewerComment`), and stores them in the `Incident` collection.
2. **Retrieval (Per-Analysis)**: During branch/PR analysis, extracts changed diff hunks, computes their embeddings (or keyword search), and finds similar historical incidents in the same repo. If cosine similarity meets or exceeds `SIMILARITY_THRESHOLD`, Claude synthesizes a grounded fix tailored to the current code, citing the precedent PR and reviewer.

### Seeding Step (Required First Action Per Repo)
A fresh repo starts with zero stored review incidents. Before review retrieval can match anything, you must seed history:
- **UI Trigger**: Click the **"Import PR history"** button in the open PRs list or in the Review Memory panel on any report.
- **API Trigger**:
  ```bash
  curl -X POST http://localhost:3001/api/repos/:owner/:repo/import-history \
    -H "Content-Type: application/json" \
    -d '{"limit": 20}'
  ```
This imports up to `N` (default 20) merged PRs, extracting every resolved review thread into MongoDB.

### Embedding Model & Fallback Behavior
- **Primary Provider**: Voyage AI (`voyage-code-2`) via `@langchain/community`'s `VoyageEmbeddings`, configured with `VOYAGE_API_KEY` in `.env`.
- **Graceful Fallback**: If `VOYAGE_API_KEY` is not set, CodeGuard AI does **not crash**. It logs a warning (`⚠️ VOYAGE_API_KEY is not set. Falling back gracefully to keyword/text-index similarity`) and utilizes MongoDB text-index keyword search (`$text` search with textScore relevance scoring).
- The embedding interface is abstracted behind `getEmbedding(text)` so switching providers or operating in fallback mode requires zero changes to calling code.

### Configuration Constants (`server/agents/reviewRetrieval.js`)

| Constant | Default | Description |
|---|---|---|
| `SIMILARITY_THRESHOLD` | `0.82` | Minimum cosine similarity required to flag a matched precedent |
| `MAX_MATCHES_PER_HUNK` | `3` | Maximum historical matches surfaced per changed hunk |

### False-Positive Rate (FPR) Guarantee
Unlike concurrent modification risks (which are deterministic git-diff line overlaps and excluded from FPR), `review-history-match` is a **probabilistic similarity match**. In accordance with CodeGuard AI's honesty guarantee, `review-history-match` issues **ARE included** in the false-positive rate calculation denominator like any LLM-derived finding.

### Heuristic Disclaimer
Precedent matches are a **similarity heuristic, not a guarantee**. A high similarity score means the code change strongly resembles a past pattern flagged by your team and is "worth a look" — not that it is definitely a defect.

---

## 🎯 Feature Requirement Tracking

Feature Requirement Tracking lets developers and managers record what a feature is supposed to build once, in plain language, when work begins. Every pull request or branch analyzed against that feature is checked against the requirement checklist using the feature's **cumulative code state** relative to `main` — not just an isolated PR diff. Successive PRs are judged on whether they actually closed the gaps left open by earlier work.

### 🏛️ Architectural Boundary & Separation of Concerns

Feature completeness is fundamentally distinct from code quality or merge risk:
- **Independent Data Model**: Stored in dedicated `Feature` and `FeatureSnapshot` Mongoose collections.
- **Zero Schema Pollution**: Does **not** write to or read from the `Issue` collection, `riskScore` (0–100), or `falsePositiveRate` calculation.
- **Parallel Report Type**: Renders in its own dedicated `FeatureTrackingPanel` below the PR risk report.

### 📝 Step-by-Step Workflow

#### 1. Creating a Tracked Feature (Step A & F)
1. In the top navigation bar, click **"🎯 Features"** or use the **"+ New Feature"** shortcut in the PR list.
2. Enter the feature title and free-text specification (user stories, acceptance criteria, or product specs).
3. Click **"Extract Requirements with AI"**:
   - Claude decomposes the description into atomic, independently verifiable requirements (avoiding compound "X and Y" rules).
   - Each requirement is classified into a category: `functional`, `security`, `edge-case`, or `non-functional`.
4. **Human Review Before Saving**: Review the extracted checklist. Edit requirement wording, adjust category pills, add missing rules, or delete irrelevant ones.
5. Click **"Save Feature Tracker"**. Requirements can be updated anytime via `PATCH /api/features/:id`.

#### 2. Linking a PR or Branch to a Feature (Step B & G)
1. On the PR list or branch selector screen, locate the **"Feature Requirement Tracking"** selector bar.
2. Select your tracked feature from the dropdown (or leave as *"No feature tracking"* to run normal code quality analysis). Selection is explicit and never relies on brittle PR naming conventions.
3. Click **"Analyze"** on any PR or active branch.

#### 3. Cumulative State Evaluation (Step C)
Instead of judging only the PR's isolated commits, CodeGuard AI reuses the base...head and base...branch comparison logic to evaluate the **entire cumulative diff against the repository's default branch (`main`)**. This ensures all merged and ongoing work for the feature is accurately reflected.

#### 4. Requirement Coverage & Evidence Grounding (Step D)
Claude evaluates the cumulative diff against each requirement:
- **Statuses**:
  - `met`: The requirement is fully implemented in the cumulative diff. **Strict Citation Rule**: A verdict cannot be "met" without citing specific files, line numbers, and concrete code evidence.
  - `partial`: Scaffolding, partial logic, or incomplete implementation is detected.
  - `not_addressed`: No relevant code changes exist in the diff.
  - `not_applicable`: Obsolete or superseded requirement.
- **Transition Tracking (`changeSinceLast`)**:
  - `first_check`: Baseline evaluation on the first PR analyzed.
  - `resolved`: **Gap closed!** The requirement was `not_addressed` or `partial` in the previous PR and is now `met`.
  - `still_open`: The requirement was incomplete previously and remains incomplete in this PR.
  - `regressed`: Requirement was previously `met` but was broken or deleted in recent changes.
  - `newly_addressed`: Requirement added to the feature after the last snapshot and now satisfied.
  - `unchanged`: Status remained identical across snapshots.

#### 5. Completion Calculation & History (Step E & H)
- **Formula**:
  $$\text{overallCompletionPercent} = \frac{\text{count}(\text{met}) + 0.5 \times \text{count}(\text{partial})}{\text{count}(\text{applicable})} \times 100$$
- **Immutable Snapshots**: Every analysis saves a new `FeatureSnapshot` document. Past snapshots are never overwritten, preserving a complete audit trail of progress across PRs.
- **Feature Dashboard**: View cumulative progress bars, total PR checks, and latest status for every tracked feature in the repository.

### ⚖️ LLM Judgment Grounding & Disclaimer

> **Important**: Requirement verdicts (`met`, `partial`, `not_addressed`) are **LLM judgments grounded in cited diff evidence**, not an automatic guarantee or formal sign-off.
>
> CodeGuard AI strictly requires the model to point to concrete files and line numbers before marking any requirement as `met`. However, this is an automated review aid to track progress and identify gaps — final sign-off remains the responsibility of engineering and QA reviewers.

