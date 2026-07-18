import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'release', 'risk-tiers.json'), 'utf8'));
const args = process.argv.slice(2);
const valueAfter = flag => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const runGit = (command, options = {}) => execFileSync('git', [
  '-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...command
], { encoding: 'utf8', ...options }).trim();
const runGitRaw = command => execFileSync('git', [
  '-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...command
], { encoding: 'utf8' });

let base = valueAfter('--base');
const head = valueAfter('--head') || 'HEAD';
if (!base) {
  if (args.includes('--working-tree')) base = runGit(['rev-parse', head]);
  else {
    try { base = runGit(['rev-parse', `${head}^`]); }
    catch { base = runGit(['hash-object', '-t', 'tree', '--stdin'], { input: '' }); }
  }
}

const changed = new Set();
try {
  for (const file of runGit(['diff', '--name-only', `${base}...${head}`]).split(/\r?\n/)) {
    if (file) changed.add(file.replaceAll('\\', '/'));
  }
} catch {
  for (const file of runGit(['diff', '--name-only', base, head]).split(/\r?\n/)) {
    if (file) changed.add(file.replaceAll('\\', '/'));
  }
}

if (args.includes('--working-tree')) {
  const status = runGitRaw(['status', '--porcelain', '--untracked-files=all']).replace(/\r?\n$/, '');
  for (const line of status.split(/\r?\n/)) {
    if (!line) continue;
    const raw = line.slice(3).replace(/^.* -> /, '');
    changed.add(raw.replaceAll('\\', '/'));
  }
}

const classifications = [...changed].sort().map(file => {
  let tier = null;
  let reason = null;
  for (const rule of config.rules) {
    if (rule.patterns.some(pattern => new RegExp(pattern).test(file)) && (tier === null || rule.tier > tier)) {
      tier = rule.tier;
      reason = rule.reason;
    }
  }
  if (tier === null) {
    tier = config.defaultTier;
    reason = 'Unclassified path; conservative default';
  }
  return { file, tier, reason };
});
const tier = classifications.reduce((highest, item) => Math.max(highest, item.tier), 0);
const result = {
  base,
  head,
  tier,
  label: `Tier ${tier} — ${config.tiers[String(tier)]}`,
  files: classifications
};

if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(result.label);
  for (const item of classifications) console.log(`  T${item.tier}  ${item.file} — ${item.reason}`);
  if (!classifications.length) console.log('  No changed files detected.');
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = classifications.map(item => `| ${item.tier} | \`${item.file}\` | ${item.reason} |`).join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Change-risk classification\n\n**${result.label}**\n\n| Tier | File | Reason |\n|---:|---|---|\n${rows || '| 0 | — | No changed files |'}\n`);
}
