#!/usr/bin/env node
// Programmatic checks for the mechanical (grep-able) assertions of the
// prototype skill evals. The judgment-call assertions (screens exist, states
// reachable) are graded by the grader agent; this script covers the ones a
// regex can answer reliably, so they're checked identically every iteration.
//
// Usage: node check_mechanical.mjs <run-outputs-dir>
// Prints JSON: { checks: [{name, passed, evidence}] }

import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node check_mechanical.mjs <run-outputs-dir>');
  process.exit(1);
}

const all = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && f !== 'metrics.json');
const htmlFiles = all.filter((f) => f.endsWith('.html') || f.endsWith('.htm'));
// Files that would break "self-contained": separate css/js/assets next to the html.
const extraFiles = all.filter((f) => !htmlFiles.includes(f) && !f.endsWith('.md') && !f.endsWith('.txt') && !f.endsWith('.json'));

const checks = [];

checks.push({
  name: 'single-html-file',
  passed: htmlFiles.length === 1 && extraFiles.length === 0,
  evidence: `outputs dir contains html=[${htmlFiles.join(', ')}] other=[${extraFiles.join(', ') || 'none'}]`,
});

if (htmlFiles.length >= 1) {
  const file = path.join(dir, htmlFiles[0]);
  const src = fs.readFileSync(file, 'utf8');

  // Network data calls. CDN <script src> / <link href> tags are allowed; what
  // breaks the offline contract is runtime data fetching.
  const netCalls = src.match(/\b(fetch\s*\(|XMLHttpRequest|axios\.|navigator\.sendBeacon)/g) || [];
  checks.push({
    name: 'no-network-data-calls',
    passed: netCalls.length === 0,
    evidence: netCalls.length ? `found: ${[...new Set(netCalls)].join(', ')}` : 'no fetch/XHR/axios/sendBeacon in file',
  });

  // Local file references that would break double-click-to-open.
  const localRefs = [...src.matchAll(/(?:src|href)=["'](?!https?:|data:|#|javascript:|mailto:)([^"']+\.(?:js|css|png|jpg|svg|woff2?))["']/gi)].map((m) => m[1]);
  checks.push({
    name: 'no-local-file-references',
    passed: localRefs.length === 0,
    evidence: localRefs.length ? `references local files: ${localRefs.join(', ')}` : 'all src/href are CDN, data:, or anchors',
  });

  // Hardcoded data: some object/array literal assigned near the top of the script.
  const scriptBody = (src.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  const hasDataLiteral = /(?:const|let|var)\s+\w+\s*=\s*[\[{]/.test(scriptBody);
  checks.push({
    name: 'hardcoded-data-literal-present',
    passed: hasDataLiteral,
    evidence: hasDataLiteral ? 'found object/array literal assignment in inline script' : 'no inline object/array data found',
  });

  // Loading-state simulation hint.
  const hasTimeout = /setTimeout|setInterval/.test(scriptBody);
  checks.push({
    name: 'simulated-async-present',
    passed: hasTimeout,
    evidence: hasTimeout ? 'setTimeout/setInterval present (fake loading possible)' : 'no setTimeout/setInterval found',
  });
} else {
  for (const name of ['no-network-data-calls', 'no-local-file-references', 'hardcoded-data-literal-present', 'simulated-async-present']) {
    checks.push({ name, passed: false, evidence: 'no html file produced' });
  }
}

console.log(JSON.stringify({ dir, checks }, null, 2));
