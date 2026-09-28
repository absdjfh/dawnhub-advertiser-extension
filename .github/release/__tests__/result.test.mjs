import {describe, expect, it} from 'vitest';
import {
    REQUIRED_DRY_RUN_COMPONENTS,
    REQUIRED_PRODUCTION_COMPONENTS,
} from '../policy.mjs';
import {
    createReleaseResult,
    finalizeReleaseResult,
    recordComponent,
    recordValidatedInputs,
    safeSummary,
} from '../result.mjs';

function resultFor(dryRun) {
    const result = createReleaseResult({
        repository: 'absdjfh/dawnhub-advertiser-extension',
        workflow: 'Release',
        runId: '123',
        runAttempt: '1',
        runUrl: 'https://github.com/absdjfh/dawnhub-advertiser-extension/actions/runs/123',
        timestamp: '2026-08-09T12:00:00.000Z',
    });
    recordValidatedInputs(result, {
        sourceSha: 'a'.repeat(40),
        releaseIntentId: 'manual-20260809-001',
        releaseDate: '2026-08-09',
        dryRun,
    });
    result.originalPackageVersion = '26.8.1';
    result.resultingPackageVersion = '26.8.2';
    return result;
}

function succeedRequired(result, required) {
    for (const component of required) {
        recordComponent(result, component, 'success', `${component} passed.`);
    }
}

describe('release result model', () => {
    it('represents complete production success', () => {
        const result = resultFor(false);
        succeedRequired(result, REQUIRED_PRODUCTION_COMPONENTS);
        result.versionCommitSha = 'b'.repeat(40);
        result.releaseCommitSha = 'c'.repeat(40);
        result.tag = 'v2.28.3';

        finalizeReleaseResult(result, '2026-08-09T13:00:00.000Z');

        expect(result.overallStatus).toBe('success');
        expect(result.versionCommitSha).toHaveLength(40);
        expect(result.components.chromeSubmission.status).toBe('success');
    });

    it('represents dry-run success and skips every production component', () => {
        const result = resultFor(true);
        succeedRequired(result, REQUIRED_DRY_RUN_COMPONENTS);

        finalizeReleaseResult(result);

        expect(result.overallStatus).toBe('success');
        expect(result.components.versionCommitTag.status).toBe('skipped_dry_run');
        expect(result.components.chromeSubmission.status).toBe('skipped_dry_run');
        expect(result.components.hostedCommit.status).toBe('skipped_dry_run');
    });

    it('reports a required component failure without collapsing skipped production components into it', () => {
        const result = resultFor(true);
        succeedRequired(result, REQUIRED_DRY_RUN_COMPONENTS);
        recordComponent(result, 'compile', 'failure', 'Compile failed.');

        finalizeReleaseResult(result);

        expect(result.overallStatus).toBe('failure');
        expect(result.components.compile.status).toBe('failure');
        expect(result.components.hostedCommit.status).toBe('skipped_dry_run');
    });

    it('reports ambiguous external state separately', () => {
        const result = resultFor(false);
        succeedRequired(result, REQUIRED_PRODUCTION_COMPONENTS);
        recordComponent(result, 'chromeSubmission', 'ambiguous', 'Submission timed out.');

        finalizeReleaseResult(result);

        expect(result.overallStatus).toBe('ambiguous');
        expect(result.errorSummary).toContain('chromeSubmission');
    });

    it('redacts secrets, flattens lines, and bounds safe messages', () => {
        const unsafe = `Bearer top-secret-token\npassword=hunter2 ${'x'.repeat(400)}`;
        const safe = safeSummary(unsafe);
        expect(safe).not.toContain('top-secret-token');
        expect(safe).not.toContain('hunter2');
        expect(safe).not.toContain('\n');
        expect(safe.length).toBeLessThanOrEqual(240);
    });
});

