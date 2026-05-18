#!/usr/bin/env node
/**
 * Initializes the fixture git repo used as the workspace folder for
 * integration tests.
 *
 * The fixture is *always* rebuilt from scratch. Earlier versions had an
 * "already initialized" short-circuit that would reuse the previous run's
 * .git directory — that turned out to be a foot-gun: if any previous run
 * crashed partway through `git init`, the half-baked .git (no objects/,
 * leftover config.lock, etc.) would be reused forever and `git status`
 * inside the container would report "not a git repository", which in turn
 * makes vscode.git find no repositories and BranchSync's branch detection
 * never fires.
 *
 * Cost of rebuilding is < 100ms, so we just do it every time.
 *
 * Run via `npm run fixture:integration` (chained from pretest:integration).
 * The fixture lives at `tests-integration/fixtures/test-repo/` and is
 * gitignored.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'test-repo');
const FIXTURE_BRANCH = 'fixture-branch';

function sh(cmd, cwd) {
    execSync(cmd, {
        cwd,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
}

function rebuild() {
    // Nuke any prior state so we never inherit a corrupt .git from a
    // previous run.
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIXTURE_DIR, 'README.md'), '# Branch Sync test fixture\n');

    sh(`git init -b ${FIXTURE_BRANCH}`, FIXTURE_DIR);
    sh('git config user.email "test@branch-buddy.local"', FIXTURE_DIR);
    sh('git config user.name "Branch Sync Tests"', FIXTURE_DIR);
    sh('git add .', FIXTURE_DIR);
    sh('git commit -m "fixture init"', FIXTURE_DIR);
}

function verify() {
    // Sanity-check the repo is real before tests even start. Without this,
    // a silent failure during init would surface as a mysterious 10s
    // timeout in waitForBranch().
    try {
        execSync('git rev-parse HEAD', {
            cwd: FIXTURE_DIR,
            stdio: 'ignore',
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
    } catch {
        console.error(`[fixture] FATAL: ${FIXTURE_DIR} is not a valid git repo after init`);
        console.error('[fixture] contents of .git:');
        try {
            console.error(fs.readdirSync(path.join(FIXTURE_DIR, '.git')).join('\n'));
        } catch (e) {
            console.error('[fixture] could not list .git:', e);
        }
        process.exit(1);
    }
}

console.log(`[fixture] rebuilding ${FIXTURE_DIR} on branch ${FIXTURE_BRANCH}`);
rebuild();
verify();
console.log('[fixture] done');
