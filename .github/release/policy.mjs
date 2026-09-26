// 1.1 adds sourceShaOrigin/releaseIntentIdOrigin. 1.2 replaces
// requestedVersionBump with releaseDate, now that versions come from the
// calendar. The intent-marker schema in git-release.mjs is versioned separately
// and is still 1.0.
export const RELEASE_RESULT_SCHEMA_VERSION = '1.2';
export const AUTHORITATIVE_BRANCH = 'master';
export const RELEASE_PROFILE = 'full';
export const RELEASE_REPOSITORY = 'absdjfh/dawnhub-advertiser-extension';
export const RELEASE_WORKFLOW_FILE = '.github/workflows/release.yml';
export const RECONCILE_WORKFLOW_FILE = '.github/workflows/release-reconcile.yml';

export const RELEASE_INPUT_KEYS = Object.freeze([
    'sourceSha',
    'releaseIntentId',
    'releaseDate',
    'dryRun',
    'profile',
]);

// Versions are read off the calendar rather than chosen: two-digit year, month,
// and the release's position within that month, e.g. 26.8.5. There is no bump
// to decide, so the only version-shaped input is the day the release is cut,
// resolved once from the run clock and explicit everywhere after that.
export const RELEASE_DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

// A dispatch may leave the two reconciliation-critical inputs blank. Resolution
// is a separate step in front of validateReleaseInputs, so the strict interface
// below never learns about blanks: by the time anything is validated, both
// values are as explicit as a support-bot dispatch would have made them.
export const AUTO_INTENT_PREFIX = 'run-';

export const RELEASE_INTENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const COMPONENTS = Object.freeze([
    'inputValidation',
    'sourceValidation',
    'intentValidation',
    'dependencies',
    'versionPlanning',
    'audit',
    'lint',
    'compile',
    'tests',
    'chromeBuildPackage',
    'chromeCredentialValidation',
    'versionCommitTag',
    'chromeSubmission',
    'hostedGeneration',
    'hostedCommit',
    'notification',
]);

const BASE_OPERATIONS = Object.freeze([
    'dependencies',
    'versionPlanning',
    'audit',
    'lint',
    'compile',
    'tests',
    'chromeBuildPackage',
]);

export const PRODUCTION_OPERATIONS = Object.freeze([
    'chromeCredentialValidation',
    'versionCommitTag',
    'chromeSubmission',
    'hostedGeneration',
    'hostedCommit',
    'notification',
]);

export const PRODUCTION_MUTATIONS = Object.freeze([
    'versionCommitTag',
    'chromeSubmission',
    'hostedCommit',
    'notification',
]);

export const REQUIRED_DRY_RUN_COMPONENTS = Object.freeze([
    'inputValidation',
    'sourceValidation',
    'intentValidation',
    ...BASE_OPERATIONS,
]);

export const REQUIRED_PRODUCTION_COMPONENTS = Object.freeze([
    ...REQUIRED_DRY_RUN_COMPONENTS,
    ...PRODUCTION_OPERATIONS.filter(component => component !== 'notification'),
]);

// The reconciliation job never redoes pre-boundary validation and never
// decides for itself whether a store submission already landed: each of these
// components takes one explicit action, chosen by whoever checked the real
// external state. There is no default: an operator must pick one every time.
const ALREADY_OR_RUN = Object.freeze(['already-succeeded', 'not-attempted']);

export const RECONCILE_ACTIONS = Object.freeze({
    chromeSubmission: ALREADY_OR_RUN,
    hostedGeneration: Object.freeze(['already-generated', 'generate-now']),
    hostedCommit: Object.freeze(['already-committed', 'commit-now']),
    notification: Object.freeze(['already-sent', 'send-now', 'skip']),
});

export const RECONCILABLE_COMPONENTS = Object.freeze(Object.keys(RECONCILE_ACTIONS));

export class ReleasePolicyError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ReleasePolicyError';
        this.code = code;
    }
}

export function validateReleaseInputs(rawInputs) {
    if (rawInputs === null || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
        throw new ReleasePolicyError('INVALID_INPUT_OBJECT', 'Release inputs must be an object.');
    }

    const keys = Object.keys(rawInputs).sort();
    const expectedKeys = [...RELEASE_INPUT_KEYS].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
        throw new ReleasePolicyError(
            'UNKNOWN_INPUT',
            `Release inputs must contain exactly: ${RELEASE_INPUT_KEYS.join(', ')}.`,
        );
    }

    const sourceSha = requireString(rawInputs.sourceSha, 'sourceSha');
    if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
        throw new ReleasePolicyError(
            'INVALID_SOURCE_SHA',
            'sourceSha must be exactly 40 lowercase hexadecimal characters.',
        );
    }

    const releaseIntentId = requireString(rawInputs.releaseIntentId, 'releaseIntentId');
    validateReleaseIntentIdFormat(releaseIntentId);

    const releaseDate = requireString(rawInputs.releaseDate, 'releaseDate');
    parseReleaseDate(releaseDate);

    const dryRun = parseStrictBoolean(rawInputs.dryRun);
    const profile = requireString(rawInputs.profile, 'profile');
    if (profile !== RELEASE_PROFILE) {
        throw new ReleasePolicyError('INVALID_PROFILE', `profile must be exactly ${RELEASE_PROFILE}.`);
    }

    return Object.freeze({sourceSha, releaseIntentId, releaseDate, dryRun, profile});
}

export function resolveDispatchInputs(rawInputs, context) {
    if (rawInputs === null || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
        throw new ReleasePolicyError('INVALID_INPUT_OBJECT', 'Release inputs must be an object.');
    }

    // Whitespace and letter case are dispatch-form accidents rather than release
    // decisions. A SHA pasted with a trailing newline is still required to be
    // exactly 40 hex characters once it reaches validateReleaseInputs.
    const sourceSha = normalizeDispatchValue(rawInputs.sourceSha, true);
    const releaseIntentId = normalizeDispatchValue(rawInputs.releaseIntentId, true);
    const sourceShaOrigin = sourceSha === '' ? 'origin-master-tip' : 'dispatch';
    const releaseIntentIdOrigin = releaseIntentId === '' ? 'workflow-run' : 'dispatch';

    const inputs = validateReleaseInputs({
        sourceSha: sourceShaOrigin === 'dispatch' ? sourceSha : requireAuthoritativeTip(context.masterTip),
        releaseIntentId: releaseIntentIdOrigin === 'dispatch'
            ? releaseIntentId
            : buildRunIntentId(context.runId),
        releaseDate: buildReleaseDate(context.now),
        dryRun: normalizeDispatchValue(rawInputs.dryRun, false),
        profile: normalizeDispatchValue(rawInputs.profile, false),
    });

    return Object.freeze({inputs, sourceShaOrigin, releaseIntentIdOrigin});
}

// The workflow run ID is already the anchor a reconciler starts from, and GitHub
// keeps it stable across re-runs of the same dispatch. That is exactly the
// intent semantics the manual naming convention asked a human to hand-build: a
// pre-boundary retry reuses its intent, while a post-boundary retry is refused
// by the accepted marker instead of publishing twice under a fresh ID.
export function buildRunIntentId(runId) {
    if (typeof runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runId)) {
        throw new ReleasePolicyError(
            'RUN_ID_UNRESOLVED',
            'A blank releaseIntentId needs the numeric workflow run ID to derive one.',
        );
    }
    return `${AUTO_INTENT_PREFIX}${runId}`;
}

// A reconciliation dispatch is anchored to a specific accepted intent rather
// than to a fresh source/version decision, so it validates only which of the
// components that follow the irreversible boundary the operator has checked
// and what to do about each one.
export function validateReconcileInputs(rawInputs) {
    if (rawInputs === null || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
        throw new ReleasePolicyError('INVALID_INPUT_OBJECT', 'Reconcile inputs must be an object.');
    }
    const releaseIntentId = requireString(rawInputs.releaseIntentId, 'releaseIntentId');
    validateReleaseIntentIdFormat(releaseIntentId);

    const actions = {};
    for (const component of RECONCILABLE_COMPONENTS) {
        const allowed = RECONCILE_ACTIONS[component];
        const value = requireString(rawInputs.actions?.[component], `${component}Action`);
        if (!allowed.includes(value)) {
            throw new ReleasePolicyError(
                'INVALID_RECONCILE_ACTION',
                `${component}Action must be one of: ${allowed.join(', ')}.`,
            );
        }
        actions[component] = value;
    }
    return Object.freeze({releaseIntentId, actions: Object.freeze(actions)});
}

export function validateWorkflowContext(context, workflowFile = RELEASE_WORKFLOW_FILE) {
    const expectedRef = `refs/heads/${AUTHORITATIVE_BRANCH}`;
    const expectedWorkflowRef = `${RELEASE_REPOSITORY}/${workflowFile}@${expectedRef}`;
    if (context.repository !== RELEASE_REPOSITORY) {
        throw new ReleasePolicyError('INVALID_REPOSITORY', 'Release workflow is running in an unexpected repository.');
    }
    if (context.ref !== expectedRef) {
        throw new ReleasePolicyError('UNSAFE_WORKFLOW_REF', `Release workflow must be dispatched from ${expectedRef}.`);
    }
    if (context.workflowRef !== expectedWorkflowRef) {
        throw new ReleasePolicyError(
            'UNSAFE_WORKFLOW_DEFINITION',
            'Release workflow definition is not the allowlisted master workflow file.',
        );
    }
    return Object.freeze({repository: context.repository, ref: context.ref, workflowRef: context.workflowRef});
}

export function buildReleasePlan(inputs) {
    const validated = validateReleaseInputs(inputs);
    return Object.freeze({
        profile: validated.dryRun ? 'dry-run-full' : 'production-full',
        dryRun: validated.dryRun,
        operations: Object.freeze([
            ...BASE_OPERATIONS,
            ...(validated.dryRun ? [] : PRODUCTION_OPERATIONS),
        ]),
    });
}

export function assertOperationAllowed(operation, inputs) {
    const plan = buildReleasePlan(inputs);
    if (!plan.operations.includes(operation)) {
        throw new ReleasePolicyError(
            'OPERATION_NOT_ALLOWED',
            `Operation ${String(operation)} is not allowed by ${plan.profile}.`,
        );
    }
    if (plan.dryRun && PRODUCTION_MUTATIONS.includes(operation)) {
        throw new ReleasePolicyError('DRY_RUN_MUTATION_BLOCKED', 'Dry-run policy blocked a production mutation.');
    }
    return plan;
}

export async function executePlanWithRunner(inputs, runner) {
    const plan = buildReleasePlan(inputs);
    for (const operation of plan.operations) {
        if (plan.dryRun && PRODUCTION_OPERATIONS.includes(operation)) {
            throw new ReleasePolicyError('DRY_RUN_OPERATION_BLOCKED', 'Dry-run plan contained a production operation.');
        }
        await runner.run(operation);
    }
    return plan;
}

// The calendar decides the first two components; the current version decides
// only whether this is the month's first release. Counting from 1 keeps the
// increment readable as "the nth release of that month".
export function calculateResultingVersion(originalVersion, releaseDate) {
    const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(originalVersion);
    if (!match) {
        throw new ReleasePolicyError('INVALID_PACKAGE_VERSION', 'package.json version must be a plain numeric semver.');
    }
    const {year, month} = parseReleaseDate(releaseDate);
    const [publishedYear, publishedMonth, increment] = match.slice(1).map(Number);
    // A published version from a later month than the one being released means
    // the checkout and the clock disagree. Continuing would publish a version
    // lower than the one already in the stores, so fail instead of descending.
    if (publishedYear > year || (publishedYear === year && publishedMonth > month)) {
        throw new ReleasePolicyError(
            'VERSION_NOT_ASCENDING',
            `Version ${originalVersion} is ahead of the ${year}.${month} release calendar.`,
        );
    }
    const sameMonth = publishedYear === year && publishedMonth === month;
    return `${year}.${month}.${sameMonth ? increment + 1 : 1}`;
}

// Splits a release day into the two version components taken from the calendar.
// A day that does not exist is rejected here rather than quietly becoming a
// month of `0`, because every later step trusts these two numbers.
export function parseReleaseDate(releaseDate) {
    const match = RELEASE_DATE_PATTERN.exec(releaseDate);
    const [year, month, day] = match === null ? [] : match.slice(1).map(Number);
    const utc = match === null ? null : new Date(Date.UTC(year, month - 1, day));
    if (
        utc === null
        || utc.getUTCFullYear() !== year
        || utc.getUTCMonth() !== month - 1
        || utc.getUTCDate() !== day
    ) {
        throw new ReleasePolicyError('INVALID_RELEASE_DATE', 'releaseDate must be an exact YYYY-MM-DD calendar day.');
    }
    return Object.freeze({year: year % 100, month});
}

// The run's own clock, in UTC, is the only source of the release day. It is
// read once during input resolution so that every later step — proposed-version
// preflight, the applied version, and the tag — agrees even if the run spans
// midnight at the end of a month.
export function buildReleaseDate(now) {
    if (typeof now !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(now)) {
        throw new ReleasePolicyError(
            'RELEASE_DATE_UNRESOLVED',
            'The release date needs the run clock as an ISO-8601 UTC timestamp.',
        );
    }
    const releaseDate = now.slice(0, 10);
    parseReleaseDate(releaseDate);
    return releaseDate;
}

function requireAuthoritativeTip(masterTip) {
    if (typeof masterTip !== 'string' || !/^[a-f0-9]{40}$/.test(masterTip)) {
        throw new ReleasePolicyError(
            'MASTER_TIP_UNRESOLVED',
            `A blank sourceSha needs a resolved origin/${AUTHORITATIVE_BRANCH} tip.`,
        );
    }
    return masterTip;
}

function normalizeDispatchValue(value, lowercase) {
    if (typeof value !== 'string') {
        return value;
    }
    const trimmed = value.trim();
    return lowercase ? trimmed.toLowerCase() : trimmed;
}

function validateReleaseIntentIdFormat(releaseIntentId) {
    if (
        releaseIntentId.length > 64
        || !RELEASE_INTENT_ID_PATTERN.test(releaseIntentId)
        || releaseIntentId.includes('--')
    ) {
        throw new ReleasePolicyError(
            'INVALID_RELEASE_INTENT_ID',
            'releaseIntentId must be 1-64 lowercase letters, digits, or single hyphens, without edge hyphens.',
        );
    }
}

function requireString(value, field) {
    if (typeof value !== 'string') {
        throw new ReleasePolicyError('INVALID_INPUT_TYPE', `${field} must be a string.`);
    }
    return value;
}

function parseStrictBoolean(value) {
    if (value === true || value === 'true') {
        return true;
    }
    if (value === false || value === 'false') {
        return false;
    }
    throw new ReleasePolicyError('INVALID_DRY_RUN', 'dryRun must be exactly true or false.');
}
