import * as assert from 'assert';
import * as vscode from 'vscode';
import { BranchSync } from '../../src/BranchSync';
import {
    FIXTURE_BRANCH,
    MANAGED_BG_KEY,
    clearRegistry,
    effectiveColors,
    fakeContext,
    gitCheckout,
    gitCreateAndCheckout,
    injectPeer,
    ourEntry,
    redIsApplied,
    refreshAndSettle,
    removePeer,
    resetColors,
    resetFixtureRepoToInitialBranch,
    setGroup,
    setHeartbeatMs,
    setStaleMs,
    updatePeer,
    waitForBranch,
    waitForCondition,
} from '../helpers/testEnv';

/**
 * End-to-end feature tests for the user-facing behavior: the title/status/
 * activity bars go red whenever any *live peer in the same group* is on a
 * different branch, and clear again as soon as the peers realign.
 *
 * Peers are simulated by writing directly into the shared registry file —
 * the same channel real VS Code instances use to talk to each other.
 *
 * The last three tests drive branch changes through the vscode.git API in
 * this window to cover the "user switches branches mid-session" path.
 */

const GROUP = 'e2e-test';
const DIVERGENT_BRANCH = 'feat/x';
const SESSION_BRANCH = 'feat/in-session-checkout';
const SESSION_BRANCH_ALT = 'feat/in-session-checkout-2';

suite('End-to-end multi-instance (feature)', () => {
    let instance: BranchSync | undefined;

    suiteSetup(async () => {
        assert.ok(
            process.env.BRANCH_SYNC_DISABLE_AUTO_START,
            'BRANCH_SYNC_DISABLE_AUTO_START must be set so the extension does not auto-start a competing BranchSync',
        );
        assert.ok(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0,
            'tests require the fixture workspace folder',
        );
    });

    setup(async () => {
        await setGroup(undefined);
        await setHeartbeatMs(undefined);
        await setStaleMs(undefined);
        await resetColors();
        clearRegistry();
    });

    teardown(async () => {
        if (instance) {
            instance.dispose();
            instance = undefined;
        }
        await setGroup(undefined);
        await setHeartbeatMs(undefined);
        await setStaleMs(undefined);
        await resetColors();
        clearRegistry();
        // Restore the fixture repo to its initial branch in case a test
        // checked something else out via the vscode.git API.
        await resetFixtureRepoToInitialBranch([SESSION_BRANCH, SESSION_BRANCH_ALT]);
    });

    test('peer on the same branch as us → no red', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: GROUP, branch: FIXTURE_BRANCH });
        await refreshAndSettle();

        assert.strictEqual(redIsApplied(), false, 'red should not be applied when peer matches');
    });

    test('peer on a different branch → red applied', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: GROUP, branch: DIVERGENT_BRANCH });
        await refreshAndSettle();

        await waitForCondition(
            () => redIsApplied(),
            3000,
            'red applied when peer diverges',
        );
    });

    test('peer "switches" to our branch → red clears (recovery via match)', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        const peerId = injectPeer({ group: GROUP, branch: DIVERGENT_BRANCH });
        await refreshAndSettle();
        await waitForCondition(() => redIsApplied(), 3000, 'red applied');

        updatePeer(peerId, { branch: FIXTURE_BRANCH });
        await refreshAndSettle();

        await waitForCondition(
            () => !redIsApplied(),
            3000,
            'red cleared after peer catches up',
        );
    });

    test('peer "closes its window" → red clears (recovery via removal)', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        const peerId = injectPeer({ group: GROUP, branch: DIVERGENT_BRANCH });
        await refreshAndSettle();
        await waitForCondition(() => redIsApplied(), 3000, 'red applied');

        removePeer(peerId);
        await refreshAndSettle();

        await waitForCondition(
            () => !redIsApplied(),
            3000,
            'red cleared after peer disappears',
        );
    });

    test('mixed peers: one diverging out of three → red stays on until it aligns', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ id: 'aligned-1', group: GROUP, branch: FIXTURE_BRANCH });
        injectPeer({ id: 'aligned-2', group: GROUP, branch: FIXTURE_BRANCH });
        injectPeer({ id: 'divergent', group: GROUP, branch: DIVERGENT_BRANCH });

        await refreshAndSettle();
        await waitForCondition(
            () => redIsApplied(),
            3000,
            'red applied with one divergent peer among three',
        );

        updatePeer('divergent', { branch: FIXTURE_BRANCH });
        await refreshAndSettle();

        await waitForCondition(
            () => !redIsApplied(),
            3000,
            'red cleared once every peer matches',
        );
    });

    test('stale peer (heartbeat ancient) is ignored — no red', async () => {
        await setStaleMs(200);
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({
            group: GROUP,
            branch: DIVERGENT_BRANCH,
            updatedAt: Date.now() - 10_000,
        });
        await refreshAndSettle();

        assert.strictEqual(redIsApplied(), false, 'stale peer should be ignored');
    });

    test('peer in a different group is invisible — no red', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: 'other-project', branch: DIVERGENT_BRANCH });
        await refreshAndSettle();

        assert.strictEqual(
            redIsApplied(),
            false,
            'peer in a different group should be invisible',
        );
    });

    test('peer with null branch (still loading) is ignored — no red', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: GROUP, branch: null as unknown as string });
        await refreshAndSettle();

        assert.strictEqual(redIsApplied(), false, 'peer with null branch should be ignored');
    });

    test('our branch changes mid-session → red applied when it diverges from a peer', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        // Peer is on our current branch — no red yet.
        injectPeer({ group: GROUP, branch: FIXTURE_BRANCH });
        await refreshAndSettle();
        assert.strictEqual(redIsApplied(), false, 'precondition: aligned, no red');

        // Now WE check out a new branch in this very window. GitWatcher
        // should detect the change, update our entry, and trigger a
        // mismatch against the peer.
        await gitCreateAndCheckout(SESSION_BRANCH);

        await waitForCondition(
            () => redIsApplied(),
            5000,
            `red applied after our window switched to ${SESSION_BRANCH}; peer still on ${FIXTURE_BRANCH}`,
        );
        assert.strictEqual(
            ourEntry()?.branch,
            SESSION_BRANCH,
            'our registry entry should reflect the new branch',
        );
    });

    test('our branch changes mid-session → red clears when it aligns with the peer', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        // Peer is on a different branch — red is on.
        injectPeer({ group: GROUP, branch: SESSION_BRANCH });
        await refreshAndSettle();
        await waitForCondition(
            () => redIsApplied(),
            3000,
            `red applied while peer is on ${SESSION_BRANCH} and we are on ${FIXTURE_BRANCH}`,
        );

        // Now WE check out the peer's branch. Red should clear.
        await gitCreateAndCheckout(SESSION_BRANCH);

        await waitForCondition(
            () => !redIsApplied(),
            5000,
            "red cleared after we caught up to the peer's branch in-session",
        );
        assert.strictEqual(ourEntry()?.branch, SESSION_BRANCH);
    });

    test('toggling our branch back and forth toggles red on and off correctly', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        // Peer pinned to FIXTURE_BRANCH for the duration.
        injectPeer({ group: GROUP, branch: FIXTURE_BRANCH });
        await refreshAndSettle();
        assert.strictEqual(redIsApplied(), false, 'aligned at start');

        // Diverge.
        await gitCreateAndCheckout(SESSION_BRANCH_ALT);
        await waitForCondition(() => redIsApplied(), 5000, 'red on after diverging');

        // Realign.
        await gitCheckout(FIXTURE_BRANCH);
        await waitForCondition(() => !redIsApplied(), 5000, 'red off after realigning');

        // Diverge again.
        await gitCheckout(SESSION_BRANCH_ALT);
        await waitForCondition(() => redIsApplied(), 5000, 'red on after diverging again');

        // The configured color should be the package.json default (not
        // some leftover color from a previous apply).
        assert.strictEqual(effectiveColors()[MANAGED_BG_KEY], '#c41e3a');
    });

    test('full recovery cycle: diverge → realign → diverge again applies red twice', async () => {
        await setGroup(GROUP);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        const peerId = injectPeer({ group: GROUP, branch: DIVERGENT_BRANCH });
        await refreshAndSettle();
        await waitForCondition(() => redIsApplied(), 3000, 'first divergence → red on');

        updatePeer(peerId, { branch: FIXTURE_BRANCH });
        await refreshAndSettle();
        await waitForCondition(() => !redIsApplied(), 3000, 'realign → red off');

        updatePeer(peerId, { branch: 'feat/something-else' });
        await refreshAndSettle();
        await waitForCondition(
            () => redIsApplied(),
            3000,
            'second divergence → red on again',
        );

        assert.strictEqual(
            effectiveColors()[MANAGED_BG_KEY],
            '#c41e3a',
            'managed bg should be the default red',
        );
    });
});
