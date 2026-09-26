import {describe, expect, it, vi} from 'vitest';
import {
    PRODUCTION_MUTATIONS,
    PRODUCTION_OPERATIONS,
    RECONCILABLE_COMPONENTS,
    RECONCILE_ACTIONS,
    ReleasePolicyError,
    buildReleasePlan,
    buildRunIntentId,
    calculateResultingVersion,
    executePlanWithRunner,
    resolveDispatchInputs,
    validateReconcileInputs,
    validateReleaseInputs,
    validateWorkflowContext,
} from '../policy.mjs';
import {executeDryRunCommandHarness} from '../operations.mjs';

const SHA = 'a'.repeat(40);

function validInputs(overrides = {}) {
    return {
        sourceSha: SHA,
        releaseIntentId: 'manual-20260809-001',
        releaseDate: '2026-08-09',
        dryRun: 'true',
        profile: 'full',
        ...overrides,
    };
}

describe('release input policy', () => {
    it('accepts the exact fixed dry-run interface', () => {
        expect(validateReleaseInputs(validInputs())).toEqual({
            sourceSha: SHA,
            releaseIntentId: 'manual-20260809-001',
            releaseDate: '2026-08-09',
            dryRun: true,
            profile: 'full',
        });
    });

    it.each([
        '',
        'abc123',
        'A'.repeat(40),
        `${SHA} `,
        `${SHA};git push`,
        '$(touch owned)',
        '`git push`',
    ])('rejects malformed or malicious source SHA %j', sourceSha => {
        expect(() => validateReleaseInputs(validInputs({sourceSha}))).toThrow(ReleasePolicyError);
    });

    it.each([
        '-intent',
        'intent-',
        'intent--two',
        'Intent-1',
        'intent 1',
        'intent/1',
        'intent;echo-owned',
        'intent$(whoami)',
        'a'.repeat(65),
    ])('rejects unsafe release intent ID %j', releaseIntentId => {
        expect(() => validateReleaseInputs(validInputs({releaseIntentId}))).toThrow(ReleasePolicyError);
    });

    it.each([
        ['releaseDate', '2026-8-9'],
        ['releaseDate', '20260809'],
        ['releaseDate', '2026-02-30'],
        ['releaseDate', '2026-13-01'],
        ['releaseDate', '2026-08-09T00:00:00.000Z'],
        ['profile', 'chrome-only'],
        ['dryRun', 'TRUE'],
        ['dryRun', '1'],
    ])('rejects unknown or noncanonical %s value', (field, value) => {
        expect(() => validateReleaseInputs(validInputs({[field]: value}))).toThrow(ReleasePolicyError);
    });

    it('rejects a chosen version bump, which is no longer an input at all', () => {
        expect(() => validateReleaseInputs({...validInputs(), versionBump: 'patch'})).toThrow(/exactly/);
    });

    it('accepts only the allowlisted repository and master workflow definition', () => {
        expect(validateWorkflowContext({
            repository: 'absdjfh/dawnhub-advertiser-extension',
            ref: 'refs/heads/master',
            workflowRef: 'absdjfh/dawnhub-advertiser-extension/.github/workflows/release.yml@refs/heads/master',
        })).toBeTruthy();
    });

    it.each([
        {repository: 'attacker/fork', ref: 'refs/heads/master', workflowRef: 'attacker/fork/.github/workflows/release.yml@refs/heads/master'},
        {repository: 'absdjfh/dawnhub-advertiser-extension', ref: 'refs/heads/feature', workflowRef: 'absdjfh/dawnhub-advertiser-extension/.github/workflows/release.yml@refs/heads/feature'},
        {repository: 'absdjfh/dawnhub-advertiser-extension', ref: 'refs/tags/v2.28.2', workflowRef: 'absdjfh/dawnhub-advertiser-extension/.github/workflows/release.yml@refs/tags/v2.28.2'},
        {repository: 'absdjfh/dawnhub-advertiser-extension', ref: 'refs/heads/master', workflowRef: 'absdjfh/dawnhub-advertiser-extension/.github/workflows/other.yml@refs/heads/master'},
    ])('rejects an unsafe repository/ref/workflow context', context => {
        expect(() => validateWorkflowContext(context)).toThrow(ReleasePolicyError);
    });

    it.each(['runAudit', 'runCompile', 'runTests', 'runLint', 'uploadChrome', 'uploadFirefox', 'uploadFirefoxAndroid', 'sendReleaseNotes'])
        ('rejects caller attempts to add weakening flag %s', flag => {
            expect(() => validateReleaseInputs({...validInputs(), [flag]: false})).toThrow(/exactly/);
        });

    it('accepts a workflow other than the fixed release definition when named explicitly', () => {
        expect(validateWorkflowContext({
            repository: 'absdjfh/dawnhub-advertiser-extension',
            ref: 'refs/heads/master',
            workflowRef: 'absdjfh/dawnhub-advertiser-extension/.github/workflows/release-reconcile.yml@refs/heads/master',
        }, '.github/workflows/release-reconcile.yml')).toBeTruthy();
    });
});

function validReconcileActions() {
    return Object.fromEntries(RECONCILABLE_COMPONENTS.map(component => [component, RECONCILE_ACTIONS[component][0]]));
}

describe('reconcile input policy', () => {
    it('accepts one explicit action per reconcilable component', () => {
        const actions = validReconcileActions();
        expect(validateReconcileInputs({releaseIntentId: 'bot-request-42', actions})).toEqual({
            releaseIntentId: 'bot-request-42',
            actions,
        });
    });

    it('rejects an unknown or unspecified action for any component', () => {
        for (const component of RECONCILABLE_COMPONENTS) {
            for (const value of ['unspecified', '', 'yes', undefined]) {
                expect(() => validateReconcileInputs({
                    releaseIntentId: 'bot-request-42',
                    actions: {...validReconcileActions(), [component]: value},
                })).toThrow(ReleasePolicyError);
            }
        }
    });

    it('rejects the same unsafe release intent IDs as a production dispatch', () => {
        expect(() => validateReconcileInputs({releaseIntentId: 'intent$(whoami)', actions: validReconcileActions()}))
            .toThrow(ReleasePolicyError);
    });

    it('never lets a submission component silently default into being re-run', () => {
        expect(RECONCILE_ACTIONS.chromeSubmission).toEqual(['already-succeeded', 'not-attempted']);
    });

    it('reconciles exactly the components that follow the irreversible boundary', () => {
        expect(RECONCILABLE_COMPONENTS).toEqual(['chromeSubmission', 'hostedGeneration', 'hostedCommit', 'notification']);
    });
});

describe('dispatch input resolution', () => {
    const TIP = 'b'.repeat(40);
    const context = {masterTip: TIP, runId: '17654321', now: '2026-08-09T12:00:00.000Z'};

    function blankInputs(overrides = {}) {
        return {...validInputs({sourceSha: '', releaseIntentId: ''}), ...overrides};
    }

    it('fills a blank source SHA from the resolved tip and a blank intent from the run', () => {
        expect(resolveDispatchInputs(blankInputs(), context)).toEqual({
            inputs: {
                sourceSha: TIP,
                releaseIntentId: 'run-17654321',
                releaseDate: '2026-08-09',
                dryRun: true,
                profile: 'full',
            },
            sourceShaOrigin: 'origin-master-tip',
            releaseIntentIdOrigin: 'workflow-run',
        });
    });

    it('resolves a blank production dispatch the same way a dry run is resolved', () => {
        const resolution = resolveDispatchInputs(blankInputs({dryRun: 'false'}), context);
        expect(resolution.inputs.sourceSha).toBe(TIP);
        expect(resolution.inputs.dryRun).toBe(false);
        expect(resolution.sourceShaOrigin).toBe('origin-master-tip');
    });

    it('prefers dispatched values and reports them as dispatched', () => {
        const resolution = resolveDispatchInputs(validInputs(), context);
        expect(resolution.inputs.sourceSha).toBe(SHA);
        expect(resolution.inputs.releaseIntentId).toBe('manual-20260809-001');
        expect(resolution).toMatchObject({sourceShaOrigin: 'dispatch', releaseIntentIdOrigin: 'dispatch'});
    });

    it.each([
        [`  ${SHA.toUpperCase()}\n`, SHA],
        [`${SHA}\r\n`, SHA],
    ])('absorbs paste artefacts %j before the strict check', (sourceSha, expected) => {
        expect(resolveDispatchInputs(validInputs({sourceSha}), context).inputs.sourceSha).toBe(expected);
    });

    it.each([
        {sourceSha: 'abc123'},
        {sourceSha: `${SHA};git push`},
        {releaseIntentId: 'intent--two'},
        {releaseIntentId: 'intent$(whoami)'},
        {dryRun: 'TRUE'},
        {profile: 'chrome-only'},
    ])('still rejects a dispatched but invalid %j', overrides => {
        expect(() => resolveDispatchInputs(validInputs(overrides), context)).toThrow(ReleasePolicyError);
    });

    it.each([null, '', 'not-a-sha', SHA.toUpperCase()])(
        'refuses to invent a source SHA from an unusable tip %j',
        masterTip => {
            expect(() => resolveDispatchInputs(blankInputs(), {...context, masterTip}))
                .toThrow(/blank sourceSha needs/);
        },
    );

    it.each([undefined, '', '0', 'abc', '017', 17654321])(
        'refuses to invent an intent ID from an unusable run ID %j',
        runId => {
            expect(() => resolveDispatchInputs(blankInputs(), {...context, runId}))
                .toThrow(/numeric workflow run ID/);
        },
    );

    it.each([undefined, '', '2026-08-09', 'today', 1_754_740_800_000])(
        'refuses to date a release from an unusable run clock %j',
        now => {
            expect(() => resolveDispatchInputs(blankInputs(), {...context, now}))
                .toThrow(/run clock/);
        },
    );

    it('dates the release from the run clock and ignores anything version-shaped in the dispatch', () => {
        const resolution = resolveDispatchInputs(
            {...validInputs(), releaseDate: '2019-01-01', versionBump: 'major'},
            context,
        );
        expect(resolution.inputs.releaseDate).toBe('2026-08-09');
        expect(resolution.inputs).not.toHaveProperty('versionBump');
    });

    it('derives a stable intent ID so a re-run of the same dispatch reconciles to one intent', () => {
        expect(buildRunIntentId('17654321')).toBe(buildRunIntentId('17654321'));
        expect(buildRunIntentId('17654321')).not.toBe(buildRunIntentId('17654322'));
        expect(() => validateReleaseInputs(validInputs({releaseIntentId: buildRunIntentId('17654321')})))
            .not.toThrow();
    });
});

describe('fixed release plan', () => {
    it('executes every required local command group and no production operation in dry run', async () => {
        const run = vi.fn();
        const plan = await executePlanWithRunner(validInputs(), {run});

        expect(plan.profile).toBe('dry-run-full');
        expect(run.mock.calls.map(([operation]) => operation)).toEqual([
            'dependencies',
            'versionPlanning',
            'audit',
            'lint',
            'compile',
            'tests',
            'chromeBuildPackage',
        ]);
        expect(plan.operations).not.toEqual(expect.arrayContaining(PRODUCTION_OPERATIONS));
        expect(plan.operations).not.toEqual(expect.arrayContaining(PRODUCTION_MUTATIONS));
    });

    it('runs the dry profile through a fake command harness without any mutation command', () => {
        const calls = [];
        executeDryRunCommandHarness(validInputs(), {
            run(file, args, environment) {
                calls.push({file, args, environment});
            },
        }, '26.8.1');

        const commandLines = calls.map(call => [call.file, ...call.args].join(' '));
        expect(commandLines).toEqual(expect.arrayContaining([
            'npm ci',
            'npm ci --prefix .github/release',
            'npm version 26.8.2 --no-git-tag-version',
            'npm audit --omit=dev',
            'npm run lint',
            'npm run compile',
            'npm run test -- --run',
            'npm run build',
            'npm run zip',
        ]));
        expect(commandLines.join('\n')).not.toMatch(/git (?:push|tag)|wxt submit|publish-hosted-release|notify-release/);
        expect(calls.every(call => Object.keys(call.environment).length === 0)).toBe(true);
    });

    it('uses one fixed Chrome-only production profile', () => {
        const plan = buildReleasePlan(validInputs({dryRun: 'false'}));
        expect(plan.profile).toBe('production-full');
        expect(plan.operations).toEqual(expect.arrayContaining([
            'audit',
            'lint',
            'compile',
            'tests',
            'chromeBuildPackage',
            'chromeSubmission',
            'hostedCommit',
            'notification',
        ]));
        expect(plan.operations.filter(operation => /firefox/i.test(operation))).toEqual([]);
    });

    it.each([
        ['2.29.1', '2026-08-09', '26.8.1'],
        ['26.8.1', '2026-08-20', '26.8.2'],
        ['26.8.9', '2026-08-31', '26.8.10'],
        ['26.8.4', '2026-09-01', '26.9.1'],
        ['26.12.2', '2027-01-03', '27.1.1'],
    ])('calculates %s released on %s as %s', (original, releaseDate, expected) => {
        expect(calculateResultingVersion(original, releaseDate)).toBe(expected);
    });

    it('never descends when the checkout is ahead of the release calendar', () => {
        expect(() => calculateResultingVersion('26.9.1', '2026-08-09')).toThrow(/ahead of/);
        expect(() => calculateResultingVersion('27.1.1', '2026-12-31')).toThrow(/ahead of/);
    });

    it.each(['2026-02-30', '2026-00-10', '2026/08/09', ''])(
        'will not calculate a version from the impossible date %j',
        releaseDate => {
            expect(() => calculateResultingVersion('26.8.1', releaseDate)).toThrow(ReleasePolicyError);
        },
    );
});
