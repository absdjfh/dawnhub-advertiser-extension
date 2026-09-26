import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertOperationAllowed, buildReleasePlan, calculateResultingVersion, validateReleaseInputs} from './policy.mjs';
import {recordComponent} from './result.mjs';

export const OPERATION_DEFINITIONS = Object.freeze({
    dependencies: {
        component: 'dependencies',
        commands: [['npm', ['ci']], ['npm', ['ci', '--prefix', '.github/release']]],
        failureStatus: 'failure',
    },
    audit: {
        component: 'audit',
        commands: [['npm', ['audit', '--omit=dev']]],
        failureStatus: 'failure',
    },
    lint: {
        component: 'lint',
        commands: [['npm', ['run', 'lint']]],
        failureStatus: 'failure',
    },
    compile: {
        component: 'compile',
        commands: [['npm', ['run', 'compile']]],
        failureStatus: 'failure',
    },
    tests: {
        component: 'tests',
        commands: [['npm', ['run', 'test', '--', '--run']]],
        failureStatus: 'failure',
    },
    chromeBuildPackage: {
        component: 'chromeBuildPackage',
        commands: [
            ['npm', ['run', 'build']],
            ['npm', ['run', 'zip']],
        ],
        failureStatus: 'failure',
    },
    chromeCredentialValidation: {
        component: 'chromeCredentialValidation',
        productionOnly: true,
        credentials: [
            'CHROME_EXTENSION_ID',
            'CHROME_PUBLISHER_ID',
            'CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL',
            'CHROME_SERVICE_ACCOUNT_PRIVATE_KEY',
        ],
        commandFactory: context => [[
            'npx',
            ['--no-install', 'wxt', 'submit', '--chrome-zip', findArtifact('.output', `-${context.version}-chrome.zip`)],
            {DRY_RUN: 'true'},
        ]],
        failureStatus: 'failure',
    },
    chromeSubmission: {
        component: 'chromeSubmission',
        productionOnly: true,
        mutatesProduction: true,
        credentials: [
            'CHROME_EXTENSION_ID',
            'CHROME_PUBLISHER_ID',
            'CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL',
            'CHROME_SERVICE_ACCOUNT_PRIVATE_KEY',
        ],
        commandFactory: context => [[
            'npx',
            ['--no-install', 'wxt', 'submit', '--chrome-zip', findArtifact('.output', `-${context.version}-chrome.zip`)],
            {DRY_RUN: 'false'},
        ]],
        failureStatus: 'ambiguous',
    },
    hostedGeneration: {
        component: 'hostedGeneration',
        productionOnly: true,
        commands: [[
            'node',
            ['.github/release/publish-hosted-release.mjs'],
            {HOSTED_INCLUDE_CHROME: 'true'},
        ]],
        failureStatus: 'ambiguous',
    },
    notification: {
        component: 'notification',
        productionOnly: true,
        mutatesProduction: true,
        // Each channel (email, Discord) is used only when its secrets are configured - see notify-release.mjs.
        commands: [['node', ['.github/release/notify-release.mjs']]],
        failureStatus: 'warning',
    },
});

export function createCommandRunner() {
    return {
        run(file, args, environment = {}) {
            const executable = process.platform === 'win32' && ['npm', 'npx'].includes(file) ? `${file}.cmd` : file;
            const result = spawnSync(executable, args, {
                encoding: 'utf8',
                env: {...process.env, ...environment},
                stdio: 'inherit',
                shell: false,
            });
            if (result.error) {
                throw new Error(`Could not start ${file}.`);
            }
            if ((result.status ?? 1) !== 0) {
                throw new Error(`${file} exited with status ${result.status ?? 1}.`);
            }
        },
    };
}

export function runConfiguredOperation(operation, inputs, result, runner = createCommandRunner()) {
    assertOperationAllowed(operation, inputs);
    const definition = OPERATION_DEFINITIONS[operation];
    if (!definition) {
        throw new Error(`Operation ${String(operation)} is not a configured command operation.`);
    }
    if (inputs.dryRun && (definition.productionOnly || definition.mutatesProduction)) {
        throw new Error('Dry-run policy refused a production-only command operation.');
    }
    try {
        requireCredentials(definition.credentials ?? []);
        const context = {version: result.resultingPackageVersion};
        const commands = definition.commandFactory ? definition.commandFactory(context) : definition.commands;
        for (const [file, args, environment = {}] of commands) {
            runner.run(file, args, environment);
        }
        recordComponent(result, definition.component, 'success', operationSuccessSummary(operation));
    } catch (error) {
        const status = definition.failureStatus;
        const summary = status === 'ambiguous'
            ? `${operation} may have changed external state; reconcile before retrying.`
            : status === 'warning'
                ? `${operation} failed without changing required store-release status.`
                : `${operation} failed before its required outcome was established.`;
        recordComponent(result, definition.component, status, summary);
        throw error;
    }
    return result;
}

// `packageVersion` is the checked-out package.json version the calendar version
// is calculated from, passed in rather than read so the harness stays a pure
// description of the commands a dry run issues.
export function executeDryRunCommandHarness(rawInputs, runner, packageVersion) {
    const inputs = validateReleaseInputs(rawInputs);
    const plan = buildReleasePlan(rawInputs);
    if (!plan.dryRun) {
        throw new Error('The no-write harness accepts only dry-run inputs.');
    }
    for (const operation of plan.operations) {
        if (operation === 'versionPlanning') {
            const resultingVersion = calculateResultingVersion(packageVersion, inputs.releaseDate);
            runner.run('npm', ['version', resultingVersion, '--no-git-tag-version'], {});
            continue;
        }
        const definition = OPERATION_DEFINITIONS[operation];
        if (!definition || definition.productionOnly || definition.mutatesProduction || definition.commandFactory) {
            throw new Error(`Dry-run command harness rejected ${operation}.`);
        }
        for (const [file, args, environment = {}] of definition.commands) {
            runner.run(file, args, environment);
        }
    }
    return plan;
}

function requireCredentials(names) {
    const missing = names.filter(name => typeof process.env[name] !== 'string' || process.env[name].length === 0);
    if (missing.length > 0) {
        throw new Error(`Required credential variables are missing: ${missing.join(', ')}.`);
    }
}

function findArtifact(directory, suffix) {
    const matches = readdirSync(directory)
        .filter(name => name.endsWith(suffix))
        .sort();
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one local artifact ending in ${suffix}; found ${matches.length}.`);
    }
    return join(directory, matches[0]);
}

function operationSuccessSummary(operation) {
    const summaries = {
        dependencies: 'Locked dependencies installed.',
        audit: 'Production dependency audit passed.',
        lint: 'ESLint passed.',
        compile: 'TypeScript compilation passed.',
        tests: 'Unit tests passed in run mode.',
        chromeBuildPackage: 'Chrome build and package completed.',
        chromeCredentialValidation: 'Chrome credentials passed the non-submitting validation command.',
        chromeSubmission: 'Chrome submission command completed.',
        hostedGeneration: 'Hosted release files were generated in the workspace.',
        notification: 'Release notes were sent to every configured notification channel.',
    };
    return summaries[operation] ?? `${operation} completed.`;
}
