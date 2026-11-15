import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tokens = readFileSync(new URL('../../tokens.css', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const darkStart = tokens.indexOf('\n.dark {');
assert.ok(darkStart > 0, 'Light and dark tokens must be present');

const modes = {
  light: tokens.slice(0, darkStart),
  dark: tokens.slice(darkStart),
};

function linearRgb(css: string, name: string): number[] {
  const match = css.match(new RegExp('^\\s*' + name + ':\\s*oklch\\(([^)]+)\\);', 'm'));
  assert.ok(match, 'Missing OKLCH token ' + name);
  const [L, C, H] = match[1].trim().split(/\s+/).map(Number);
  assert.ok([L, C, H].every(Number.isFinite), 'Invalid OKLCH token ' + name);
  const a = C * Math.cos(H * Math.PI / 180);
  const b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
}

function luminance(rgb: number[]): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(first: number[], second: number[]): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('Stellar Mainnet and Testnet keyboard focus clears 3:1 in light and dark', () => {
  assert.match(runtime, /--color-focus: var\(--color-mainnet-focus\)/);
  assert.match(runtime, /--color-focus: var\(--color-info\)/);
  for (const [mode, css] of Object.entries(modes)) {
    const paper = linearRgb(css, '--color-paper');
    for (const focusName of ['--color-mainnet-focus', '--color-info', '--color-brand-wordmark-accent']) {
      const ratio = contrast(linearRgb(css, focusName), paper);
      assert.ok(ratio >= 3, mode + ' ' + focusName + ' focus contrast: ' + ratio.toFixed(2));
    }
  }
});

test('Mainnet gold wordmark text uses a readable brand token', () => {
  assert.match(runtime, /--color-brand-wordmark-accent\)/);
  for (const [mode, css] of Object.entries(modes)) {
    const ratio = contrast(
      linearRgb(css, '--color-brand-wordmark-accent'),
      linearRgb(css, '--color-paper'),
    );
    assert.ok(ratio >= 4.5, mode + ' gold brand wordmark contrast: ' + ratio.toFixed(2));
  }
});

test('Stellar Testnet action and danger labels clear 4.5:1 in light and dark', () => {
  for (const [mode, css] of Object.entries(modes)) {
    for (const [background, foreground] of [
      ['--color-info', '--color-info-ink'],
      ['--color-danger', '--color-danger-ink'],
    ]) {
      const ratio = contrast(linearRgb(css, background), linearRgb(css, foreground));
      assert.ok(ratio >= 4.5, mode + ' ' + background + ' action contrast: ' + ratio.toFixed(2));
    }
  }
});
