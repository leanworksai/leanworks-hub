#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const skippedPaths = /^(?:dist|node_modules|coverage)\//;
const skippedFiles = /(?:^|\/)(?:package-lock\.json|bun\.lockb)$/;
const skippedExtensions = /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz|mp[34]|mov)$/i;
const safeValues = new Set([
  'mock-token-demo',
  'leanworks_custom_token',
  'leanworks_user_data',
  'your-api-key',
  'AIzaSyBypassKeyForServiceAccount',
]);

const providerPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Google service-account key', /"type"\s*:\s*"service_account"[\s\S]{0,1000}"private_key"\s*:/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[opusr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{80,255})\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
];

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !skippedPaths.test(file) && !skippedFiles.test(file) && !skippedExtensions.test(file));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const [label, pattern] of providerPatterns) {
    const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of content.matchAll(globalPattern)) {
      const matchedLine = content.split('\n')[lineNumber(content, match.index) - 1] || '';
      if (!/placeholder|example|mock|your-/i.test(matchedLine)) {
        findings.push(`${file}:${lineNumber(content, match.index)}: ${label}`);
      }
    }
  }

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (/process\.env|import\.meta\.env|secretManager|placeholder|example|malformed|LEGACY_/i.test(line)) return;

    const assignment = line.match(
      /(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|credential)\s*(?::|=)\s*['"]([^'"]{20,})['"]/i,
    );
    const encodedLiteral = line.match(/['"]([A-Za-z0-9+/]{40,}={0,2})['"]/);
    const candidate = assignment?.[1] || encodedLiteral?.[1];
    if (!candidate || safeValues.has(candidate)) return;
    if (entropy(candidate) >= 3.5) {
      findings.push(`${file}:${index + 1}: high-entropy hard-coded credential`);
    }
  });
}

if (findings.length > 0) {
  console.error('Potential credentials detected:\n' + findings.map((finding) => `- ${finding}`).join('\n'));
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} tracked text files checked).`);
