import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import repoRoutes from './routes/repos.js';
import analyzeRoutes from './routes/analyze.js';
import reportRoutes from './routes/reports.js';

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codeguard';

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', repoRoutes);
app.use('/api', analyzeRoutes);
app.use('/api', reportRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CodeGuard AI Server Running' });
});

// Connect to MongoDB and start server
mongoose
  .connect(MONGODB_URI)
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

export default app;
