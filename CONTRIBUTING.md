# Contributing

This extension adds tools for advertisers to the Dawnhub website, and is meant to keep growing one feature at a time.
Start in the feature folder that owns the behavior you are changing. Only change the content
script's startup code when a feature must react to a browser or navigation event, and only change `host/` selectors
when Dawn's page markup has changed.

Start with [the architecture guide](docs/architecture.md), then run:

```sh
npm install
npm test
npm run lint
npm run compile
```

The release scripts in `.github/release` use only Node built-ins; test them with `npm run test:release`.

## Adding or changing a feature

1. Find the owning feature under `components/` (`booking-intent`, `ui`, or `api`), or give a new feature its own
   folder. The [architecture guide](docs/architecture.md#adding-a-feature) lists everywhere a new feature shows up.
2. Put Dawn page selectors and DOM traversal in `host/`, not in matching or UI code.
3. Use Vue for extension-owned popups, panels, and the toolbar popup. Keep the small adapter that mounts them into the
   host page imperative.
4. Add a test that describes what a user can do or see. Prefer the saved host-page fixture in
   `host/__tests__/fixtures` when the feature depends on Dawn markup.
5. Run lint, compile, and the full test suite before submitting.

## Things to keep in mind

- **Only Dawnhub, nothing else.** The extension talks to Dawnhub alone, and anything a user pastes into it is
  processed on the device. Bundle what a feature needs (like the OCR engine in `public/tesseract`) rather than load it
  from a CDN, and update the privacy policy in `hosted/privacy.html` whenever what the extension reads, stores, or
  sends changes.
- **Never act for the advertiser.** Tools fill things in and save clicks; submitting a form or changing anything on
  Dawnhub is always the advertiser's click.
- **Keep to your own namespace.** Prefix every class, attribute, and storage key with `dat-` /
  `dawnhubAdvertiserTools:`, so nothing collides with Dawnhub's own page or with other extensions injecting into it.
