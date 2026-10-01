# Dawnhub Advertiser Tools

A Chrome extension that adds tools for advertisers to the Dawnhub website. Currently:

- **Fill booking from a DM** - paste a buyer's DM (Discord, Battle.net, an in-game whisper...), as a screenshot or the copied text, and it picks the raid,
  reads the buyer's Name-Realm and any price mentioned, and fills in the booking to check and submit. Screenshots are
  read by a bundled OCR engine (Tesseract) and messages by Chrome's built-in AI, both on the user's device.
- **Find a buyer** - search the raids in the dates being viewed for a character's bookings.
- **Raids with slots available** - hide every raid that's already full.
- **Raid time links** - open a raid in a new tab from its time.
- **Late starts** - show a raid's likely start when its leader's raid before it is still open past its start or locked late.

- Website, user guide and privacy policy: https://dawn-adv-tools.rolich.net (source in [`hosted/`](hosted))
- [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Release workflow](docs/release-workflow.md)

The extension uses https://wxt.dev/ and is structured as described in
https://wxt.dev/guide/essentials/project-structure.html. Make sure you have Node.js installed.

## How to build
1. Run `npm install`
2. Run `npm run build`, or `npm run zip` for a package. The result is in `.output`.

Chrome is the only target: the Prompt API this extension exists for is Chrome-only.

## How to run in development mode
1. Run `npm install`
2. Run `npm run dev`
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `.output/chrome-mv3-dev`.

To try the AI part, Chrome's built-in AI has to be available on your machine - check `chrome://on-device-internals`,
or click the extension's toolbar icon, which shows the model's status and can start its download.

## How to run tests
- `npm test` runs every test, including the release scripts'
- `npm run coverage` writes a coverage report to `.output/coverage`

## How to publish
1. Merge the approved change into `master`.
2. Run the [Release](https://github.com/absdjfh/dawnhub-advertiser-extension/actions/workflows/release.yml) GitHub
   action on `master` and set `dryRun` to `false`.

```bash
gh workflow run release.yml --ref master -f dryRun=false
```

To publish only the website (e.g. a user guide fix) without a release, run the
[Publish site](https://github.com/absdjfh/dawnhub-advertiser-extension/actions/workflows/publish-site.yml) action on
`master`. It puts the `master` tip's `hosted/` site files live and leaves every download as the last release left it; see
[Publishing only the site](docs/release-workflow.md#publishing-only-the-site).

There is no version to choose: every release is `<two-digit year>.<month>.<release number within that month>`. The
first release needs a one-time setup (Chrome Web Store item, repository secrets, Cloudflare Pages) - see
[One-time setup](docs/release-workflow.md#one-time-setup).
