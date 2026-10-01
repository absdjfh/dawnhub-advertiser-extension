# Extension release workflow

The `Release` GitHub Actions workflow is the only automated production release path. It is bound to an exact approved commit at the current `origin/master` tip and uses one fixed verification/packaging profile. It ships the one browser this extension supports: Chrome.

## Manual dispatch

1. Confirm the approved change is merged into `master`.
2. Open the repository's **Release** workflow and select **Run workflow** on `master`.
3. Set `dryRun` to `false`. Leave both **Advanced** fields blank.

That is the whole manual path — there is no version to pick. The equivalent from a terminal is:

```bash
gh workflow run release.yml --ref master -f dryRun=false
```

`dryRun` defaults to `true` so that a mis-click cannot publish, not to prescribe a rehearsal pass before every release. Run one when you want the checks without the consequences; see [Dry run](#dry-run) for exactly what it does and does not do.

### The two advanced inputs

`sourceSha` and `releaseIntentId` exist for a bot dispatch, which derives both from an approved pull request. A blank value is resolved in a dedicated `resolve-inputs` step that runs before any validation, so every later step still receives a fully explicit interface:

| Input | Blank resolves to | Provenance recorded as |
| --- | --- | --- |
| `sourceSha` | the current `origin/master` tip | `sourceShaOrigin: origin-master-tip` |
| `releaseIntentId` | `run-<this workflow run ID>` | `releaseIntentIdOrigin: workflow-run` |

Resolution never relaxes a check. It only trims surrounding whitespace and lowercases a pasted SHA; a supplied value must still be exactly 40 lowercase hexadecimal characters, and a supplied intent ID must still be 1-64 lowercase letters/digits separated by single hyphens.

A resolved `sourceSha` is not treated as an approval. Source validation still fetches `origin/master` independently and requires the resolved SHA to equal the tip, so a branch that moves between resolution and validation fails closed. Supplying the SHA explicitly is therefore only useful to *abort* when `master` has moved since you last looked; it can never publish an older commit.

GitHub keeps the run ID stable across re-runs of the same dispatch, so a pre-boundary retry reuses its intent and is safe, while a post-boundary retry is refused by the accepted marker rather than publishing a second release under a fresh ID.

## Fixed policy

Every run performs the following from the disposable exact-SHA checkout:

```sh
npm ci
npm audit --omit=dev
npm run lint
npm run compile
npm run test -- --run
npm run build
npm run zip
```

The release scripts use only Node built-ins, so they have no dependencies of their own. Callers cannot disable a check or skip the Chrome package.

There are no Firefox targets, so there is nothing to sign on AMO and no XPI or `updates.json` feed to host. The extension is Chrome-only because its features are free to use Chrome's built-in AI (the Prompt API), which Firefox doesn't have.

## Versions

Versions are read off the calendar rather than chosen: `<two-digit year>.<month>.<release number within that month>`, so `26.10.1` is October 2026's first release and `26.10.2` its second. The day is resolved once, from the run's own UTC clock, and is then explicit for the rest of the run as `releaseDate`.

The increment is taken from the checked-out `package.json`: the same year and month means the next number, any earlier month means `1` (the repository starts at `0.0.0`, so the first release is the month's `.1`). A checkout whose version is *ahead* of the release day fails closed with `VERSION_NOT_ASCENDING`. There is no way to release the current version again.

## Source validation and guarded writes

Before dependency installation or release-side effects, the helper:

1. requires the run repository and workflow definition to be the allowlisted `.github/workflows/release.yml` dispatched from `refs/heads/master` (`RELEASE_REPOSITORY` in `.github/release/policy.mjs`);
2. fetches full history, tags, and the fixed `refs/heads/master` ref;
3. requires `sourceSha` to identify a commit in this repository, in `origin/master` history, equal to the fetched tip;
4. checks out that commit detached and requires `HEAD` to equal it;
5. rejects an existing intent marker, another accepted intent for the same source, or an existing proposed version tag.

Immediately before each Git write, the helper reads the remote ref again. The version push uses an exact `refs/heads/master:<approved source SHA>` force-with-lease guard, and the hosted-files push leases against the SHA the `hosted` branch had when it was seeded. A moved branch fails closed and is never overwritten.

The workflow declares only `contents: write`. Chrome Web Store secrets are exposed only to their production-only steps. Checkout does not persist Git credentials.

## Hosted files and retention

Cloudflare serves the public site from the orphan `hosted` branch, not from `master`. The branch holds only `hosted/`: the site pages, `releases.json`, and the Chrome `.zip` packages. Binaries are never committed to `master`.

In a production run:

1. `seed-hosted` (after the store submission) restores the generated files (`*.zip`, `releases.json`) from the branch tip into `hosted/`, dropping `master`'s copies. Site files stay as `master` has them, so site edits on `master` go live with the next release, or sooner with [Publish site](#publishing-only-the-site). If the branch does not exist yet, the checkout's own `hosted/` bootstraps it.
2. `publish-hosted-release.mjs` copies the new `.zip`, updates `releases.json` (current download, previous versions, release notes), and prunes old packages.
3. `commit-hosted` builds a tree from `hosted/` in a throwaway index and pushes it as a single parentless commit, force-with-lease against the recorded tip. Pruned binaries leave the branch history, so it never grows.

`HOSTED_RETAINED_VERSIONS = 5` (`.github/release/hosted-retention.mjs`) keeps the current package plus the four before it. Release notes keep a longer text-only history.

### Publishing only the site

To put site edits (the guide, landing page, privacy policy, styles) live without a release, run the **Publish site** workflow (`.github/workflows/publish-site.yml`, `SITE_WORKFLOW_FILE`) on `master`. It has no inputs:

```bash
gh workflow run publish-site.yml --ref master
```

It checks out the `origin/master` tip, runs the same seed as a release, and then `publish-site` pushes `hosted/` as one parentless commit, `Publish site from <master SHA>`, with the same exact lease. There is no version, tag, intent marker, or store submission, and it installs nothing because the helper needs only Node built-ins. The job summary lists every site file it added, changed, or deleted.

- **Downloads are untouched.** Every `.zip` package and `releases.json` comes from the branch byte-exact, and a tree that would still change one of them is refused (`SITE_CHANGES_DOWNLOADS`). Only a release changes what users download.
- **A current site is a no-op.** If the tree equals the branch tip's, nothing is pushed, so Cloudflare does not redeploy.
- **It never creates the branch.** Without an existing `hosted` branch it stops (`HOSTED_BRANCH_MISSING`); the first release bootstraps it.
- **It queues behind releases.** It shares the non-cancelling `extension-release-production` concurrency group, because a release seeds the branch before it pushes it and a site push in between would make that release's leased push fail.
- **A later hosted reconcile undoes it.** Reconciling an earlier release's `hostedCommit` republishes the site files of that release's version commit. Run Publish site again afterwards.
- **It publishes the tip as is.** A guide page on `master` that describes an unreleased feature goes live before the extension that has it.

## Dry run

`dryRun=true` is a no-write rehearsal. It validates the input/source/intent, applies the proposed version only in the disposable checkout, runs the fixed audit/check/build/package policy, and emits a result JSON artifact plus a job summary.

It does not create a commit or tag, push Git refs, create an intent marker, submit to the Chrome Web Store, require store credentials, or generate/commit/push hosted files. The release-policy tests execute this plan through a fake command runner; workflow-structure tests independently require every production step to have a `dryRun == false` guard.

## Concurrency, intent markers, and the irreversible boundary

All production runs — releases, reconciliations, and site publications — share the `extension-release-production` concurrency group with `cancel-in-progress: false`; dry runs use run-scoped groups and cannot block production.

The durable idempotency marker is an annotated tag named `release-intent/<releaseIntentId>`. Its JSON message records the intent, approved source, release date, original/resulting version, version commit/tag, and workflow run. Markers are discoverable with:

```sh
git fetch origin --tags
git for-each-ref --format='%(refname:short) %(contents:subject)' refs/tags/release-intent/
```

The exact irreversible boundary is one atomic push containing all three of: the version commit updating `master` from the exact approved SHA, the immutable `v<version>` tag, and the immutable `release-intent/<id>` marker. All verification, local packaging, and the non-submitting credential check happen before that push. A failure before it creates none of the three refs and is safely retryable; once it lands, the workflow blocks repeat publication even if a later component's status is ambiguous.

## Partial failure and reconciliation

Before the atomic boundary, fix the reported problem. If remote `master` still equals the approved source and neither the version nor intent tag exists, rerunning the same intent is safe.

At or after the boundary, never blindly rerun or create a replacement intent. Instead:

1. Find the run by `releaseIntentId` in the run name, and download its `release-result-<run ID>` artifact when available.
2. Fetch and inspect `release-intent/<id>`, `v<version>`, and `origin/master`.
3. Check the Chrome Web Store Developer Dashboard for the version, and the `hosted` branch and site for every `ambiguous`, `failure`, or `skipped_dependency` component.
4. Treat missing result metadata from a cancelled or timed-out run as ambiguous if the intent marker exists.

Then dispatch `.github/workflows/release-reconcile.yml` with the accepted `releaseIntentId` and one explicit choice per post-boundary component:

- Chrome submission: `already-succeeded` or `not-attempted`.
- Hosted generation and hosted commit: `already-generated`/`already-committed` or `generate-now`/`commit-now`.

Every input defaults to `unspecified` and the job refuses to run with any component left on that default. It reads the source, version, and intent straight off the accepted marker, checks out that exact version commit, and shares the production concurrency lane. There is deliberately no "resubmit if unsure" option for the store submission: a wrong guess there is the one mistake this workflow cannot undo.

## Result metadata

The workflow always attempts to write `.output/release-result.json`, upload it as `release-result-<run ID>`, and render the same component table in the job summary: schema version, intent and its origin, approved source and its origin, release date, versions, commit/tag/marker, run identity, per-component statuses with bounded, redacted summaries, and an overall `success`, `failure`, or `ambiguous` status.

## One-time setup

Everything below is done once, by hand, before the first production release.

### Chrome Web Store listing

The store API can only update an item that already exists, and a new item needs its listing filled in by hand:

1. Build a package locally with `npm ci && npm run zip` (the version in it doesn't matter).
2. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), add a new item and upload that ZIP.
3. Fill in the listing (description, screenshots, category), set **Visibility** to *Public*, and on **Privacy** give the single purpose, justify the `storage` and host permissions, declare the data handling described on the site's privacy policy, and enter `https://dawn-adv-tools.rolich.net/privacy.html` as the privacy policy URL — which has to be live first (see below).
4. Submit it for review. Every later version comes from the Release workflow.
5. Put the item's URL into `chromeStoreUrl` in `hosted/index.js` so the downloads page links to it.

### Repository secrets

| Secret | Used for |
| --- | --- |
| `CHROME_EXTENSION_ID` | The new item's ID from the Developer Dashboard. |
| `CHROME_PUBLISHER_ID` | The publisher ID of the developer account. |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | The service account the Chrome Web Store API v2 publishes with. It is linked to the publisher account, not to one item. |

### Hosted site

The privacy policy has to be reachable before the store listing is submitted, so publish the site once by hand — the first production release then takes the branch over:

```sh
git fetch origin master
git worktree add --detach ../hosted-seed origin/master
cd ../hosted-seed
git checkout --orphan hosted
git rm -r -q --cached .
git add hosted
git commit -m "Bootstrap hosted branch"
git push origin hosted
cd - && git worktree remove --force ../hosted-seed
```

Then create a Cloudflare Pages project connected to this repository with production branch `hosted`, no build command, build output directory `hosted`, and the custom domain `dawn-adv-tools.rolich.net`.

The commands above would replace an existing branch wholesale, including the packages and `releases.json` only the release keeps, so they are for the bootstrap only. Once the branch exists, a site-only change goes live through [Publish site](#publishing-only-the-site).
