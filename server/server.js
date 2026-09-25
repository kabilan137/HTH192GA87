import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import repoRoutes from './routes/repos.js';
import analyzeRoutes from './routes/analyze.js';
import reportRoutes from './routes/reports.js';
import conflictRoutes from './routes/conflict.js';
import featureRoutes from './routes/features.js';

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codeguard';

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  // Production frontend (Vercel)
  'https://client-i4a6v0hw8-kabilan2867-2796s-projects.vercel.app',
  // Also allow any extra URL set via env var
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

// ─── MongoDB connection (cached for Vercel serverless cold starts) ─────────────
let cachedConn = null;

async function connectDB() {
  if (cachedConn && mongoose.connection.readyState === 1) return cachedConn;
  cachedConn = await mongoose.connect(MONGODB_URI);
  return cachedConn;
}

// ─── DB middleware — MUST be before routes ────────────────────────────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', repoRoutes);
app.use('/api', analyzeRoutes);
app.use('/api', reportRoutes);
app.use('/api', conflictRoutes);
app.use('/api', featureRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CodeGuard AI Server Running' });
});

// ─── Local dev: start express server ─────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  connectDB()
    .then(() => {
      console.log('✅ Connected to MongoDB');
      app.listen(PORT, () => {
        console.log(`🚀 CodeGuard AI server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('❌ MongoDB connection error:', err.message);
      process.exit(1);
    });
}

export default app;
