#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

function run(cmd, options = {}) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe', ...options });
}

console.log(`[${new Date().toISOString()}] Starting daily prompt sync...`);

let changesDetected = false;

// 1. Fetch upstream changes if upstream remote exists
try {
  const remotes = run('git remote').split('\n').map((s) => s.trim()).filter(Boolean);
  if (remotes.includes('upstream')) {
    console.log('Fetching upstream...');
    run('git fetch upstream main');
    const diff = run('git diff HEAD..upstream/main').trim();
    if (diff) {
      console.log('Merging changes from upstream/main...');
      run('git merge upstream/main --no-edit');
      changesDetected = true;
    } else {
      console.log('Upstream is already up to date.');
    }
  }
} catch (err) {
  console.warn('Upstream fetch/merge warning:', err.message);
}

// 2. Re-generate site data and skills
try {
  console.log('Regenerating site data and skills...');
  run('npm run generate:site-data');
  run('npm run generate:style-skill');
  run('node scripts/install-style-skill.mjs all');
} catch (err) {
  console.error('Failed during generation or skill installation:', err.message);
}

// 3. Check git status for local modifications
const status = run('git status --porcelain').trim();
if (status) {
  changesDetected = true;
  console.log('Detected local changes:');
  console.log(status);

  try {
    console.log('Staging and committing changes...');
    run('git add .');
    const commitMsg = `chore(sync): automated daily prompts and skills update (${new Date().toISOString().slice(0, 10)})`;
    run(`git commit -m "${commitMsg}"`);
    console.log('Pushing to origin main...');
    run('git push origin main');
    console.log('Successfully pushed changes to remote origin main.');
  } catch (err) {
    console.error('Git commit/push error:', err.message);
  }
} else {
  console.log('No new changes to commit today.');
}

console.log(`[${new Date().toISOString()}] Daily prompt sync finished.`);
