import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
    AUTHORITATIVE_BRANCH,
    COMPONENTS,
    PRODUCTION_OPERATIONS,
    RELEASE_RESULT_SCHEMA_VERSION,
    REQUIRED_DRY_RUN_COMPONENTS,
    REQUIRED_PRODUCTION_COMPONENTS,
} from './policy.mjs';

const RESULT_STATUSES = new Set([
    'pending',
    'success',
    'failure',
    'ambiguous',
    'skipped_dry_run',
    'skipped_dependency',
]);

export function createReleaseResult(run) {
    const components = Object.fromEntries(COMPONENTS.map(component => [component, {
        status: 'pending',
        summary: null,
    }]));
    return {
        schemaVersion: RELEASE_RESULT_SCHEMA_VERSION,
        releaseIntentId: null,
        releaseIntentIdOrigin: null,
        dryRun: null,
        profile: null,
        approvedSourceSha: null,
        sourceShaOrigin: null,
        authoritativeBranch: AUTHORITATIVE_BRANCH,
        releaseDate: null,
        originalPackageVersion: null,
        resultingPackageVersion: null,
        versionCommitSha: null,
        releaseCommitSha: null,
        tag: null,
        intentMarker: null,
        github: {
            repository: safeRunValue(run.repository, 200),
            workflow: safeRunValue(run.workflow, 120),
            runId: safeRunValue(run.runId, 40),
            runAttempt: safeRunValue(run.runAttempt, 20),
            runUrl: safeRunUrl(run.runUrl),
        },
        startedAt: run.timestamp ?? new Date().toISOString(),
        completedAt: null,
        components,
        overallStatus: 'running',
        errorSummary: null,
    };
}

export function recordValidatedInputs(result, inputs) {
    result.releaseIntentId = inputs.releaseIntentId;
    result.dryRun = inputs.dryRun;
    result.profile = inputs.dryRun ? 'dry-run-full' : 'production-full';
    result.approvedSourceSha = inputs.sourceSha;
    result.releaseDate = inputs.releaseDate;
    recordComponent(result, 'inputValidation', 'success', 'Strict release inputs accepted.');
    return result;
}

export function recordComponent(result, component, status, summary = null) {
    if (!COMPONENTS.includes(component)) {
        throw new Error(`Unknown release result component: ${String(component)}`);
    }
    if (!RESULT_STATUSES.has(status)) {
        throw new Error(`Unknown release result status: ${String(status)}`);
    }
    result.components[component] = {
        status,
        summary: summary === null ? null : safeSummary(summary),
    };
    return result;
}

export function finalizeReleaseResult(result, timestamp = new Date().toISOString()) {
    const production = result.dryRun === false;
    for (const component of COMPONENTS) {
        if (result.components[component].status !== 'pending') {
            continue;
        }
        const dryRunProductionSkip = result.dryRun === true && PRODUCTION_OPERATIONS.includes(component);
        recordComponent(
            result,
            component,
            dryRunProductionSkip ? 'skipped_dry_run' : 'skipped_dependency',
            dryRunProductionSkip
                ? 'Not part of the no-write dry-run profile.'
                : 'Not run because an earlier required component did not succeed.',
        );
    }

    const required = production ? REQUIRED_PRODUCTION_COMPONENTS : REQUIRED_DRY_RUN_COMPONENTS;
    const ambiguous = required.filter(component => result.components[component].status === 'ambiguous');
    const failed = required.filter(component => !['success'].includes(result.components[component].status));
    if (ambiguous.length > 0) {
        result.overallStatus = 'ambiguous';
        result.errorSummary = safeSummary(`Reconciliation required for: ${ambiguous.join(', ')}.`);
    } else if (failed.length > 0) {
        result.overallStatus = 'failure';
        result.errorSummary = safeSummary(`Required components did not succeed: ${failed.join(', ')}.`);
    } else {
        result.overallStatus = 'success';
        result.errorSummary = null;
    }
    result.completedAt = timestamp;
    return result;
}

export function safeSummary(value) {
    let summary = String(value)
        .replace(/\r?\n|\r/g, ' ')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[REDACTED]')
        .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(authorization|password|secret|token|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
        .replace(/\s+/g, ' ')
        .trim();
    if (summary.length > 240) {
        summary = `${summary.slice(0, 237)}...`;
    }
    return summary;
}

export async function readResult(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeResult(path, result) {
    await mkdir(dirname(path), {recursive: true});
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    await rename(temporaryPath, path);
}

export function renderJobSummary(result) {
    const componentRows = COMPONENTS.map(component => {
        const outcome = result.components[component];
        return `| ${component} | ${outcome.status} | ${escapeMarkdown(outcome.summary ?? '')} |`;
    }).join('\n');
    return [
        '# Extension release result',
        '',
        `- Intent: \`${result.releaseIntentId ?? 'invalid/unavailable'}\`${originNote(result.releaseIntentIdOrigin)}`,
        `- Profile: \`${result.profile ?? 'unavailable'}\``,
        `- Approved source: \`${result.approvedSourceSha ?? 'unavailable'}\`${originNote(result.sourceShaOrigin)}`,
        `- Authoritative branch: \`${result.authoritativeBranch}\``,
        `- Version: \`${result.originalPackageVersion ?? 'unavailable'}\` → \`${result.resultingPackageVersion ?? 'unavailable'}\``,
        `- Version commit: \`${result.versionCommitSha ?? 'not created'}\``,
        `- Final release commit: \`${result.releaseCommitSha ?? 'not created'}\``,
        `- Tag: \`${result.tag ?? 'not created'}\``,
        `- Run: ${result.github.runUrl ? `[${result.github.runId}](${result.github.runUrl})` : result.github.runId ?? 'unavailable'}`,
        `- Overall: **${result.overallStatus}**`,
        result.errorSummary ? `- Summary: ${escapeMarkdown(result.errorSummary)}` : '',
        '',
        '| Component | Status | Summary |',
        '| --- | --- | --- |',
        componentRows,
        '',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

// A reconciler reading only the summary should not have to guess whether a value
// was approved by the dispatcher or filled in for them.
function originNote(origin) {
    if (origin === 'origin-master-tip') {
        return ` (resolved from origin/${AUTHORITATIVE_BRANCH})`;
    }
    if (origin === 'workflow-run') {
        return ' (derived from the workflow run)';
    }
    return '';
}

function safeRunValue(value, maxLength) {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    return value.slice(0, maxLength);
}

function safeRunUrl(value) {
    if (typeof value !== 'string' || value.length > 500) {
        return null;
    }
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'github.com' ? value : null;
    } catch {
        return null;
    }
}

function escapeMarkdown(value) {
    return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}
