#!/usr/bin/env node
// Reject new UI color literals and palette utilities without rewriting legacy styling.
// This guard intentionally checks added lines in the PR, not the existing backlog.
import { execFileSync } from 'node:child_process';

const baseFlag = process.argv.indexOf('--base');
const base = baseFlag >= 0 ? process.argv[baseFlag + 1] : '';
if (!/^[0-9a-f]{40}$/i.test(base)) {
  console.error('Usage: node scripts/check-ui-design.mjs --base <40-character-base-commit-sha>');
  process.exit(2);
}

let diff;
try {
  diff = execFileSync('git', [
    'diff', '--no-ext-diff', '--unified=0', '--diff-filter=ACMR',
    base + '...HEAD', '--', 'apps/stellar-web/src', 'apps/web/src',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
} catch (error) {
  console.error('Unable to compare UI changes with the PR base:', error.message);
  process.exit(2);
}

const literalColor = /(?:^|[^\w-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i;
const colorFunction = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/i;
const paletteUtility = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline)-(?:emerald|sky|violet|amber|red|lime|green|blue|purple|pink|yellow|orange|indigo)-\d{2,3}\b/;
const hardcodedFont = /\bfont-family\s*:\s*(?!var\(|inherit\b|initial\b|unset\b)/i;
const failures = [];
let file = '';
let lineNumber = 0;

for (const line of diff.split('\n')) {
  if (line.startsWith('diff --git ')) {
    file = '';
    continue;
  }
  if (line.startsWith('+++ b/')) {
    file = line.slice(6);
    continue;
  }
  const hunk = /^@@ [^+]*\+(\d+)(?:,\d+)? @@/.exec(line);
  if (hunk) {
    lineNumber = Number(hunk[1]);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const code = line.slice(1);
  const isSource = /\.(?:css|jsx?|tsx?)$/.test(file);
  if (!isSource) {
    lineNumber++;
    continue;
  }
  const problems = [];
  if (literalColor.test(code) || colorFunction.test(code)) problems.push('literal color');
  if (paletteUtility.test(code)) problems.push('palette utility');
  if (file.endsWith('.css') && hardcodedFont.test(code)) problems.push('hard-coded font family');
  if (problems.length > 0) {
    failures.push(file + ':' + lineNumber + ': ' + problems.join(', ') + '\n  ' + code.trim());
  }
  lineNumber++;
}

if (failures.length > 0) {
  console.error('UI design guard: ' + failures.length + ' new style violation(s).\n');
  console.error(failures.join('\n'));
  console.error('\nUse semantic tokens from tokens.css and shared components such as ActionButton/StatusBadge.');
  console.error('Network color is an environment fact; status color must reflect the operation state.');
  process.exit(1);
}
console.log('UI design guard: no new palette literals or utilities in changed UI lines.');
