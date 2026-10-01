import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {OPERATION_DEFINITIONS} from '../operations.mjs';
import {RECONCILABLE_COMPONENTS, RECONCILE_ACTIONS} from '../policy.mjs';

// A Windows checkout with core.autocrlf has CRLF line breaks, which the checks below do not expect.
const workflow = readFileSync(resolve('.github/workflows/release-reconcile.yml'), 'utf8').replace(/\r\n/g, '\n');

describe('release reconcile workflow structure', () => {
    it('requires an explicit choice for every reconcilable component, defaulting to none of them', () => {
        for (const component of RECONCILABLE_COMPONENTS) {
            const options = RECONCILE_ACTIONS[component];
            const block = inputBlock(`${component}Action`);
            expect(block, component).toContain('default: unspecified');
            expect(block, component).toContain('required: true');
            for (const option of options) {
                expect(block, component).toContain(option);
            }
            expect(block, component).not.toMatch(new RegExp(`default: (?!unspecified)(${options.join('|')})`));
        }
    });

    it('flags exactly the reconcilable components that need a hand-written case in cli.mjs reconcile()', () => {
        // Every reconcilable "-now" action runs through the generic
        // runConfiguredOperation(component, ...) path in cli.mjs UNLESS the
        // component has no OPERATION_DEFINITIONS entry. hostedCommit is the
        // one exception today: it is a guarded Git push (publishHostedBranch),
        // not a configured command. If this list ever changes, cli.mjs's
        // reconcile() loop must grow a matching special case or it will throw
        // "Operation <x> is not a configured command operation." at runtime.
        const withoutDefinition = RECONCILABLE_COMPONENTS.filter(component => !(component in OPERATION_DEFINITIONS));
        expect(withoutDefinition).toEqual(['hostedCommit']);
    });

    it('shares the non-cancelling production lane so it cannot race or displace a release', () => {
        expect(workflow).toMatch(/group: extension-release-production\s*\n\s+cancel-in-progress: false\s*\n\s+queue: max\n/);
    });

    it('always finalizes and uploads machine-readable result metadata', () => {
        expect(workflow).toMatch(/name: Finalize result and job summary\s*\n\s+if: \$\{\{ always\(\) }}/);
        expect(workflow).toContain('actions/upload-artifact@v4');
    });

    it('checks out full history and tags without persisting credentials', () => {
        expect(workflow).toContain('fetch-depth: 0');
        expect(workflow).toContain('fetch-tags: true');
        expect(workflow).toContain('persist-credentials: false');
    });
});

function inputBlock(name) {
    const header = `\n      ${name}:\n`;
    const start = workflow.indexOf(header);
    if (start < 0) {
        return '';
    }
    const body = workflow.slice(start + header.length);
    const next = body.search(/\n {0,6}\S/);
    return next < 0 ? body : body.slice(0, next);
}
