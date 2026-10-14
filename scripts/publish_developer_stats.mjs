#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { copyFile, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUTS = [
  'profile/developer-stats-dark.svg',
  'profile/developer-stats-light.svg',
];
const GENERATION_INPUTS = [
  'scripts/publish_developer_stats.mjs',
  '.github/workflows/developer-stats.yml',
  'profile/stack-signals.config.json',
  'scripts/generate_stack_signals.mjs',
];

function parseArguments(args) {
  const options = { repoDir: REPO_ROOT, statsDir: null, baseSha: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--repo-dir' && args[index + 1]) options.repoDir = path.resolve(args[++index]);
    else if (args[index] === '--stats-dir' && args[index + 1]) options.statsDir = path.resolve(args[++index]);
    else if (args[index] === '--base-sha' && args[index + 1]) options.baseSha = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  if (!options.statsDir) throw new Error('Missing --stats-dir.');
  if (!options.baseSha || !/^[a-f0-9]{40,64}$/i.test(options.baseSha)) throw new Error('Missing or invalid --base-sha.');
  return options;
}

function git(repoDir, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`Git operation could not start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    if (args[0] === 'fetch') throw new Error('Git conflict: unable to fetch the latest main branch; no publication was attempted.');
    if (args[0] === 'merge') throw new Error('Git conflict: main could not be fast-forwarded safely; no publication was attempted.');
    if (args[0] === 'commit') throw new Error('Git conflict: unable to create the stats-only commit.');
    throw new Error(`Git operation failed (${args[0]} ${args[1] || ''}).`);
  }
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function currentRef(repoDir, ref) {
  return git(repoDir, ['rev-parse', ref]).stdout.trim();
}

function changedBetween(repoDir, from, to, files) {
  const result = git(repoDir, ['diff', '--quiet', from, to, '--', ...files], { allowFailure: true });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error('Git could not compare the workflow baseline with the current main branch.');
}

function verifyBranchIsDescendant(repoDir, baseSha, remoteTip) {
  const result = git(repoDir, ['merge-base', '--is-ancestor', baseSha, remoteTip], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error('Git conflict: main no longer descends from the workflow baseline; refusing to publish.');
  }
}

function checkUnchangedInputs(repoDir, baseSha, remoteTip) {
  if (changedBetween(repoDir, baseSha, remoteTip, GENERATION_INPUTS)) {
    throw new Error('Git conflict: Developer Stats generation or publishing inputs changed on main; rerun verification.');
  }
  if (changedBetween(repoDir, baseSha, remoteTip, OUTPUTS)) {
    throw new Error('Git conflict: a Developer Stats SVG changed on main after verification; refusing to overwrite it.');
  }
}

async function validateStatsDirectory(statsDir) {
  const expectedNames = OUTPUTS.map((name) => path.basename(name)).sort();
  let entries;
  try {
    entries = (await readdir(statsDir)).sort();
  } catch {
    throw new Error('Generation failure: the validated Developer Stats preview directory is missing.');
  }
  if (entries.length !== expectedNames.length || entries.some((name, index) => name !== expectedNames[index])) {
    throw new Error('Generation failure: preview directory must contain exactly the two Developer Stats SVGs.');
  }
  for (const name of expectedNames) {
    const filePath = path.join(statsDir, name);
    const fileInfo = await lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error(`Generation failure: ${name} is not a regular SVG file.`);
    }
    const content = await readFile(filePath, 'utf8');
    if (!/^\s*<svg\b/.test(content) || !/<\/svg>\s*$/.test(content)) {
      throw new Error(`Generation failure: ${name} does not contain a complete SVG document.`);
    }
  }
}

function checkWorkingTree(repoDir) {
  const status = git(repoDir, ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  if (status) throw new Error('Git conflict: checkout was not clean before publishing; refusing to overwrite local changes.');
}

function checkCommitPaths(repoDir) {
  const paths = git(repoDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
    .stdout.split(/\r?\n/).filter(Boolean).sort();
  const expected = [...OUTPUTS].sort();
  if (paths.length !== expected.length || paths.some((file, index) => file !== expected[index])) {
    throw new Error('Git conflict: generated commit contains files outside the two Developer Stats SVGs.');
  }
}

function pushFailureKind(output) {
  if (/GH006|GH013|403|permission to .* denied|protected branch|write access/i.test(output)) return 'Push permission failure';
  if (/non-fast-forward|fetch first|rejected/i.test(output)) return 'Git conflict';
  return 'Push/network failure';
}

async function publish({ repoDir, statsDir, baseSha }) {
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.toLowerCase() !== 'dpsychoo/dpsychoo') {
    throw new Error('Git conflict: publisher is restricted to dpsychoo/dpsychoo.');
  }
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Git conflict: publisher is restricted to workflow runs started on main.');
  }
  await validateStatsDirectory(statsDir);
  checkWorkingTree(repoDir);
  if (currentRef(repoDir, 'HEAD') !== baseSha) {
    throw new Error('Git conflict: checkout does not match the workflow baseline SHA.');
  }

  git(repoDir, ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  let remoteTip = currentRef(repoDir, 'refs/remotes/origin/main');
  verifyBranchIsDescendant(repoDir, baseSha, remoteTip);
  checkUnchangedInputs(repoDir, baseSha, remoteTip);
  if (remoteTip !== baseSha) git(repoDir, ['merge', '--ff-only', 'refs/remotes/origin/main']);

  for (const output of OUTPUTS) {
    await copyFile(path.join(statsDir, path.basename(output)), path.join(repoDir, output));
  }
  git(repoDir, ['add', '--', ...OUTPUTS]);
  if (git(repoDir, ['diff', '--cached', '--quiet'], { allowFailure: true }).status === 0) {
    console.log('Generated Developer Stats SVGs match main; no commit is needed.');
    return;
  }

  const staged = git(repoDir, ['diff', '--cached', '--name-only']).stdout.split(/\r?\n/).filter(Boolean).sort();
  const expected = [...OUTPUTS].sort();
  if (staged.length !== expected.length || staged.some((file, index) => file !== expected[index])) {
    throw new Error('Git conflict: refusing to stage any files outside the two Developer Stats SVGs.');
  }

  git(repoDir, ['config', 'user.name', 'github-actions[bot]']);
  git(repoDir, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(repoDir, ['commit', '-m', 'chore: refresh public contribution stats']);
  checkCommitPaths(repoDir);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforePush = currentRef(repoDir, 'refs/remotes/origin/main');
    const push = git(repoDir, ['push', 'origin', 'HEAD:refs/heads/main'], { allowFailure: true });
    if (push.status === 0) {
      console.log(`Published only ${OUTPUTS.join(' and ')} to main.`);
      return;
    }

    git(repoDir, ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
    remoteTip = currentRef(repoDir, 'refs/remotes/origin/main');
    if (remoteTip === beforePush) {
      throw new Error(`${pushFailureKind(push.output)}: GitHub did not accept the Developer Stats commit.`);
    }
    if (attempt === 1) {
      throw new Error('Git conflict: main advanced during both safe push attempts; rerun the workflow.');
    }

    verifyBranchIsDescendant(repoDir, baseSha, remoteTip);
    checkUnchangedInputs(repoDir, baseSha, remoteTip);
    try {
      git(repoDir, ['rebase', 'refs/remotes/origin/main']);
    } catch {
      git(repoDir, ['rebase', '--abort'], { allowFailure: true });
      throw new Error('Git conflict: safe rebase onto the latest main failed; no force push was attempted.');
    }
    checkCommitPaths(repoDir);
  }

  throw new Error('Git conflict: publishing stopped without a successful push.');
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    await publish(options);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
