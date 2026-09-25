/**
 * Vercel Serverless Entry Point
 * 
 * Vercel rewrites /api/:path* → this file.
 * Our Express app registers routes under /api/..., so requests arrive correctly.
 */
import app from '../server/server.js';

export default app;
