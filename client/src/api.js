/**
 * Centralized API configuration for CodeGuard AI
 *
 * When deployed separately on Vercel:
 * 1. Checks `import.meta.env.VITE_API_URL` (set in Vercel Client project environment variables)
 * 2. In production on *.vercel.app: defaults to 'https://hth-192-ga-87.vercel.app'
 * 3. In local development (localhost): uses '' (relative path handled by Vite proxy to http://localhost:3001)
 */

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  // Auto-detect if running on Vercel frontend without explicit VITE_API_URL
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app')) {
    return 'https://hth-192-ga-87.vercel.app';
  }
  return '';
};

export const API_BASE_URL = getBaseUrl();

/**
 * Returns the full API URL for a given relative endpoint path
 * @param {string} path - e.g. '/api/analyze' or '/api/repos/owner/repo/pulls'
 * @returns {string} - e.g. 'https://hth-192-ga-87.vercel.app/api/analyze' or '/api/analyze'
 */
export function apiUrl(path) {
  if (!path) return API_BASE_URL;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/**
 * Enhanced fetch wrapper that:
 * 1. Automatically prefixes relative /api paths with API_BASE_URL
 * 2. Passes options through to standard fetch
 * @param {string} path - API endpoint path
 * @param {RequestInit} [options] - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const url = apiUrl(path);
  return fetch(url, options);
}

export default apiFetch;
