import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {SITE_WORKFLOW_FILE, validateWorkflowContext} from '../policy.mjs';

// A Windows checkout with core.autocrlf has CRLF line breaks, which the checks below do not expect.
const workflow = readFileSync(resolve(SITE_WORKFLOW_FILE), 'utf8').replace(/\r\n/g, '\n');
const releaseWorkflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n');
const reconcileWorkflow = readFileSync(resolve('.github/workflows/release-reconcile.yml'), 'utf8').replace(/\r\n/g, '\n');

describe('publish site workflow structure', () => {
    it('shares the first-in-first-out release lane so it can neither land inside a release nor displace one', () => {
        // GitHub documents no outcome for group members that disagree on
        // queue, so every workflow in the lane declares the same one.
        const lane = /group: [^\n]*extension-release-production[^\n]*\s*\n\s+cancel-in-progress: false\s*\n\s+queue: max\n/;
        for (const [name, text] of Object.entries({workflow, releaseWorkflow, reconcileWorkflow})) {
            expect(text, name).toMatch(lane);
        }
    });

    it('takes no dispatch inputs, so the only thing it can publish is the master tip', () => {
        expect(workflow).toContain('  workflow_dispatch:\n');
        expect(workflow).not.toContain('inputs');
        expect(workflow).toContain('ref: master');
    });

    it('holds no secret beyond the scoped token and never persists it in the checkout', () => {
        expect(workflow).toMatch(/permissions:\s*\n\s+contents: write\s*\n/);
        expect(workflow).not.toContain('secrets.');
        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).toContain('RELEASE_GITHUB_TOKEN: ${{ github.token }}');
        expect(workflow).toContain('RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}');
    });

    it('runs only the site command of the release helper', () => {
        expect([...workflow.matchAll(/run: (.+)/g)].map(match => match[1]))
            .toEqual(['node .github/release/cli.mjs publish-site']);
    });

    it('needs nothing installed, because everything the helper loads is a Node built-in', () => {
        // Every static, re-exported, side-effect, and dynamic import, followed
        // through each relative module the helper reaches.
        const specifiersIn = text => [...text
            .replace(/\r\n/g, '\n')
            .matchAll(/(?:^import\s+|^(?:import|export)\b[^;'"]*?\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/gm)]
            .map(match => match[1]);
        const importsOf = file => specifiersIn(readFileSync(resolve('.github/release', file), 'utf8'));
        const reached = new Set(['cli.mjs']);
        const packages = [];
        for (const file of reached) {
            for (const specifier of importsOf(file)) {
                if (specifier.startsWith('./')) {
                    reached.add(specifier.slice(2));
                } else if (!specifier.startsWith('node:')) {
                    packages.push(`${file}: ${specifier}`);
                }
            }
        }
        expect([...reached].sort()).toEqual(['cli.mjs', 'git-release.mjs', 'operations.mjs', 'policy.mjs', 'result.mjs']);
        expect(packages).toEqual([]);
        // No release module imports a package, so prove the scan would see one.
        expect(specifiersIn([
            "import jwt from 'jsonwebtoken';",
            "import 'side-effect';",
            "export {x} from 'reexported';",
            "import {\n    y,\n} from 'multi-line';",
            "const z = await import('dynamic');",
        ].join('\n'))).toEqual(['jsonwebtoken', 'side-effect', 'reexported', 'multi-line', 'dynamic']);
        expect(workflow).not.toMatch(/npm (?:ci|install)/);
    });

    it('is accepted only as the allowlisted master workflow definition', () => {
        const context = {
            repository: 'absdjfh/dawnhub-advertiser-extension',
            ref: 'refs/heads/master',
            workflowRef: `absdjfh/dawnhub-advertiser-extension/${SITE_WORKFLOW_FILE}@refs/heads/master`,
        };
        expect(validateWorkflowContext(context, SITE_WORKFLOW_FILE)).toBeTruthy();
        expect(() => validateWorkflowContext({...context, ref: 'refs/heads/feature'}, SITE_WORKFLOW_FILE)).toThrow();
        expect(() => validateWorkflowContext(context)).toThrow();
    });
});
