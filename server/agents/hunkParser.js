/**
 * Concurrent Modification Risk — Hunk Parsing & Overlap Detection
 *
 * Pure functions. No I/O. Fully unit-testable.
 *
 * These work on the unified-diff patch strings returned by GitHub's
 * GET /repos/{owner}/{repo}/pulls/{pull_number}/files API
 * (the `patch` field per file).
 */

/**
 * Parse `@@` hunk headers from a unified-diff patch string.
 * Extracts the NEW-file side (+c,d) ranges.
 *
 * Returns an array of [startLine, endLine] pairs (inclusive, 1-indexed).
 *
 * Edge cases:
 *   - No @@ headers → returns []
 *   - @@ -a,b +c @@  (count omitted, means count=1) → [c, c]
 *   - @@ -a,b +c,0 @@ (empty hunk) → skipped
 *
 * @param {string} patchText - The raw patch string from GitHub API
 * @returns {Array<[number, number]>} Array of [start, end] line ranges
 */
export function parseHunkRanges(patchText) {
  if (!patchText || typeof patchText !== 'string') return [];

  const ranges = [];
  // Match: @@ -a,b +c,d @@ or @@ -a +c @@ (count optional)
  const hunkHeaderRe = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;

  let match;
  while ((match = hunkHeaderRe.exec(patchText)) !== null) {
    const start = parseInt(match[1], 10);
    const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;

    if (count === 0) continue; // empty hunk — file-deletion side, skip

    const end = start + count - 1;
    ranges.push([start, end]);
  }

  return ranges;
}

/**
 * Check whether two line ranges overlap (or are within `buffer` lines of each other).
 *
 * @param {[number, number]} rangeA - [startLine, endLine] inclusive
 * @param {[number, number]} rangeB - [startLine, endLine] inclusive
 * @param {number} buffer - Extra proximity tolerance (default 3 lines)
 * @returns {boolean}
 */
export function rangesOverlap([a0, a1], [b0, b1], buffer = 3) {
  // Expand both ranges by buffer
  const aStart = a0 - buffer;
  const aEnd   = a1 + buffer;
  const bStart = b0 - buffer;
  const bEnd   = b1 + buffer;

  // Overlap if one range starts before the other ends
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Given two sets of hunk ranges (for the same file), find all overlapping pairs.
 *
 * @param {Array<[number,number]>} rangesA
 * @param {Array<[number,number]>} rangesB
 * @param {number} buffer
 * @returns {Array<{rangeA:[number,number], rangeB:[number,number], type:'line-level'|'file-level'}>}
 */
export function findOverlappingHunks(rangesA, rangesB, buffer = 3) {
  const collisions = [];

  for (const rA of rangesA) {
    for (const rB of rangesB) {
      // True line-level: real overlap (no buffer)
      const isLineLevelOverlap = rangesOverlap(rA, rB, 0);
      // Near-miss: overlap only with buffer
      const isNearMiss = !isLineLevelOverlap && rangesOverlap(rA, rB, buffer);

      if (isLineLevelOverlap || isNearMiss) {
        collisions.push({
          rangeA: rA,
          rangeB: rB,
          type: isLineLevelOverlap ? 'line-level' : 'file-level',
        });
      }
    }
  }

  return collisions;
}

// ─── Self-contained unit tests (run with node hunkParser.js) ─────────────────

export function runSelfTests() {
  let passed = 0;
  let failed = 0;

  function assert(desc, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { console.log(`  ✅ ${desc}`); passed++; }
    else { console.error(`  ❌ ${desc}\n     Expected: ${JSON.stringify(expected)}\n     Got:      ${JSON.stringify(actual)}`); failed++; }
  }

  console.log('\n── parseHunkRanges ──');

  // Edge: empty string
  assert('empty string → []', parseHunkRanges(''), []);

  // Edge: no @@ headers
  assert('no hunks → []', parseHunkRanges('diff --git a/foo.js b/foo.js\n--- a/foo.js\n+++ b/foo.js'), []);

  // Single hunk: @@ -1,4 +1,6 @@
  assert('single hunk +1,6', parseHunkRanges('@@ -1,4 +1,6 @@\n-old\n+new'), [[1, 6]]);

  // Count omitted → count=1
  assert('count omitted (+5 @@)', parseHunkRanges('@@ -3 +5 @@'), [[5, 5]]);

  // Zero-count hunk skipped
  assert('zero-count hunk skipped', parseHunkRanges('@@ -1,3 +0,0 @@\n-deleted'), []);

  // Multi-hunk patch
  assert(
    'multi-hunk patch',
    parseHunkRanges('@@ -1,4 +1,6 @@\n some\n+add\n-remove\n@@ -20,3 +22,5 @@\n context'),
    [[1, 6], [22, 26]]
  );

  // Real-world GitHub patch snippet
  const realPatch = `@@ -14,7 +14,7 @@ function login(user) {
-  const hash = md5(user.password);
+  const hash = bcrypt.hash(user.password, 10);
 }
 
@@ -30,5 +30,8 @@ function logout() {`;
  assert('real-world patch', parseHunkRanges(realPatch), [[14, 20], [30, 37]]);

  console.log('\n── rangesOverlap ──');

  // Direct overlap
  assert('direct overlap', rangesOverlap([10, 20], [15, 25], 0), true);
  // No overlap, no buffer
  assert('no overlap (no buffer)', rangesOverlap([1, 5], [10, 15], 0), false);
  // Near-miss within buffer
  assert('near-miss (buffer=3)', rangesOverlap([1, 5], [7, 12], 3), true);
  // Truly outside buffer: 5+3=8 < 13-3=10 → no overlap
  assert('just outside buffer', rangesOverlap([1, 5], [13, 20], 3), false);
  // Adjacent (touching)
  assert('touching ranges', rangesOverlap([1, 10], [10, 20], 0), true);

  console.log('\n── findOverlappingHunks ──');

  const hunksA = [[10, 20], [50, 60]];
  const hunksB = [[15, 25], [80, 90]];
  const collisions = findOverlappingHunks(hunksA, hunksB, 3);
  assert('finds line-level collision', collisions.length, 1);
  assert('collision type is line-level', collisions[0]?.type, 'line-level');

  // Near-miss only
  const nearA = [[1, 5]];
  const nearB = [[7, 12]];
  const nearCollisions = findOverlappingHunks(nearA, nearB, 3);
  assert('near-miss → file-level', nearCollisions[0]?.type, 'file-level');

  // No overlap at all
  const noOverlapA = [[1, 5]];
  const noOverlapB = [[20, 30]];
  assert('no overlap → empty', findOverlappingHunks(noOverlapA, noOverlapB, 3).length, 0);

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  return failed === 0;
}
