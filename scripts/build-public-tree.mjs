import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
if (outputIndex < 0 || !args[outputIndex + 1]) {
  throw new Error('Usage: node scripts/build-public-tree.mjs --out <directory>');
}

const sourceRoot = process.cwd();
const outputRoot = resolve(args[outputIndex + 1]);
const excludedPaths = new Set(['.gitea', 'AGENTS.md', 'opencode.jsonc']);
const privateMarkers = [
  /git\.labsyd\.cc/i,
  /qcnx[_-]lab/i,
  /\/home\/qcnx\b/i,
  /\/app\/openCodePortalGateway\b/i,
  /runs-on:\s*\[\s*cd\s*,\s*sta\s*,\s*gateway\s*\]/i,
];

mkdirSync(outputRoot, { recursive: true });
for (const entry of readdirSync(outputRoot)) {
  if (entry === '.git') continue;
  rmSync(join(outputRoot, entry), { recursive: true, force: true });
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: sourceRoot,
  encoding: 'buffer',
}).toString('utf8').split('\0').filter(Boolean);

for (const file of trackedFiles) {
  if ([...excludedPaths].some((excluded) => file === excluded || file.startsWith(`${excluded}/`))) {
    continue;
  }
  const source = join(sourceRoot, file);
  const destination = join(outputRoot, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const file of collectFiles(outputRoot)) {
  const outputPath = relative(outputRoot, file);
  if (outputPath === '.git' || outputPath.startsWith('.git/') || outputPath === 'scripts/build-public-tree.mjs') continue;
  const content = readFileSync(file, 'utf8');
  for (const marker of privateMarkers) {
    if (marker.test(content)) {
      violations.push(`${outputPath} matches ${marker}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Public projection contains private markers:\n${violations.join('\n')}`);
}

console.log(`Public projection created at ${outputRoot} from ${trackedFiles.length} tracked files.`);
