import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, join, sep} from 'node:path';
import {AUTHORITATIVE_BRANCH, calculateResultingVersion} from './policy.mjs';
import {recordComponent, safeSummary} from './result.mjs';

const VERSION_FILES = new Set(['package.json', 'package-lock.json']);
const INTENT_TAG_PREFIX = 'release-intent/';
export const HOSTED_BRANCH = 'hosted';
const HOSTED_BASE_FILE = '.output/hosted-branch-base.txt';

export class ReleaseGitError extends Error {
    constructor(code, message, ambiguous = false) {
        super(message);
        this.name = 'ReleaseGitError';
        this.code = code;
        this.ambiguous = ambiguous;
    }
}

export function createGitRunner(token = null) {
    return {
        run(args, options = {}) {
            const environment = {...process.env, ...(options.env ?? {})};
            if (options.network) {
                if (typeof token !== 'string' || token.length === 0) {
                    throw new ReleaseGitError('GITHUB_TOKEN_MISSING', 'The scoped GitHub token is unavailable.');
                }
                addGitHubAuthorization(environment, token);
                environment.GIT_TERMINAL_PROMPT = '0';
            }
            const result = spawnSync('git', args, {
                cwd: options.cwd,
                encoding: 'utf8',
                input: options.input,
                env: environment,
                stdio: options.inherit ? 'inherit' : 'pipe',
            });
            const status = result.status ?? 1;
            if (result.error) {
                throw new ReleaseGitError('GIT_EXECUTION_FAILED', `Git could not start: ${result.error.message}`);
            }
            if (status !== 0 && !options.allowFailure) {
                throw new ReleaseGitError(
                    'GIT_COMMAND_FAILED',
                    `git ${args[0] ?? 'command'} failed with exit code ${status}.`,
                );
            }
            return {status, stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
        },
    };
}

// Used only to fill in a blank sourceSha. The answer is not trusted as an
// approval: validateAndCheckoutSource still fetches independently and requires
// the resolved SHA to equal the tip, so a branch that moves in between fails
// closed exactly as a stale hand-pasted SHA would.
export function readAuthoritativeTip(git) {
    const tip = remoteRefSha(git, `refs/heads/${AUTHORITATIVE_BRANCH}`);
    if (tip === null) {
        throw new ReleaseGitError(
            'AUTHORITATIVE_BRANCH_MISSING',
            `origin/${AUTHORITATIVE_BRANCH} does not exist, so a blank sourceSha cannot be resolved.`,
        );
    }
    return tip;
}

export function classifySource({sourceSha, masterTip, exists, isAncestor}) {
    if (!exists) {
        throw new ReleaseGitError('SOURCE_NOT_FOUND', 'The approved source SHA does not exist in this repository.');
    }
    if (!isAncestor) {
        throw new ReleaseGitError('SOURCE_UNRELATED', 'The approved source SHA is not in origin/master history.');
    }
    if (sourceSha !== masterTip) {
        throw new ReleaseGitError('SOURCE_STALE', 'The approved source SHA is not the current origin/master tip.');
    }
    return sourceSha;
}

export async function validateAndCheckoutSource(inputs, git) {
    git.run([
        'fetch',
        '--force',
        '--prune',
        '--tags',
        'origin',
        `+refs/heads/${AUTHORITATIVE_BRANCH}:refs/remotes/origin/${AUTHORITATIVE_BRANCH}`,
    ], {network: true});

    const exists = git.run(['cat-file', '-e', `${inputs.sourceSha}^{commit}`], {allowFailure: true}).status === 0;
    const masterTip = requireFullSha(git.run([
        'rev-parse',
        '--verify',
        `refs/remotes/origin/${AUTHORITATIVE_BRANCH}^{commit}`,
    ]).stdout);
    const isAncestor = exists
        && git.run([
            'merge-base',
            '--is-ancestor',
            inputs.sourceSha,
            `refs/remotes/origin/${AUTHORITATIVE_BRANCH}`,
        ], {allowFailure: true}).status === 0;

    classifySource({sourceSha: inputs.sourceSha, masterTip, exists, isAncestor});
    const trackedChanges = lines(git.run(['status', '--porcelain', '--untracked-files=no']).stdout);
    if (trackedChanges.length > 0) {
        throw new ReleaseGitError('DIRTY_CHECKOUT', 'The release checkout has tracked changes before source validation.');
    }
    git.run(['checkout', '--detach', inputs.sourceSha]);
    const head = requireFullSha(git.run(['rev-parse', '--verify', 'HEAD^{commit}']).stdout);
    if (head !== inputs.sourceSha) {
        throw new ReleaseGitError('CHECKOUT_MISMATCH', 'HEAD differs from the approved source SHA.');
    }
    return {approvedSourceSha: head, authoritativeTip: masterTip};
}

export function evaluateIntentMarkers(markers, inputs) {
    for (const marker of markers) {
        validateIntentMarker(marker);
        if (marker.releaseIntentId === inputs.releaseIntentId) {
            throw new ReleaseGitError(
                'INTENT_ALREADY_ACCEPTED',
                `Release intent ${inputs.releaseIntentId} already crossed the irreversible boundary in run ${marker.githubRunId}.`,
            );
        }
        if (marker.approvedSourceSha === inputs.sourceSha) {
            throw new ReleaseGitError(
                'SOURCE_ALREADY_ACCEPTED',
                `Approved source ${inputs.sourceSha} already has an accepted production release intent.`,
            );
        }
    }
    return {status: 'available'};
}

export async function preflightReleaseIntent(inputs, git) {
    const markerOutput = git.run([
        'for-each-ref',
        '--format=%(refname:short)%00%(contents:subject)',
        `refs/tags/${INTENT_TAG_PREFIX}`,
    ]).stdout;
    const markerLines = lines(markerOutput);
    if (markerLines.length > 1_000) {
        throw new ReleaseGitError('INTENT_MARKER_LIMIT', 'The release intent marker set exceeds its safe bound.');
    }
    const markers = markerLines.map(line => {
        const separator = line.indexOf('\0');
        if (separator < 0) {
            throw new ReleaseGitError('INTENT_MARKER_INVALID', 'A release intent marker is malformed.');
        }
        const tag = line.slice(0, separator);
        const body = line.slice(separator + 1);
        if (!tag.startsWith(INTENT_TAG_PREFIX) || body.length > 8_192) {
            throw new ReleaseGitError('INTENT_MARKER_INVALID', 'A release intent marker is malformed.');
        }
        try {
            return JSON.parse(body);
        } catch {
            throw new ReleaseGitError('INTENT_MARKER_INVALID', 'A release intent marker does not contain valid JSON.');
        }
    });
    evaluateIntentMarkers(markers, inputs);

    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    const resultingVersion = calculateResultingVersion(packageJson.version, inputs.releaseDate);
    if (!inputs.dryRun) {
        const versionRef = `refs/tags/v${resultingVersion}`;
        if (remoteRefSha(git, versionRef) !== null) {
            throw new ReleaseGitError('VERSION_TAG_EXISTS', `Version tag v${resultingVersion} already exists.`);
        }
    }
    return {status: 'available', originalVersion: packageJson.version, resultingVersion};
}

// Swapping versionBump for releaseDate leaves every validated field untouched,
// so the schema version stays 1.0 on purpose: markers written before calendar
// versioning must keep reconciling, and raising it would invalidate them all.
export function createIntentMarker(inputs, metadata) {
    return {
        schemaVersion: '1.0',
        status: 'boundary-crossed',
        releaseIntentId: inputs.releaseIntentId,
        approvedSourceSha: inputs.sourceSha,
        authoritativeBranch: AUTHORITATIVE_BRANCH,
        releaseDate: inputs.releaseDate,
        originalVersion: metadata.originalVersion,
        resultingVersion: metadata.resultingVersion,
        versionCommitSha: metadata.versionCommitSha,
        versionTag: metadata.versionTag,
        githubRunId: metadata.githubRunId,
        githubRunUrl: metadata.githubRunUrl,
        crossedAt: metadata.crossedAt,
    };
}

export function buildBoundaryPushArguments({sourceSha, versionCommitSha, versionTag, intentTag}) {
    return [
        'push',
        '--atomic',
        `--force-with-lease=refs/heads/${AUTHORITATIVE_BRANCH}:${sourceSha}`,
        'origin',
        `${versionCommitSha}:refs/heads/${AUTHORITATIVE_BRANCH}`,
        `refs/tags/${versionTag}:refs/tags/${versionTag}`,
        `refs/tags/${intentTag}:refs/tags/${intentTag}`,
    ];
}

export function assertBoundaryRemoteState({remoteMasterSha, expectedSourceSha, intentRefSha, versionRefSha}) {
    if (remoteMasterSha !== expectedSourceSha) {
        throw new ReleaseGitError('MASTER_MOVED', 'origin/master moved after source approval; guarded push refused.');
    }
    if (intentRefSha !== null) {
        throw new ReleaseGitError('INTENT_ALREADY_ACCEPTED', 'The release intent marker already exists.');
    }
    if (versionRefSha !== null) {
        throw new ReleaseGitError('VERSION_TAG_EXISTS', 'The proposed version tag already exists.');
    }
}

export async function prepareVersionCommit(inputs, result, git, timestamp = new Date().toISOString()) {
    const head = requireFullSha(git.run(['rev-parse', '--verify', 'HEAD^{commit}']).stdout);
    if (head !== inputs.sourceSha) {
        throw new ReleaseGitError('CHECKOUT_MISMATCH', 'Version commit is not being prepared from the approved source.');
    }

    const changedFiles = lines(git.run(['diff', '--name-only']).stdout);
    const alreadyStaged = lines(git.run(['diff', '--cached', '--name-only']).stdout);
    const untracked = lines(git.run(['ls-files', '--others', '--exclude-standard']).stdout);
    if (
        changedFiles.length === 0
        || !changedFiles.includes('package.json')
        || changedFiles.some(file => !VERSION_FILES.has(file))
        || alreadyStaged.length > 0
        || untracked.length > 0
    ) {
        throw new ReleaseGitError(
            'UNEXPECTED_VERSION_CHANGES',
            'Version preparation must change package.json and may only change package.json/package-lock.json.',
        );
    }
    git.run(['add', '--', 'package.json', 'package-lock.json']);
    const stagedFiles = lines(git.run(['diff', '--cached', '--name-only']).stdout);
    if (stagedFiles.length === 0 || stagedFiles.some(file => !VERSION_FILES.has(file))) {
        throw new ReleaseGitError('UNEXPECTED_VERSION_CHANGES', 'Unexpected files were staged for the version commit.');
    }

    const versionTag = `v${result.resultingPackageVersion}`;
    const intentTag = `${INTENT_TAG_PREFIX}${inputs.releaseIntentId}`;
    assertLocalRefMissing(git, `refs/tags/${versionTag}`);
    assertLocalRefMissing(git, `refs/tags/${intentTag}`);
    const identityArgs = [
        '-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    ];
    git.run([...identityArgs, 'commit', '-m', `Release ${versionTag}`]);
    const versionCommitSha = requireFullSha(git.run(['rev-parse', '--verify', 'HEAD^{commit}']).stdout);
    const parents = git.run(['rev-list', '--parents', '-n', '1', versionCommitSha]).stdout.trim().split(/\s+/);
    if (parents.length !== 2 || parents[1] !== inputs.sourceSha) {
        throw new ReleaseGitError('INVALID_VERSION_PARENT', 'Version commit is not a direct child of the approved source.');
    }
    git.run([...identityArgs, 'tag', '-a', versionTag, versionCommitSha, '-m', versionTag]);
    const marker = createIntentMarker(inputs, {
        originalVersion: result.originalPackageVersion,
        resultingVersion: result.resultingPackageVersion,
        versionCommitSha,
        versionTag,
        githubRunId: result.github.runId,
        githubRunUrl: result.github.runUrl,
        crossedAt: timestamp,
    });
    git.run([...identityArgs, 'tag', '-a', intentTag, versionCommitSha, '-m', JSON.stringify(marker)]);
    result.versionCommitSha = versionCommitSha;
    result.releaseCommitSha = versionCommitSha;
    result.tag = versionTag;
    result.intentMarker = `refs/tags/${intentTag}`;
    return {versionCommitSha, versionTag, intentTag};
}

export function pushReleaseBoundary(inputs, result, git) {
    const versionCommitSha = requireFullSha(result.versionCommitSha ?? '');
    const versionTag = requireSafeTag(result.tag, 'version tag');
    const intentTag = `${INTENT_TAG_PREFIX}${inputs.releaseIntentId}`;
    try {
        assertBoundaryRemoteState({
            remoteMasterSha: remoteRefSha(git, `refs/heads/${AUTHORITATIVE_BRANCH}`),
            expectedSourceSha: inputs.sourceSha,
            intentRefSha: remoteRefSha(git, `refs/tags/${intentTag}`),
            versionRefSha: remoteRefSha(git, `refs/tags/${versionTag}`),
        });
        git.run(buildBoundaryPushArguments({
            sourceSha: inputs.sourceSha,
            versionCommitSha,
            versionTag,
            intentTag,
        }), {network: true});
        recordComponent(result, 'versionCommitTag', 'success', 'Version commit, version tag, and intent marker were pushed atomically.');
    } catch (error) {
        const policyFailure = error instanceof ReleaseGitError && !error.ambiguous && error.code !== 'GIT_COMMAND_FAILED';
        recordComponent(
            result,
            'versionCommitTag',
            policyFailure ? 'failure' : 'ambiguous',
            policyFailure
                ? `${error.code}: ${error.message}`
                : 'Atomic boundary push failed or returned ambiguously; reconcile remote refs before any retry.',
        );
        if (error instanceof ReleaseGitError && error.code === 'GIT_COMMAND_FAILED') {
            error.ambiguous = true;
        }
        throw error;
    }
    return result;
}

// Everything Cloudflare serves lives on the orphan HOSTED_BRANCH, under the
// same hosted/ directory as on master, so the Cloudflare project only needs
// its production branch set to it. Binaries never enter master: each release,
// and each site-only publication, rewrites the branch as a single parentless
// commit, so pruned versions leave its history and it cannot grow.
//
// Both work on the hosted/ directory of their checkout. The steps below seed
// it from the branch before anything is fetched or generated and publish it
// back afterwards.

// Generated per release; everything else under hosted/ is site source owned by
// master and is carried over from the checked-out commit: the release commit,
// or the master tip for a site-only publication. Chrome only: the ZIP packages
// and the manifest listing them - no Firefox XPIs or update feeds.
const GENERATED_HOSTED_FILE = /(?:\.zip|(?:^|\/)releases\.json)$/;

export function seedHostedWorkspace(git, {workspace = 'hosted', baseFile = HOSTED_BASE_FILE} = {}) {
    const remoteSha = remoteRefSha(git, `refs/heads/${HOSTED_BRANCH}`);
    mkdirSync(dirname(baseFile), {recursive: true});
    writeFileSync(baseFile, `${remoteSha ?? ''}\n`);
    if (remoteSha === null) {
        // First release: the workspace already holds master's hosted/ files,
        // which is exactly what the branch is bootstrapped from.
        return {remoteSha, bootstrapped: true};
    }
    git.run(['fetch', '--no-tags', '--depth=1', 'origin', `refs/heads/${HOSTED_BRANCH}`], {network: true});
    const fetched = requireFullSha(git.run(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']).stdout);
    if (fetched !== remoteSha) {
        throw new ReleaseGitError('HOSTED_BRANCH_MOVED', 'The hosted branch moved while it was being fetched.');
    }
    removeGeneratedFiles(workspace);
    // A throwaway index keeps binaries byte-exact (checkout-index never
    // decodes them) without staging anything in the release checkout.
    const indexFile = join(dirname(baseFile), 'hosted-seed.index');
    rmSync(indexFile, {force: true});
    const env = {GIT_INDEX_FILE: indexFile};
    git.run(['read-tree', fetched], {env});
    const generated = lines(git.run(['ls-files', '--', workspace], {env}).stdout)
        .filter(file => GENERATED_HOSTED_FILE.test(file));
    if (generated.length > 0) {
        git.run(['checkout-index', '--force', '--stdin'], {env, input: `${generated.join('\n')}\n`});
    }
    rmSync(indexFile, {force: true});
    return {remoteSha, bootstrapped: false};
}

function removeGeneratedFiles(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            removeGeneratedFiles(path);
        } else if (GENERATED_HOSTED_FILE.test(path.split(sep).join('/'))) {
            rmSync(path);
        }
    }
}

export function publishHostedBranch(result, git, {baseFile = HOSTED_BASE_FILE, version = null} = {}) {
    try {
        const baseSha = readHostedBase(baseFile);
        const tree = writeHostedTree(git, baseFile);
        const hostedCommitSha = pushHostedTree(git, tree, {
            baseSha,
            message: `Publish hosted release files${version ? ` for ${version}` : ''}`,
        });
        recordComponent(result, 'hostedCommit', 'success', `Hosted release files were pushed to the ${HOSTED_BRANCH} branch (${hostedCommitSha.slice(0, 12)}) with an exact lease.`);
        return result;
    } catch (error) {
        recordComponent(
            result,
            'hostedCommit',
            'ambiguous',
            `Hosted publication did not complete cleanly after the irreversible boundary; reconcile the ${HOSTED_BRANCH} branch and public files.`,
        );
        throw error;
    }
}

// Publishes master's site files without a release. The workspace must have
// been seeded from an existing hosted branch, so every generated file is the
// branch's own byte-exact copy; a tree that would still change one is refused,
// because only a release may change what users download. Nothing is pushed
// when the site is already current.
export function publishSite(git, {sourceSha, baseFile = HOSTED_BASE_FILE}) {
    const baseSha = readHostedBase(baseFile);
    if (baseSha === null) {
        throw new ReleaseGitError(
            'HOSTED_BRANCH_MISSING',
            `The ${HOSTED_BRANCH} branch does not exist yet; the next release creates it.`,
        );
    }
    const tree = writeHostedTree(git, baseFile);
    // NUL-separated, so every path arrives verbatim rather than C-quoted and
    // the guard below sees the same name the branch will serve.
    const fields = git.run(['diff-tree', '-z', '-r', '--no-renames', '--name-status', `${baseSha}^{tree}`, tree])
        .stdout.split('\0').filter(Boolean);
    const changes = [];
    for (let index = 0; index < fields.length; index += 2) {
        changes.push({status: fields[index], path: fields[index + 1]});
    }
    const generated = changes.filter(change => GENERATED_HOSTED_FILE.test(change.path));
    if (generated.length > 0) {
        throw new ReleaseGitError(
            'SITE_CHANGES_DOWNLOADS',
            `Site publication would change release files: ${generated.map(change => change.path).join(', ')}.`,
        );
    }
    if (changes.length === 0) {
        return {hostedCommitSha: null, changes};
    }
    const hostedCommitSha = pushHostedTree(git, tree, {baseSha, message: `Publish site from ${requireFullSha(sourceSha)}`});
    return {hostedCommitSha, changes};
}

// The tree is built in a throwaway index, so neither master's index nor its
// checkout is ever staged or committed.
function writeHostedTree(git, baseFile) {
    const tracked = lines(git.run(['diff', '--name-only']).stdout);
    const alreadyStaged = lines(git.run(['diff', '--cached', '--name-only']).stdout);
    if ([...tracked, ...alreadyStaged].some(file => !file.startsWith('hosted/'))) {
        throw new ReleaseGitError('UNEXPECTED_HOSTED_CHANGES', 'Hosted publication changed a path outside hosted/.');
    }
    const indexFile = join(dirname(baseFile), 'hosted-branch.index');
    rmSync(indexFile, {force: true});
    const env = {GIT_INDEX_FILE: indexFile};
    git.run(['add', '--all', '--force', '--', 'hosted'], {env});
    const tree = requireFullSha(git.run(['write-tree'], {env}).stdout);
    rmSync(indexFile, {force: true});
    return tree;
}

function pushHostedTree(git, tree, {baseSha, message}) {
    const hostedCommitSha = requireFullSha(git.run([
        '-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit-tree', tree, '-m', message,
    ]).stdout);
    // Read the remote ref again immediately before the write, exactly as every
    // other guarded push does. An empty expected value means the branch must
    // not exist yet.
    const remoteSha = remoteRefSha(git, `refs/heads/${HOSTED_BRANCH}`);
    if (remoteSha !== baseSha) {
        throw new ReleaseGitError('HOSTED_BRANCH_MOVED', 'The hosted branch moved after it was seeded; guarded push refused.');
    }
    git.run([
        'push',
        `--force-with-lease=refs/heads/${HOSTED_BRANCH}:${baseSha ?? ''}`,
        'origin',
        `${hostedCommitSha}:refs/heads/${HOSTED_BRANCH}`,
    ], {network: true});
    return hostedCommitSha;
}

function readHostedBase(baseFile) {
    let content;
    try {
        content = readFileSync(baseFile, 'utf8').trim();
    } catch {
        throw new ReleaseGitError('HOSTED_NOT_SEEDED', 'The hosted branch was not seeded before publication.');
    }
    return content === '' ? null : requireFullSha(content);
}

// The accepted marker, not the dispatch, is the reconciliation anchor: a
// reconcile run trusts only the exact version commit, source, and version the
// original run committed to, never a value re-derived from the current tip.
export function readIntentMarker(releaseIntentId, git) {
    const tag = `${INTENT_TAG_PREFIX}${releaseIntentId}`;
    const body = git.run(['for-each-ref', '--format=%(contents:subject)', `refs/tags/${tag}`]).stdout.trim();
    if (body.length === 0) {
        throw new ReleaseGitError(
            'INTENT_MARKER_NOT_FOUND',
            `No accepted release intent marker exists for ${releaseIntentId}; there is nothing to reconcile.`,
        );
    }
    let marker;
    try {
        marker = JSON.parse(body);
    } catch {
        throw new ReleaseGitError('INTENT_MARKER_INVALID', 'The release intent marker does not contain valid JSON.');
    }
    validateIntentMarker(marker);
    if (marker.releaseIntentId !== releaseIntentId) {
        throw new ReleaseGitError('INTENT_MARKER_INVALID', 'The release intent marker does not match the requested intent.');
    }
    return marker;
}

// Reconciliation resumes exactly where the accepted marker left off, so it
// checks out the marker's own version commit rather than any branch tip.
export function checkoutMarkerCommit(marker, git) {
    const exists = git.run(['cat-file', '-e', `${marker.versionCommitSha}^{commit}`], {allowFailure: true}).status === 0;
    if (!exists) {
        throw new ReleaseGitError('SOURCE_NOT_FOUND', 'The marker version commit is not present in this checkout.');
    }
    const trackedChanges = lines(git.run(['status', '--porcelain', '--untracked-files=no']).stdout);
    if (trackedChanges.length > 0) {
        throw new ReleaseGitError('DIRTY_CHECKOUT', 'The reconciliation checkout has tracked changes before checkout.');
    }
    git.run(['checkout', '--detach', marker.versionCommitSha]);
    const head = requireFullSha(git.run(['rev-parse', '--verify', 'HEAD^{commit}']).stdout);
    if (head !== marker.versionCommitSha) {
        throw new ReleaseGitError('CHECKOUT_MISMATCH', 'HEAD differs from the marker version commit.');
    }
    return head;
}

export function safeGitError(error) {
    if (error instanceof ReleaseGitError) {
        return safeSummary(`${error.code}: ${error.message}`);
    }
    return safeSummary('Unexpected release Git failure.');
}

export function remoteRefSha(git, ref) {
    const result = git.run(['ls-remote', '--refs', 'origin', ref], {network: true});
    const matches = lines(result.stdout);
    if (matches.length === 0) {
        return null;
    }
    if (matches.length !== 1) {
        throw new ReleaseGitError('REMOTE_REF_AMBIGUOUS', 'A guarded remote ref resolved more than once.');
    }
    const [sha, resolvedRef] = matches[0].split(/\s+/);
    if (resolvedRef !== ref) {
        throw new ReleaseGitError('REMOTE_REF_MISMATCH', 'A guarded remote ref did not resolve exactly.');
    }
    return requireFullSha(sha);
}

export function validateIntentMarker(marker) {
    if (
        marker === null
        || typeof marker !== 'object'
        || marker.schemaVersion !== '1.0'
        || marker.status !== 'boundary-crossed'
        || typeof marker.releaseIntentId !== 'string'
        || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(marker.releaseIntentId)
        || typeof marker.approvedSourceSha !== 'string'
        || !/^[a-f0-9]{40}$/.test(marker.approvedSourceSha)
        || typeof marker.githubRunId !== 'string'
        || marker.githubRunId.length > 40
    ) {
        throw new ReleaseGitError('INTENT_MARKER_INVALID', 'A release intent marker failed validation.');
    }
}

function assertLocalRefMissing(git, ref) {
    if (git.run(['show-ref', '--verify', '--quiet', ref], {allowFailure: true}).status === 0) {
        throw new ReleaseGitError('LOCAL_REF_EXISTS', `Local ref ${ref} already exists.`);
    }
}

function requireFullSha(value) {
    const sha = String(value).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) {
        throw new ReleaseGitError('INVALID_GIT_SHA', 'Git did not return one full lowercase commit SHA.');
    }
    return sha;
}

function requireSafeTag(value, field) {
    if (typeof value !== 'string' || !/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) {
        throw new ReleaseGitError('INVALID_TAG', `${field} is invalid.`);
    }
    return value;
}

function lines(value) {
    return String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function addGitHubAuthorization(environment, token) {
    const existingCount = Number.parseInt(environment.GIT_CONFIG_COUNT ?? '0', 10);
    const count = Number.isSafeInteger(existingCount) && existingCount >= 0 ? existingCount : 0;
    environment.GIT_CONFIG_COUNT = String(count + 1);
    environment[`GIT_CONFIG_KEY_${count}`] = 'http.https://github.com/.extraheader';
    environment[`GIT_CONFIG_VALUE_${count}`] = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}
