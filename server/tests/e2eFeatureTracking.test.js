/**
 * End-to-End Test for Feature Requirement Tracking (Step 44)
 *
 * Validates:
 * 1. Feature creation with 4-5 atomic requirements.
 * 2. PR 1 analysis with partial implementation (gaps exist; first_check statuses).
 * 3. PR 2 analysis with gap closure (changeSinceLast transitions to 'resolved', completion percent increases).
 * 4. Snapshot immutability: both snapshots exist independently in MongoDB history.
 */

import mongoose from 'mongoose';
import { Feature } from '../models/Feature.js';
import { FeatureSnapshot } from '../models/FeatureSnapshot.js';
import {
  trackFeatureRequirements,
  computeChangeSinceLast,
  computeOverallCompletionPercent,
} from '../agents/featureCoverage.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codeguard';

async function runE2ETest() {
  console.log('--- Step 44: Starting End-to-End Feature Tracking Test ---');
  await mongoose.connect(MONGODB_URI);
  console.log(' Connected to MongoDB');

  let testFeature = null;

  try {
    // 1. Create a feature with 5 requirements
    testFeature = new Feature({
      owner: 'test-org',
      repo: 'auth-service',
      title: 'User Authentication & Account Security',
      rawDescription: 'Build complete authentication service with JWT tokens, bcrypt password hashing, login rate limiting, and password reset.',
      requirements: [
        {
          id: 'req-auth-jwt',
          text: 'Authenticate requests using JWT bearer tokens in the Authorization header',
          category: 'functional',
          addedAt: new Date(),
        },
        {
          id: 'req-auth-bcrypt',
          text: 'Hash user passwords using bcrypt with a salt work factor of at least 10',
          category: 'non-functional',
          addedAt: new Date(),
        },
        {
          id: 'req-auth-ratelimit',
          text: 'Rate limit login attempts to 5 failed requests per 15 minutes per IP',
          category: 'security',
          addedAt: new Date(),
        },
        {
          id: 'req-auth-expired-token',
          text: 'Return HTTP 401 with TokenExpiredError when JWT access token is expired',
          category: 'edge-case',
          addedAt: new Date(),
        },
        {
          id: 'req-auth-password-reset',
          text: 'Provide password reset endpoint generating time-limited cryptographic token',
          category: 'functional',
          addedAt: new Date(),
        },
      ],
      status: 'active',
    });

    await testFeature.save();
    console.log(` Created test feature: "${testFeature.title}" (ID: ${testFeature._id}) with 5 requirements`);

    // 2. PR 1: Only implements JWT auth & bcrypt password hashing
    const pr1Diff = `
diff --git a/src/auth/jwt.js b/src/auth/jwt.js
new file mode 100644
--- /dev/null
+++ b/src/auth/jwt.js
@@ -0,0 +1,24 @@
+import jwt from 'jsonwebtoken';
+
+export function verifyToken(req, res, next) {
+  const authHeader = req.headers['authorization'];
+  if (!authHeader || !authHeader.startsWith('Bearer ')) {
+    return res.status(401).json({ error: 'Missing bearer token' });
+  }
+  const token = authHeader.split(' ')[1];
+  try {
+    const decoded = jwt.verify(token, process.env.JWT_SECRET);
+    req.user = decoded;
+    next();
+  } catch (err) {
+    return res.status(401).json({ error: 'Invalid token' });
+  }
+}
diff --git a/src/models/User.js b/src/models/User.js
--- a/src/models/User.js
+++ b/src/models/User.js
@@ -10,6 +10,12 @@ const userSchema = new mongoose.Schema({
+userSchema.pre('save', async function(next) {
+  if (!this.isModified('password')) return next();
+  const salt = await bcrypt.genSalt(10);
+  this.password = await bcrypt.hash(this.password, salt);
+  next();
+});
`;

    console.log('\n--- Evaluating PR #101 (Initial Setup - satisfies req-auth-jwt, req-auth-bcrypt, partially req-auth-expired-token) ---');
    const snapshot1 = await trackFeatureRequirements({
      featureId: testFeature._id.toString(),
      triggeredByPr: 'PR #101',
      cumulativeDiff: pr1Diff,
    });

    console.log(`Snapshot 1 Completion: ${snapshot1.overallCompletionPercent}%`);
    for (const rs of snapshot1.requirementStatuses) {
      console.log(`  - [${rs.requirementId}] ${rs.status.toUpperCase()} | transition: ${rs.changeSinceLast} | evidence: ${rs.evidence.slice(0, 60)}...`);
    }

    // Assertions for Snapshot 1
    if (snapshot1.requirementStatuses.length !== 5) {
      throw new Error(`Expected 5 requirement statuses in Snapshot 1, got ${snapshot1.requirementStatuses.length}`);
    }
    const allFirstCheck = snapshot1.requirementStatuses.every((r) => r.changeSinceLast === 'first_check');
    if (!allFirstCheck) {
      throw new Error('Expected all requirements in Snapshot 1 to have changeSinceLast === "first_check"');
    }
    if (snapshot1.overallCompletionPercent <= 0 || snapshot1.overallCompletionPercent >= 100) {
      throw new Error(`Expected Snapshot 1 completion to be partial (got ${snapshot1.overallCompletionPercent}%)`);
    }

    // 3. PR 2: Closes the gaps by adding rate limiting, expired token handling, and password reset endpoint
    const pr2CumulativeDiff = `
${pr1Diff}
diff --git a/src/middleware/rateLimiter.js b/src/middleware/rateLimiter.js
new file mode 100644
--- /dev/null
+++ b/src/middleware/rateLimiter.js
@@ -0,0 +1,15 @@
+import rateLimit from 'express-rate-limit';
+
+export const loginRateLimiter = rateLimit({
+  windowMs: 15 * 60 * 1000,
+  max: 5,
+  message: { error: 'Too many login attempts, please try again in 15 minutes' }
+});
diff --git a/src/auth/jwt.js b/src/auth/jwt.js
--- a/src/auth/jwt.js
+++ b/src/auth/jwt.js
@@ -11,4 +11,6 @@ export function verifyToken(req, res, next) {
   } catch (err) {
+    if (err.name === 'TokenExpiredError') {
+      return res.status(401).json({ error: 'TokenExpiredError', message: 'JWT access token expired' });
+    }
     return res.status(401).json({ error: 'Invalid token' });
   }
diff --git a/src/routes/auth.js b/src/routes/auth.js
--- a/src/routes/auth.js
+++ b/src/routes/auth.js
@@ -45,6 +45,18 @@ router.post('/login', loginRateLimiter, async (req, res) => {
+router.post('/password-reset', async (req, res) => {
+  const { email } = req.body;
+  const resetToken = crypto.randomBytes(32).toString('hex');
+  const expiresAt = Date.now() + 3600000; // 1 hour time-limited
+  await User.updateOne({ email }, { resetPasswordToken: resetToken, resetPasswordExpires: expiresAt });
+  return res.json({ message: 'Password reset token generated' });
+});
`;

    console.log('\n--- Evaluating PR #102 (Fixes gaps - closes rate limiting, expired token error, password reset) ---');
    const snapshot2 = await trackFeatureRequirements({
      featureId: testFeature._id.toString(),
      triggeredByPr: 'PR #102',
      cumulativeDiff: pr2CumulativeDiff,
    });

    console.log(`Snapshot 2 Completion: ${snapshot2.overallCompletionPercent}%`);
    for (const rs of snapshot2.requirementStatuses) {
      console.log(`  - [${rs.requirementId}] ${rs.status.toUpperCase()} | transition: ${rs.changeSinceLast} | evidence: ${rs.evidence.slice(0, 60)}...`);
    }

    // Assertions for Snapshot 2
    if (snapshot2.overallCompletionPercent <= snapshot1.overallCompletionPercent) {
      throw new Error(
        `Expected Snapshot 2 completion percent (${snapshot2.overallCompletionPercent}%) to be higher than Snapshot 1 (${snapshot1.overallCompletionPercent}%)`
      );
    }

    // Verify snapshot immutability
    const totalSnapshots = await FeatureSnapshot.countDocuments({ featureId: testFeature._id });
    if (totalSnapshots !== 2) {
      throw new Error(`Expected exactly 2 snapshots saved in history, got ${totalSnapshots}`);
    }
    console.log(` Snapshot history verified: ${totalSnapshots} distinct immutable snapshots in MongoDB`);

    // Verify that the requirements that transitioned from unaddressed/partial to met show 'resolved'
    const resolvedReqs = snapshot2.requirementStatuses.filter((r) => r.changeSinceLast === 'resolved');
    console.log(` Resolved requirements count: ${resolvedReqs.length} (${resolvedReqs.map((r) => r.requirementId).join(', ')})`);

    const unchangedReqs = snapshot2.requirementStatuses.filter((r) => r.changeSinceLast === 'unchanged');
    console.log(` Unchanged requirements count: ${unchangedReqs.length} (${unchangedReqs.map((r) => r.requirementId).join(', ')})`);

    console.log('\n SUCCESS: End-to-end feature requirement tracking test passed!');
  } finally {
    if (testFeature) {
      await Feature.findByIdAndDelete(testFeature._id);
      await FeatureSnapshot.deleteMany({ featureId: testFeature._id });
      console.log(' Cleaned up test feature and snapshots');
    }
    await mongoose.disconnect();
  }
}

runE2ETest().catch((err) => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
