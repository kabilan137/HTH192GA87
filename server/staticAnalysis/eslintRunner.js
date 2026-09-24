/**
 * ESLint Static Analysis Runner
 *
 * Runs ESLint programmatically on JS/JSX file content (in-memory).
 * Restricted to .js/.jsx files only — other file types are skipped.
 * Uses eslint-plugin-security for security rules.
 */

import { Linter } from 'eslint';

// Create a shared Linter instance (no file I/O needed — we use verifyAndFix / verify)
const linter = new Linter();

// Register security rules
let securityRules = {};
try {
  const { default: secPlugin } = await import('eslint-plugin-security');
  if (secPlugin?.rules) {
    Object.entries(secPlugin.rules).forEach(([name, rule]) => {
      linter.defineRule(`security/${name}`, rule);
    });
    securityRules = Object.fromEntries(
      Object.keys(secPlugin.rules).map((name) => [`security/${name}`, 'warn'])
    );
    console.log(`✅ ESLint security plugin loaded with ${Object.keys(securityRules).length} rules`);
  }
} catch (e) {
  console.warn('⚠️  eslint-plugin-security not available:', e.message);
}

const BASE_RULES = {
  // Bugs
  'no-undef': 'error',
  'no-unused-vars': 'warn',
  eqeqeq: ['warn', 'always'],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-prototype-builtins': 'warn',
  'no-return-assign': 'error',
  'no-self-compare': 'error',
  'no-throw-literal': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  // Performance
  'no-loop-func': 'warn',
  'no-constant-condition': 'warn',
  // Maintainability
  'no-console': 'off',
  complexity: ['warn', { max: 15 }],
  'max-depth': ['warn', { max: 5 }],
  // Security (non-plugin)
  'no-new-func': 'error',
  ...securityRules,
};

const ESLINT_CONFIG = {
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: {
    es2022: true,
    browser: true,
    node: true,
  },
  rules: BASE_RULES,
};

/**
 * Map ESLint rule IDs to our category/severity system.
 */
function categorizeESLintRule(ruleId) {
  if (!ruleId) return { category: 'Code Smell - Stylistic', severity: 'low' };

  const rule = ruleId.toLowerCase();

  if (
    rule.includes('security') ||
    rule === 'no-eval' ||
    rule === 'no-implied-eval' ||
    rule === 'no-new-func'
  ) {
    return { category: 'Security Vulnerability', severity: 'high' };
  }

  if (
    rule === 'no-undef' ||
    rule === 'no-unreachable' ||
    rule === 'no-unsafe-finally' ||
    rule === 'no-unsafe-negation' ||
    rule === 'use-isnan' ||
    rule === 'valid-typeof' ||
    rule === 'no-return-assign' ||
    rule === 'no-throw-literal' ||
    rule === 'no-self-compare'
  ) {
    return { category: 'Bug - Certain', severity: 'high' };
  }

  if (
    rule === 'no-loop-func' ||
    rule === 'complexity' ||
    rule === 'max-depth'
  ) {
    return { category: 'Performance Risk', severity: 'medium' };
  }

  return { category: 'Code Smell - Stylistic', severity: 'low' };
}

/**
 * Run ESLint on a single file's content.
 *
 * @param {string} filename - The file path (used for display purposes, not I/O)
 * @param {string} content - The full file content as a string
 * @returns {Array} Array of normalized ESLint findings
 */
export function runESLintOnContent(filename, content) {
  // Only analyze JS/JSX files
  if (!filename.match(/\.(js|jsx|mjs|cjs)$/i)) {
    return [];
  }

  let messages = [];
  try {
    messages = linter.verify(content, ESLINT_CONFIG, { filename });
  } catch (e) {
    console.warn(`⚠️  ESLint parse error on ${filename}: ${e.message}`);
    return [];
  }

  return messages.map((msg) => {
    const { category, severity } = categorizeESLintRule(msg.ruleId);
    return {
      file: filename,
      line: msg.line || 1,
      column: msg.column || 0,
      ruleId: msg.ruleId || 'parse-error',
      message: msg.message,
      category,
      severity,
      confidence: 1.0, // Static analysis = certain
      source: 'static-only', // Will be upgraded to static+llm in merge step
    };
  });
}

/**
 * Run ESLint on multiple files.
 *
 * @param {Array<{filename: string, content: string}>} files
 * @returns {Array} All findings across all files
 */
export function runESLintOnFiles(files) {
  const allFindings = [];
  for (const { filename, content } of files) {
    if (!content) continue;
    const findings = runESLintOnContent(filename, content);
    allFindings.push(...findings);
    if (findings.length > 0) {
      console.log(`📋 ESLint: ${findings.length} issue(s) in ${filename}`);
    }
  }
  return allFindings;
}
