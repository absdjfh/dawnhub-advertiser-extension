import {appendFile, readFile} from 'node:fs/promises';
import {
    COMPONENTS,
    RECONCILABLE_COMPONENTS,
    RECONCILE_WORKFLOW_FILE,
    SITE_WORKFLOW_FILE,
    assertOperationAllowed,
    calculateResultingVersion,
    resolveDispatchInputs,
    validateReconcileInputs,
    validateReleaseInputs,
    validateWorkflowContext,
} from './policy.mjs';
import {
    checkoutMarkerCommit,
    createGitRunner,
    preflightReleaseIntent,
    prepareVersionCommit,
    publishHostedBranch,
    publishSite,
    pushReleaseBoundary,
    readAuthoritativeTip,
    readIntentMarker,
    safeGitError,
    seedHostedWorkspace,
    validateAndCheckoutSource,
} from './git-release.mjs';
import {createCommandRunner, runConfiguredOperation} from './operations.mjs';
import {
    createReleaseResult,
    finalizeReleaseResult,
    readResult,
    recordComponent,
    recordValidatedInputs,
    renderJobSummary,
    safeSummary,
    writeResult,
} from './result.mjs';

const RESULT_PATH = process.env.RELEASE_RESULT_PATH ?? '.output/release-result.json';
const command = process.argv[2];

// Every component before this list is either pre-boundary validation or part
// of the same atomic push that made the accepted marker exist in the first
// place; reconciliation trusts that the original run already established them
// and only acts on what could still be left undone after that boundary.
const INHERITED_COMPONENTS = COMPONENTS.filter(component => !RECONCILABLE_COMPONENTS.includes(component));

try {
    await main(command, process.argv.slice(3));
} catch (error) {
    console.error(safeCommandError(error));
    process.exitCode = 1;
}

async function main(selectedCommand, args) {
    switch (selectedCommand) {
        case 'init':
            await initializeResult();
            return;
        case 'resolve-inputs':
            await resolveInputs();
            return;
        case 'validate-inputs':
            await validateInputs();
            return;
        case 'validate-source':
            await validateSource();
            return;
        case 'validate-intent':
            await validateIntent();
            return;
        case 'apply-version':
            await applyVersion();
            return;
        case 'run':
            await runOperation(args);
            return;
        case 'prepare-version':
            await prepareVersion();
            return;
        case 'push-boundary':
            await pushBoundary();
            return;
        case 'seed-hosted':
            seedHosted();
            return;
        case 'commit-hosted':
            await commitHosted();
            return;
        case 'finalize':
            await finalize();
            return;
        case 'reconcile':
            await reconcile();
            return;
        case 'publish-site':
            await publishSiteFiles();
            return;
        default:
            throw new Error('Unknown release helper command.');
    }
}

async function initializeResult() {
    const result = createReleaseResult({
        repository: process.env.GITHUB_REPOSITORY,
        workflow: process.env.GITHUB_WORKFLOW,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        runUrl: process.env.GITHUB_RUN_URL,
    });
    await writeResult(RESULT_PATH, result);
}

// Turns an ergonomic dispatch into the explicit one every later step already
// expected. Nothing downstream is aware this ran: it exports the same two
// environment variables the workflow used to pass straight through, so the
// strict interface, its ordering, and its guards are untouched.
async function resolveInputs() {
    const result = await readResult(RESULT_PATH);
    try {
        // Before the scoped token is used for anything, including the tip
        // lookup below.
        requireWorkflowContext();
        const dispatchedSourceSha = process.env.RELEASE_INPUT_SOURCE_SHA;
        const needsTip = typeof dispatchedSourceSha === 'string' && dispatchedSourceSha.trim() === '';
        const resolution = resolveDispatchInputs({
            sourceSha: dispatchedSourceSha,
            releaseIntentId: process.env.RELEASE_INPUT_INTENT_ID,
            dryRun: process.env.RELEASE_DRY_RUN,
            profile: process.env.RELEASE_PROFILE,
        }, {
            masterTip: needsTip ? readAuthoritativeTip(createGitRunner(readGitHubToken())) : null,
            runId: process.env.GITHUB_RUN_ID,
            now: new Date().toISOString(),
        });

        await exportResolvedInputs(resolution.inputs);
        result.sourceShaOrigin = resolution.sourceShaOrigin;
        result.releaseIntentIdOrigin = resolution.releaseIntentIdOrigin;
        await writeResult(RESULT_PATH, result);
        console.log(`Release intent: ${resolution.inputs.releaseIntentId} (${resolution.releaseIntentIdOrigin})`);
        console.log(`Approved source: ${resolution.inputs.sourceSha} (${resolution.sourceShaOrigin})`);
        console.log(`Release date: ${resolution.inputs.releaseDate} (run clock, UTC)`);
    } catch (error) {
        recordComponent(result, 'inputValidation', 'failure', safeCommandError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function validateInputs() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        requireWorkflowContext();
        recordValidatedInputs(result, inputs);
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        recordComponent(result, 'inputValidation', 'failure', safeCommandError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function validateSource() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        await validateAndCheckoutSource(inputs, createGitRunner(readGitHubToken()));
        result.approvedSourceSha = inputs.sourceSha;
        recordComponent(result, 'sourceValidation', 'success', 'Approved SHA equals the fetched origin/master tip and checked-out HEAD.');
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        recordComponent(result, 'sourceValidation', 'failure', safeGitError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function validateIntent() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        const preflight = await preflightReleaseIntent(inputs, createGitRunner(readGitHubToken()));
        result.originalPackageVersion = preflight.originalVersion;
        result.resultingPackageVersion = preflight.resultingVersion;
        recordComponent(
            result,
            'intentValidation',
            'success',
            inputs.dryRun
                ? 'Intent is valid; dry runs do not create production markers.'
                : 'No accepted intent or source marker exists and the proposed version tag is available.',
        );
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        recordComponent(result, 'intentValidation', 'failure', safeGitError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function applyVersion() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        assertOperationAllowed('versionPlanning', inputs);
        const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
        const originalVersion = packageJson.version;
        const resultingVersion = calculateResultingVersion(originalVersion, inputs.releaseDate);
        createCommandRunner().run('npm', ['version', resultingVersion, '--no-git-tag-version']);
        const updatedPackageJson = JSON.parse(await readFile('package.json', 'utf8'));
        const updatedPackageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
        if (updatedPackageJson.version !== resultingVersion || updatedPackageLock.version !== resultingVersion) {
            throw new Error('npm version did not produce the exact planned package and lockfile version.');
        }
        result.originalPackageVersion = originalVersion;
        result.resultingPackageVersion = resultingVersion;
        recordComponent(
            result,
            'versionPlanning',
            'success',
            inputs.dryRun
                ? `Calculated and applied ${resultingVersion} only in the disposable checkout.`
                : `Prepared version ${resultingVersion} in the local checkout.`,
        );
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        recordComponent(result, 'versionPlanning', 'failure', safeCommandError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function runOperation(args) {
    if (args.length !== 1) {
        throw new Error('run requires one allowlisted operation name.');
    }
    const result = await readResult(RESULT_PATH);
    try {
        runConfiguredOperation(args[0], readInputs(), result);
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function prepareVersion() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        assertOperationAllowed('versionCommitTag', inputs);
        await prepareVersionCommit(inputs, result, createGitRunner());
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        recordComponent(result, 'versionCommitTag', 'failure', safeGitError(error));
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function pushBoundary() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        assertOperationAllowed('versionCommitTag', inputs);
        pushReleaseBoundary(inputs, result, createGitRunner(readGitHubToken()));
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

// Restores the generated hosted/ files from the hosted branch before new ones
// are generated, so the manifest and retention start from what is actually
// being served rather than from master's frozen copy.
function seedHosted() {
    const {bootstrapped} = seedHostedWorkspace(createGitRunner(readGitHubToken()));
    console.log(bootstrapped
        ? 'The hosted branch does not exist yet; bootstrapping it from the hosted/ files in this checkout.'
        : 'Seeded hosted/ from the hosted branch.');
}

async function commitHosted() {
    const result = await readResult(RESULT_PATH);
    try {
        const inputs = readInputs();
        assertOperationAllowed('hostedCommit', inputs);
        publishHostedBranch(result, createGitRunner(readGitHubToken()), {version: result.resultingPackageVersion});
        await writeResult(RESULT_PATH, result);
    } catch (error) {
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

async function finalize() {
    const result = await readResult(RESULT_PATH);
    finalizeReleaseResult(result);
    await writeResult(RESULT_PATH, result);
    const stepSummary = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummary) {
        await appendFile(stepSummary, `${renderJobSummary(result)}\n`, 'utf8');
    }
    console.log(`Release result: ${result.overallStatus}`);
    if (result.overallStatus !== 'success') {
        throw new Error('Release policy did not reach a successful overall result.');
    }
}

// Puts master's site files live without a release: no version, tag, intent
// marker, or store submission. The seed carries every .zip package and
// releases.json over from the hosted branch unchanged.
async function publishSiteFiles() {
    requireWorkflowContext(SITE_WORKFLOW_FILE);
    const git = createGitRunner(readGitHubToken());
    const sourceSha = git.run(['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
    seedHostedWorkspace(git);
    const {hostedCommitSha, changes} = publishSite(git, {sourceSha});
    const outcome = hostedCommitSha === null
        ? 'The site already matches master; nothing was pushed.'
        : `Pushed ${hostedCommitSha.slice(0, 12)} to the hosted branch with an exact lease.`;
    console.log(outcome);
    const summary = [
        '# Site publication',
        '',
        `- Source: \`${sourceSha}\` (origin/master tip)`,
        `- Result: ${outcome}`,
        ...(changes.length === 0 ? [] : [
            '',
            '| Change | File |',
            '| --- | --- |',
            ...changes.map(change => `| ${change.status} | ${change.path.replaceAll('|', '\\|')} |`),
        ]),
        '',
    ].join('\n');
    const stepSummary = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummary) {
        await appendFile(stepSummary, summary, 'utf8');
    }
}

async function reconcile() {
    const result = createReleaseResult({
        repository: process.env.GITHUB_REPOSITORY,
        workflow: process.env.GITHUB_WORKFLOW,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        runUrl: process.env.GITHUB_RUN_URL,
    });
    try {
        requireWorkflowContext(RECONCILE_WORKFLOW_FILE);
        const reconcileInputs = readReconcileInputs();
        const git = createGitRunner(readGitHubToken());
        const marker = readIntentMarker(reconcileInputs.releaseIntentId, git);
        checkoutMarkerCommit(marker, git);

        result.releaseIntentId = marker.releaseIntentId;
        result.releaseIntentIdOrigin = 'dispatch';
        result.dryRun = false;
        result.profile = 'production-full';
        result.approvedSourceSha = marker.approvedSourceSha;
        result.sourceShaOrigin = 'dispatch';
        result.releaseDate = marker.releaseDate;
        result.originalPackageVersion = marker.originalVersion;
        result.resultingPackageVersion = marker.resultingVersion;
        result.versionCommitSha = marker.versionCommitSha;
        result.releaseCommitSha = marker.versionCommitSha;
        result.tag = marker.versionTag;
        result.intentMarker = `refs/tags/release-intent/${marker.releaseIntentId}`;

        for (const component of INHERITED_COMPONENTS) {
            recordComponent(result, component, 'success', `Inherited from run ${marker.githubRunId}; not re-verified by reconciliation.`);
        }
        await writeResult(RESULT_PATH, result);

        if (RECONCILABLE_COMPONENTS.some(component => isRunAction(reconcileInputs.actions[component]))) {
            const runner = createCommandRunner();
            runner.run('npm', ['ci']);
            runner.run('npm', ['run', 'build']);
            runner.run('npm', ['run', 'zip']);
        }

        if (['hostedGeneration', 'hostedCommit']
            .some(component => isRunAction(reconcileInputs.actions[component]))) {
            seedHostedWorkspace(git);
        }

        const operationInputs = {
            sourceSha: marker.approvedSourceSha,
            releaseIntentId: marker.releaseIntentId,
            releaseDate: marker.releaseDate,
            dryRun: false,
            profile: 'full',
        };
        for (const component of RECONCILABLE_COMPONENTS) {
            const action = reconcileInputs.actions[component];
            if (isRunAction(action) && component === 'hostedCommit') {
                // Unlike every other reconcilable component, hostedCommit is a
                // guarded Git push rather than a configured command operation.
                // It targets the hosted branch, so unrelated commits landing on
                // master since the release cannot make it stale.
                assertOperationAllowed('hostedCommit', operationInputs);
                publishHostedBranch(result, git, {version: marker.resultingVersion});
            } else if (isRunAction(action)) {
                runConfiguredOperation(component, operationInputs, result);
            } else {
                recordComponent(result, component, 'success', `Confirmed already completed outside this job (${action}).`);
            }
            await writeResult(RESULT_PATH, result);
        }
    } catch (error) {
        await writeResult(RESULT_PATH, result);
        throw error;
    }
}

function isRunAction(action) {
    return !action.startsWith('already-');
}

function readReconcileInputs() {
    return validateReconcileInputs({
        releaseIntentId: process.env.RECONCILE_INTENT_ID,
        actions: {
            chromeSubmission: process.env.RECONCILE_CHROME_SUBMISSION_ACTION,
            hostedGeneration: process.env.RECONCILE_HOSTED_GENERATION_ACTION,
            hostedCommit: process.env.RECONCILE_HOSTED_COMMIT_ACTION,
        },
    });
}

function readInputs() {
    return validateReleaseInputs({
        sourceSha: process.env.RELEASE_SOURCE_SHA,
        releaseIntentId: process.env.RELEASE_INTENT_ID,
        releaseDate: process.env.RELEASE_DATE,
        dryRun: process.env.RELEASE_DRY_RUN,
        profile: process.env.RELEASE_PROFILE,
    });
}

function requireWorkflowContext(workflowFile) {
    return validateWorkflowContext({
        repository: process.env.GITHUB_REPOSITORY,
        ref: process.env.RELEASE_TRIGGER_REF,
        workflowRef: process.env.RELEASE_WORKFLOW_REF,
    }, workflowFile);
}

// The workflow deliberately declares none of these at job level, because a
// job-level env entry would take precedence over the environment file and
// silently discard whatever was resolved here.
async function exportResolvedInputs(inputs) {
    const environmentFile = process.env.GITHUB_ENV;
    if (typeof environmentFile !== 'string' || environmentFile.length === 0) {
        throw new Error('GITHUB_ENV is unavailable, so resolved release inputs cannot be exported.');
    }
    const exported = {
        RELEASE_SOURCE_SHA: inputs.sourceSha,
        RELEASE_INTENT_ID: inputs.releaseIntentId,
        RELEASE_DATE: inputs.releaseDate,
    };
    const lines = Object.entries(exported).map(([name, value]) => {
        // Each value is already validated to a charset with no newline, but an
        // environment file is a place to be certain rather than to infer.
        if (!/^[a-z0-9-]{1,64}$/.test(value)) {
            throw new Error(`Resolved ${name} is not safe to write to the environment file.`);
        }
        return `${name}=${value}`;
    });
    await appendFile(environmentFile, `${lines.join('\n')}\n`, 'utf8');
}

function readGitHubToken() {
    const token = process.env.RELEASE_GITHUB_TOKEN;
    if (typeof token !== 'string' || token.length === 0) {
        throw new Error('The scoped GitHub token was not provided to this Git operation.');
    }
    return token;
}

function safeCommandError(error) {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        return safeSummary(`${String(error.code)}: ${String(error.message)}`);
    }
    if (error instanceof Error) {
        return safeSummary(error.message);
    }
    return safeSummary('Unexpected release helper failure.');
}
