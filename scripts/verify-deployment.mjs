import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const manifestArg = args.find(value => !value.startsWith('--'));
const urlIndex = args.indexOf('--url');
const urlOverride = urlIndex >= 0 ? args[urlIndex + 1] : null;
const manifestPath = path.resolve(root, manifestArg || '');
if (!manifestArg || !manifestPath.startsWith(`${root}${path.sep}`)) {
  console.error('Usage: npm run release:verify-deployment -- release/baselines/<version>.json [--url https://preview.example/]');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const base = new URL(urlOverride || manifest.release.deploymentUrl);
if (base.protocol !== 'https:') throw new Error('Deployment verification requires HTTPS');
const failures = [];
let verified = 0;

async function verify(file, expected) {
  const url = new URL(file, base);
  url.searchParams.set('release-verify', manifest.release.candidateCommit);
  const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== expected.bytes) throw new Error(`size ${bytes.length}, expected ${expected.bytes}`);
  if (hash !== expected.sha256) throw new Error(`sha256 ${hash}, expected ${expected.sha256}`);
}

for (const [file, expected] of Object.entries(manifest.assets)) {
  try {
    await verify(file, expected);
    verified += 1;
    console.log(`PASS  ${file}`);
  } catch (error) {
    failures.push({ file, error: error.message });
    console.error(`FAIL  ${file} — ${error.message}`);
  }
}

if (failures.length) {
  console.error(`\nDEPLOYMENT VERIFICATION FAILED: ${failures.length} of ${Object.keys(manifest.assets).length} assets`);
  process.exitCode = 1;
} else {
  console.log(`\nDEPLOYMENT VERIFIED: ${verified} assets match ${manifest.release.candidateCommit}`);
}
