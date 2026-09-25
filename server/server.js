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
  'https://client-delta-eight-56.vercel.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow any vercel domain (both preview and production) or localhost
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// ─── MongoDB connection (cached for Vercel serverless cold starts) ─────────────
let cachedConn = null;

async function connectDB() {
  if (cachedConn && mongoose.connection.readyState === 1) return cachedConn;
  if (!process.env.MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI environment variable is not set; falling back to localhost');
  }
  cachedConn = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  return cachedConn;
}

// ─── Root & Health Check Endpoints (Available without DB block) ───────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'CodeGuard AI Server is running',
    version: '1.0.0',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'CodeGuard AI Server Running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ─── DB middleware — only for API routes that need the database ────────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    res.status(500).json({
      error: 'Database connection failed',
      details: err.message,
      tip: 'Please set MONGODB_URI in Vercel environment variables to your MongoDB Atlas connection string and ensure IP 0.0.0.0/0 is allowed in Atlas Network Access.'
    });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', repoRoutes);
app.use('/api', analyzeRoutes);
app.use('/api', reportRoutes);
app.use('/api', conflictRoutes);
app.use('/api', featureRoutes);

// ─── Local dev: start express server ─────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  connectDB()
    .then(() => {
      console.log('✅ Connected to MongoDB');
      app.listen(PORT, () => {
        console.log(`🚀 CodeGuard AI server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('❌ MongoDB connection error:', err.message);
      app.listen(PORT, () => {
        console.log(`🚀 CodeGuard AI server running on http://localhost:${PORT} (without MongoDB)`);
      });
    });
}

export default app;
