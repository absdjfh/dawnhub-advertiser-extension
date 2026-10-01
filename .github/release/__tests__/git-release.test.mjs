import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
    ReleaseGitError,
    assertBoundaryRemoteState,
    buildBoundaryPushArguments,
    checkoutMarkerCommit,
    classifySource,
    HOSTED_BRANCH,
    createGitRunner,
    publishHostedBranch,
    publishSite,
    seedHostedWorkspace,
    evaluateIntentMarkers,
    readAuthoritativeTip,
    readIntentMarker,
} from '../git-release.mjs';

const SOURCE = 'a'.repeat(40);
const VERSION_COMMIT = 'b'.repeat(40);

const inputs = {
    sourceSha: SOURCE,
    releaseIntentId: 'bot-request-42',
};

function marker(overrides = {}) {
    return {
        schemaVersion: '1.0',
        status: 'boundary-crossed',
        releaseIntentId: 'older-intent',
        approvedSourceSha: 'c'.repeat(40),
        githubRunId: '12345',
        ...overrides,
    };
}

describe('authoritative tip lookup', () => {
    function fakeGit(stdout) {
        return {run: () => ({status: 0, stdout, stderr: ''})};
    }

    it('reads the exact master tip over the network for a blank source SHA', () => {
        const calls = [];
        const git = {
            run(args, options) {
                calls.push({args, options});
                return {status: 0, stdout: `${SOURCE}\trefs/heads/master\n`, stderr: ''};
            },
        };
        expect(readAuthoritativeTip(git)).toBe(SOURCE);
        expect(calls[0].args).toEqual(['ls-remote', '--refs', 'origin', 'refs/heads/master']);
        expect(calls[0].options.network).toBe(true);
    });

    it.each([
        ['', 'AUTHORITATIVE_BRANCH_MISSING'],
        [`${SOURCE}\trefs/heads/master\n${VERSION_COMMIT}\trefs/heads/master\n`, 'REMOTE_REF_AMBIGUOUS'],
        [`${SOURCE}\trefs/heads/masterful\n`, 'REMOTE_REF_MISMATCH'],
        ['aaaa\trefs/heads/master\n', 'INVALID_GIT_SHA'],
    ])('refuses to resolve a tip from %j', (stdout, code) => {
        expect(() => readAuthoritativeTip(fakeGit(stdout))).toThrow(
            expect.objectContaining({name: 'ReleaseGitError', code}),
        );
    });
});

describe('exact source policy', () => {
    it('accepts only the approved SHA equal to the master tip', () => {
        expect(classifySource({sourceSha: SOURCE, masterTip: SOURCE, exists: true, isAncestor: true})).toBe(SOURCE);
    });

    it('rejects a stale source SHA', () => {
        expect(() => classifySource({
            sourceSha: SOURCE,
            masterTip: 'd'.repeat(40),
            exists: true,
            isAncestor: true,
        })).toThrowError(expect.objectContaining({code: 'SOURCE_STALE'}));
    });

    it('rejects a missing SHA', () => {
        expect(() => classifySource({sourceSha: SOURCE, masterTip: SOURCE, exists: false, isAncestor: false}))
            .toThrowError(expect.objectContaining({code: 'SOURCE_NOT_FOUND'}));
    });

    it('rejects a SHA on unrelated history', () => {
        expect(() => classifySource({sourceSha: SOURCE, masterTip: 'd'.repeat(40), exists: true, isAncestor: false}))
            .toThrowError(expect.objectContaining({code: 'SOURCE_UNRELATED'}));
    });

    it('rejects master movement at the guarded push boundary', () => {
        expect(() => assertBoundaryRemoteState({
            remoteMasterSha: 'd'.repeat(40),
            expectedSourceSha: SOURCE,
            intentRefSha: null,
            versionRefSha: null,
        })).toThrowError(expect.objectContaining({code: 'MASTER_MOVED'}));
    });
});

describe('reconciliation checkout', () => {
    function fakeGit(overrides = {}) {
        const calls = [];
        const git = {
            run(args, options) {
                calls.push({args, options});
                if (args[0] === 'cat-file') {
                    return {status: overrides.exists === false ? 1 : 0, stdout: '', stderr: ''};
                }
                if (args[0] === 'status') {
                    return {status: 0, stdout: overrides.dirty ? 'M package.json\n' : '', stderr: ''};
                }
                if (args[0] === 'checkout') {
                    return {status: 0, stdout: '', stderr: ''};
                }
                if (args[0] === 'rev-parse') {
                    return {status: 0, stdout: `${overrides.head ?? VERSION_COMMIT}\n`, stderr: ''};
                }
                throw new Error(`Unexpected git command in test: ${args.join(' ')}`);
            },
        };
        return {git, calls};
    }

    it('checks out the exact marker commit', () => {
        const {git, calls} = fakeGit();
        expect(checkoutMarkerCommit(marker({versionCommitSha: VERSION_COMMIT}), git)).toBe(VERSION_COMMIT);
        expect(calls.some(call => call.args[0] === 'checkout' && call.args.includes(VERSION_COMMIT))).toBe(true);
    });

    it('refuses a marker commit missing from this checkout', () => {
        const {git} = fakeGit({exists: false});
        expect(() => checkoutMarkerCommit(marker({versionCommitSha: VERSION_COMMIT}), git))
            .toThrowError(expect.objectContaining({code: 'SOURCE_NOT_FOUND'}));
    });

    it('refuses a dirty checkout before switching commits', () => {
        const {git} = fakeGit({dirty: true});
        expect(() => checkoutMarkerCommit(marker({versionCommitSha: VERSION_COMMIT}), git))
            .toThrowError(expect.objectContaining({code: 'DIRTY_CHECKOUT'}));
    });

    it('refuses if HEAD does not land on the requested commit', () => {
        const {git} = fakeGit({head: SOURCE});
        expect(() => checkoutMarkerCommit(marker({versionCommitSha: VERSION_COMMIT}), git))
            .toThrowError(expect.objectContaining({code: 'CHECKOUT_MISMATCH'}));
    });
});

describe('hosted branch publication', () => {
    const originalCwd = process.cwd();
    let root;
    let origin;
    let work;
    let git;

    function sh(cwd, ...args) {
        const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
        if (result.status !== 0) {
            throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
        }
        return result.stdout.trim();
    }

    function write(file, content) {
        mkdirSync(dirname(join(work, file)), {recursive: true});
        writeFileSync(join(work, file), content);
    }

    function listBranch() {
        return sh(origin, 'ls-tree', '-r', '--name-only', HOSTED_BRANCH).split('\n').sort();
    }

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'hosted-branch-'));
        origin = join(root, 'origin.git');
        work = join(root, 'work');
        mkdirSync(work);
        sh(root, 'init', '--bare', '--initial-branch=master', origin);
        sh(work, 'init', '--initial-branch=master');
        sh(work, 'remote', 'add', 'origin', origin);
        write('.gitignore', '.output\n');
        write('hosted/index.html', 'site v1');
        write('hosted/releases.json', '{"master":"frozen"}');
        write('hosted/old-master.zip', 'frozen binary');
        sh(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
        sh(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init');
        sh(work, 'push', 'origin', 'master');
        process.chdir(work);
        git = createGitRunner('token');
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(root, {recursive: true, force: true});
    });

    it('bootstraps the branch from the workspace when it does not exist yet', () => {
        expect(seedHostedWorkspace(git).bootstrapped).toBe(true);
        const result = {components: {}};
        publishHostedBranch(result, git, {version: '26.9.15'});

        expect(listBranch()).toEqual(['hosted/index.html', 'hosted/old-master.zip', 'hosted/releases.json']);
        expect(sh(origin, 'rev-list', '--count', HOSTED_BRANCH)).toBe('1');
        expect(sh(origin, 'rev-list', '--parents', '-n', '1', HOSTED_BRANCH).split(' ')).toHaveLength(1);
        expect(result.components.hostedCommit.status).toBe('success');
        // master itself was never committed to or staged.
        expect(sh(work, 'status', '--porcelain', '--untracked-files=no')).toBe('');
        expect(sh(origin, 'rev-parse', 'master')).toBe(sh(work, 'rev-parse', 'HEAD'));
    });

    it('restores generated files from the branch, drops master\'s frozen copies, and keeps history at one commit', () => {
        seedHostedWorkspace(git);
        write('hosted/26.9.15.zip', Buffer.from([0, 255, 1, 128]));
        publishHostedBranch({components: {}}, git);

        // A later release: master's frozen binary must not come back, the
        // branch's binary must arrive byte-exact, and pruned files must vanish.
        writeFileSync(join(work, 'hosted/index.html'), 'site v2 from master');
        sh(work, 'checkout', '--', 'hosted/old-master.zip');
        seedHostedWorkspace(git);
        expect(readFileSync(join(work, 'hosted/26.9.15.zip'))).toEqual(Buffer.from([0, 255, 1, 128]));
        expect(readFileSync(join(work, 'hosted/releases.json'), 'utf8')).toBe('{"master":"frozen"}');
        expect(readFileSync(join(work, 'hosted/index.html'), 'utf8')).toBe('site v2 from master');

        rmSync(join(work, 'hosted/26.9.15.zip'));
        write('hosted/26.9.16.zip', 'next');
        publishHostedBranch({components: {}}, git);
        expect(listBranch()).toEqual(['hosted/26.9.16.zip', 'hosted/index.html', 'hosted/old-master.zip', 'hosted/releases.json']);
        expect(sh(origin, 'rev-list', '--count', HOSTED_BRANCH)).toBe('1');
    });

    it('refuses to overwrite a hosted branch that moved after seeding', () => {
        seedHostedWorkspace(git);
        publishHostedBranch({components: {}}, git);
        seedHostedWorkspace(git);

        const other = join(root, 'other');
        sh(root, 'clone', '--branch', HOSTED_BRANCH, origin, other);
        writeFileSync(join(other, 'hosted', 'index.html'), 'concurrent');
        sh(other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-am', 'concurrent');
        sh(other, 'push', 'origin', HOSTED_BRANCH);

        const result = {components: {}};
        expect(() => publishHostedBranch(result, git)).toThrowError(expect.objectContaining({code: 'HOSTED_BRANCH_MOVED'}));
        expect(result.components.hostedCommit.status).toBe('ambiguous');
    });

    it('refuses to publish without a seed', () => {
        expect(() => publishHostedBranch({components: {}}, git))
            .toThrowError(expect.objectContaining({code: 'HOSTED_NOT_SEEDED'}));
    });

    describe('site-only publication', () => {
        // The state a release leaves behind, seen from a fresh checkout of
        // master: the branch serves a package and a manifest master has never
        // seen, so only a working restore from the branch can reproduce them.
        beforeEach(() => {
            seedHostedWorkspace(git);
            write('hosted/26.9.15.zip', Buffer.from([0, 255, 1, 128]));
            write('hosted/releases.json', '{"branch":"manifest"}');
            publishHostedBranch({components: {}}, git);
            sh(work, 'checkout', '--', 'hosted');
            rmSync(join(work, 'hosted/26.9.15.zip'));
        });

        function commitSiteEdit(files) {
            for (const [file, content] of Object.entries(files)) {
                write(file, content);
            }
            sh(work, 'add', '--', ...Object.keys(files));
            sh(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'site edit');
            return sh(work, 'rev-parse', 'HEAD');
        }

        it('publishes master\'s site files and carries every download over byte-exact', () => {
            const sourceSha = commitSiteEdit({'hosted/index.html': 'site v2', 'hosted/guide.html': 'guide'});
            seedHostedWorkspace(git);

            const published = publishSite(git, {sourceSha});

            expect(published.changes).toEqual([
                {status: 'A', path: 'hosted/guide.html'},
                {status: 'M', path: 'hosted/index.html'},
            ]);
            expect(sh(origin, 'rev-parse', HOSTED_BRANCH)).toBe(published.hostedCommitSha);
            expect(sh(origin, 'log', '-1', '--format=%s', HOSTED_BRANCH)).toBe(`Publish site from ${sourceSha}`);
            expect(sh(origin, 'rev-list', '--count', HOSTED_BRANCH)).toBe('1');
            expect(sh(origin, 'show', `${HOSTED_BRANCH}:hosted/index.html`)).toBe('site v2');
            expect(listBranch()).toEqual([
                'hosted/26.9.15.zip',
                'hosted/guide.html',
                'hosted/index.html',
                'hosted/old-master.zip',
                'hosted/releases.json',
            ]);
            const served = spawnSync('git', ['show', `${HOSTED_BRANCH}:hosted/26.9.15.zip`], {cwd: origin});
            expect(served.stdout).toEqual(Buffer.from([0, 255, 1, 128]));
            expect(sh(origin, 'show', `${HOSTED_BRANCH}:hosted/releases.json`)).toBe('{"branch":"manifest"}');
        });

        it('passes every path through verbatim, however it is spelled', () => {
            const sourceSha = commitSiteEdit({'hosted/führer ü.html': 'unicode'});
            seedHostedWorkspace(git);

            expect(publishSite(git, {sourceSha}).changes).toEqual([{status: 'A', path: 'hosted/führer ü.html'}]);
        });

        it('pushes nothing when the site already matches master', () => {
            const before = sh(origin, 'rev-parse', HOSTED_BRANCH);
            seedHostedWorkspace(git);

            expect(publishSite(git, {sourceSha: sh(work, 'rev-parse', 'HEAD')}))
                .toEqual({hostedCommitSha: null, changes: []});
            expect(sh(origin, 'rev-parse', HOSTED_BRANCH)).toBe(before);
        });

        it('refuses a tree that would change a download or the manifest', () => {
            const before = sh(origin, 'rev-parse', HOSTED_BRANCH);
            seedHostedWorkspace(git);
            write('hosted/releases.json', '{"tampered":true}');

            expect(() => publishSite(git, {sourceSha: sh(work, 'rev-parse', 'HEAD')}))
                .toThrowError(expect.objectContaining({code: 'SITE_CHANGES_DOWNLOADS'}));
            expect(sh(origin, 'rev-parse', HOSTED_BRANCH)).toBe(before);
        });

        it('refuses to overwrite a hosted branch that moved after seeding', () => {
            const sourceSha = commitSiteEdit({'hosted/index.html': 'site v2'});
            seedHostedWorkspace(git);
            const other = join(root, 'other');
            sh(root, 'clone', '--branch', HOSTED_BRANCH, origin, other);
            writeFileSync(join(other, 'hosted', 'index.html'), 'concurrent');
            sh(other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-am', 'concurrent');
            sh(other, 'push', 'origin', HOSTED_BRANCH);

            expect(() => publishSite(git, {sourceSha}))
                .toThrowError(expect.objectContaining({code: 'HOSTED_BRANCH_MOVED'}));
            expect(sh(origin, 'show', `${HOSTED_BRANCH}:hosted/index.html`)).toBe('concurrent');
        });
    });

    it('never creates the hosted branch from a site-only publication', () => {
        expect(seedHostedWorkspace(git).bootstrapped).toBe(true);
        expect(() => publishSite(git, {sourceSha: sh(work, 'rev-parse', 'HEAD')}))
            .toThrowError(expect.objectContaining({code: 'HOSTED_BRANCH_MISSING'}));
        expect(spawnSync('git', ['rev-parse', '--verify', HOSTED_BRANCH], {cwd: origin}).status).not.toBe(0);
    });
});

describe('durable intent policy', () => {
    it('allows retry after a pre-boundary failure because no marker exists', () => {
        expect(evaluateIntentMarkers([], inputs)).toEqual({status: 'available'});
    });

    it('blocks a repeated or previously accepted production intent', () => {
        expect(() => evaluateIntentMarkers([marker({releaseIntentId: inputs.releaseIntentId})], inputs))
            .toThrowError(expect.objectContaining({code: 'INTENT_ALREADY_ACCEPTED'}));
    });

    it('treats an accepted marker from an ambiguous prior run as reconciliation-only', () => {
        expect(() => evaluateIntentMarkers([marker({releaseIntentId: inputs.releaseIntentId, githubRunId: 'ambiguous-run'})], inputs))
            .toThrow(ReleaseGitError);
    });

    it('blocks a different intent for the same approved source', () => {
        expect(() => evaluateIntentMarkers([marker({approvedSourceSha: SOURCE})], inputs))
            .toThrowError(expect.objectContaining({code: 'SOURCE_ALREADY_ACCEPTED'}));
    });

    it('gives concurrent duplicate attempts one atomic winner', () => {
        const remote = {master: SOURCE, intent: null, version: null};
        assertBoundaryRemoteState({
            remoteMasterSha: remote.master,
            expectedSourceSha: SOURCE,
            intentRefSha: remote.intent,
            versionRefSha: remote.version,
        });
        remote.master = VERSION_COMMIT;
        remote.intent = VERSION_COMMIT;
        remote.version = VERSION_COMMIT;

        expect(() => assertBoundaryRemoteState({
            remoteMasterSha: remote.master,
            expectedSourceSha: SOURCE,
            intentRefSha: remote.intent,
            versionRefSha: remote.version,
        })).toThrow(ReleaseGitError);
    });

    it('reads an accepted marker anchored to the requested intent', () => {
        const body = JSON.stringify(marker({releaseIntentId: 'bot-request-42', versionCommitSha: VERSION_COMMIT}));
        const git = {run: () => ({status: 0, stdout: `${body}\n`, stderr: ''})};
        expect(readIntentMarker('bot-request-42', git)).toMatchObject({releaseIntentId: 'bot-request-42'});
    });

    it('refuses to reconcile an intent with no accepted marker', () => {
        const git = {run: () => ({status: 0, stdout: '', stderr: ''})};
        expect(() => readIntentMarker('never-accepted', git))
            .toThrowError(expect.objectContaining({code: 'INTENT_MARKER_NOT_FOUND'}));
    });

    it('refuses a marker tag whose own contents claim a different intent', () => {
        const body = JSON.stringify(marker({releaseIntentId: 'other-intent', versionCommitSha: VERSION_COMMIT}));
        const git = {run: () => ({status: 0, stdout: `${body}\n`, stderr: ''})};
        expect(() => readIntentMarker('bot-request-42', git))
            .toThrowError(expect.objectContaining({code: 'INTENT_MARKER_INVALID'}));
    });

    it('builds one atomic push with an exact master lease and both tags', () => {
        expect(buildBoundaryPushArguments({
            sourceSha: SOURCE,
            versionCommitSha: VERSION_COMMIT,
            versionTag: 'v2.28.3',
            intentTag: 'release-intent/bot-request-42',
        })).toEqual([
            'push',
            '--atomic',
            `--force-with-lease=refs/heads/master:${SOURCE}`,
            'origin',
            `${VERSION_COMMIT}:refs/heads/master`,
            'refs/tags/v2.28.3:refs/tags/v2.28.3',
            'refs/tags/release-intent/bot-request-42:refs/tags/release-intent/bot-request-42',
        ]);
    });
});

