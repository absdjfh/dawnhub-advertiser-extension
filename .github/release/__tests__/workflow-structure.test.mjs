import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {HOSTED_RETAINED_VERSIONS} from '../hosted-retention.mjs';
import {OPERATION_DEFINITIONS} from '../operations.mjs';

const workflowPath = resolve('.github/workflows/release.yml');
const ciPath = resolve('.github/workflows/ci.yml');
// A Windows checkout with core.autocrlf has CRLF line breaks, which the checks below do not expect.
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const ci = readFileSync(ciPath, 'utf8').replace(/\r\n/g, '\n');

describe('release workflow structure', () => {
    it('declares explicit minimal permissions and non-cancelling production concurrency', () => {
        expect(workflow).toMatch(/permissions:\s*\n\s+contents: write/);
        expect(workflow).toContain('extension-release-production');
        expect(workflow).toMatch(/cancel-in-progress: false\s*\n\s+queue: max\n/);
    });

    it('uses master as the authoritative branch everywhere', () => {
        expect(ci).toMatch(/branches:\s*\n\s+- master/);
        expect(workflow).toContain('ref: master');
        expect(workflow).toContain('RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}');
        expect(workflow).toContain('origin/master');
        expect(workflow).not.toContain('github.head_ref');
        expect(workflow).not.toMatch(/\bmain\b/);
    });

    it('exposes only the strict fixed release inputs', () => {
        expect([...workflow.matchAll(/^ {6}(\w+):$/gm)].map(match => match[1]))
            .toEqual(['dryRun', 'sourceSha', 'releaseIntentId']);
        for (const removed of ['runAudit', 'runCompile', 'runTests', 'runLint', 'uploadChrome', 'uploadFirefox', 'uploadFirefoxAndroid', 'sendReleaseNotes', 'profile', 'versionBump']) {
            expect(workflow).not.toContain(removed);
        }
    });

    it('makes only the two derivable identifiers optional and fixes the profile', () => {
        for (const decision of ['dryRun']) {
            expect(inputBlock(decision), decision).toContain('required: true');
        }
        for (const derivable of ['sourceSha', 'releaseIntentId']) {
            expect(inputBlock(derivable), derivable).toContain('required: false');
            expect(inputBlock(derivable), derivable).toMatch(/default: ''/);
        }
        expect(workflow).toContain('RELEASE_PROFILE: full');
        expect(workflow).not.toContain('keep');
    });

    it('resolves blank inputs before any validation and never shadows the result', () => {
        const resolve = workflow.indexOf('node .github/release/cli.mjs resolve-inputs');
        const validate = workflow.indexOf('node .github/release/cli.mjs validate-inputs');
        expect(resolve).toBeGreaterThan(0);
        expect(resolve).toBeLessThan(validate);
        expect(stepBlock('Validate release inputs')).toContain("steps.input_resolution.outcome == 'success'");
        // A job-level entry would win over the environment file the resolve step
        // writes, so these two names must exist only in their input form.
        expect(workflow).not.toMatch(/^ {6}RELEASE_SOURCE_SHA:/m);
        expect(workflow).not.toMatch(/^ {6}RELEASE_INTENT_ID:/m);
        expect(workflow).not.toMatch(/^ {6}RELEASE_DATE:/m);
    });

    it('validates source and intent before install or any production operation', () => {
        const source = workflow.indexOf('node .github/release/cli.mjs validate-source');
        const intent = workflow.indexOf('node .github/release/cli.mjs validate-intent');
        const install = workflow.indexOf('node .github/release/cli.mjs run dependencies');
        const boundary = workflow.indexOf('node .github/release/cli.mjs push-boundary');
        expect(source).toBeGreaterThan(0);
        expect(source).toBeLessThan(intent);
        expect(intent).toBeLessThan(install);
        expect(install).toBeLessThan(boundary);
    });

    it('hard-guards every production step from dry run', () => {
        for (const stepName of [
            'Validate Chrome credentials without submission',
            'Prepare local version commit and release refs',
            'Atomically push version and production intent marker',
            'Submit Chrome package',
            'Restore hosted files from the hosted branch',
            'Generate hosted release files in the workspace',
            'Commit and guarded-push hosted release files',
        ]) {
            const block = stepBlock(stepName);
            expect(block, stepName).toContain('inputs.dryRun == false');
        }
    });

    it('pins checkout source shape and makes the first remote write atomic and leased', () => {
        expect(workflow).toContain('fetch-depth: 0');
        expect(workflow).toContain('fetch-tags: true');
        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).toContain('exact irreversible boundary');
    });

    it('cannot disable required checks or configured production targets', () => {
        expect(OPERATION_DEFINITIONS.dependencies.commands).toEqual([['npm', ['ci']]]);
        expect(OPERATION_DEFINITIONS.lint.commands).toEqual([['npm', ['run', 'lint']]]);
        expect(OPERATION_DEFINITIONS.compile.commands).toEqual([['npm', ['run', 'compile']]]);
        expect(OPERATION_DEFINITIONS.tests.commands).toEqual([['npm', ['run', 'test', '--', '--run']]]);
        expect(OPERATION_DEFINITIONS.chromeBuildPackage.commands).toBeDefined();
        expect(OPERATION_DEFINITIONS.chromeSubmission.commandFactory).toBeDefined();
        // Chrome only: reading a DM needs Chrome's on-device Prompt API, so there is no Firefox target to skip.
        expect(Object.keys(OPERATION_DEFINITIONS).filter(operation => /firefox/i.test(operation))).toEqual([]);
    });

    it('runs every required check, build, and package command in CI with cached lockfiles', () => {
        for (const command of [
            'npm ci',
            'npm run lint',
            'npm run compile',
            'npm run test -- --run',
            'npm run test:release',
            'npm run build',
            'npm run zip',
        ]) {
            expect(ci.split(/\r?\n/), command).toContain(`      - run: ${command}`);
        }
        expect(ci).toContain('cache: npm');
    });

    it('sends no release notifications and needs no release-only dependencies', () => {
        const reconcile = readFileSync(resolve('.github/workflows/release-reconcile.yml'), 'utf8');
        for (const text of [workflow, reconcile, ci]) {
            expect(text).not.toMatch(/SMTP_|RELEASE_NOTES_EMAIL_TO|DISCORD_WEBHOOK_URL|notification/i);
            expect(text).not.toContain('.github/release/package-lock.json');
        }
        expect(OPERATION_DEFINITIONS).not.toHaveProperty('notification');
        expect(existsSync(resolve('.github/release/package.json'))).toBe(false);
    });

    it('keeps all release executables in the dependency-free mjs module', () => {
        expect(OPERATION_DEFINITIONS.hostedGeneration.commands[0][1]).toEqual(['.github/release/publish-hosted-release.mjs']);

        for (const oldPath of [
            '.github/release/notify-release.mjs',
            '.github/release/fetch-firefox-xpi.mjs',
            '.github/firefox-fetch-xpi.ts',
            '.github/publish-hosted-release.ts',
            '.github/release-notes-email.ts',
            '.github/release-notes.ts',
            '.github/tsconfig.json',
        ]) {
            expect(existsSync(resolve(oldPath)), oldPath).toBe(false);
        }
    });

    it('restores the hosted branch before any hosted file is generated or pruned, and publishes to it, never master', () => {
        const submission = workflow.indexOf('node .github/release/cli.mjs run chromeSubmission');
        const seed = workflow.indexOf('node .github/release/cli.mjs seed-hosted');
        const generation = workflow.indexOf('node .github/release/cli.mjs run hostedGeneration');
        const commit = workflow.indexOf('node .github/release/cli.mjs commit-hosted');
        expect(submission).toBeGreaterThan(0);
        expect(submission).toBeLessThan(seed);
        expect(seed).toBeLessThan(generation);
        expect(generation).toBeLessThan(commit);
        expect(stepBlock('Restore hosted files from the hosted branch')).toContain("steps.chrome_submission.outcome == 'success'");
        expect(stepBlock('Restore hosted files from the hosted branch')).toContain('RELEASE_GITHUB_TOKEN');
        expect(stepBlock('Generate hosted release files in the workspace')).toContain("steps.hosted_seed.outcome == 'success'");
    });

    it('keeps only the last five versions in the hosted location', () => {
        expect(HOSTED_RETAINED_VERSIONS).toBe(5);
    });

    it('always finalizes and uploads machine-readable result metadata', () => {
        expect(workflow).toMatch(/name: Finalize result and job summary\s*\n\s+if: \$\{\{ always\(\) }}/);
        expect(workflow).toContain('actions/upload-artifact@v4');
        expect(workflow).toContain('.output/release-result.json');
    });
});

function inputBlock(name) {
    const header = `\n      ${name}:\n`;
    const start = workflow.indexOf(header);
    if (start < 0) {
        return '';
    }
    // Everything up to the next sibling input or any dedent out of the list.
    const body = workflow.slice(start + header.length);
    const next = body.search(/\n {0,6}\S/);
    return next < 0 ? body : body.slice(0, next);
}

function stepBlock(name) {
    const start = workflow.indexOf(`- name: ${name}`);
    if (start < 0) {
        return '';
    }
    const next = workflow.indexOf('\n      - name:', start + 1);
    return workflow.slice(start, next < 0 ? workflow.length : next);
}
