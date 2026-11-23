# Architecture

## Purpose

Dawnhub Advertiser Tools is a Chrome extension that adds tools for advertisers to the Dawnhub website. Each tool is
a feature of its own on top of a small shared layer: knowing which Dawnhub page is open, which raids it shows, and how
to add UI to it. The external website, browser APIs, and feature rules are kept in separate areas so a change can be
understood without reading the whole extension.

```text
Browser + WXT lifecycle
        |
        v
entrypoints/  ---- content script (one integration per page area) and the toolbar popup
        |
        v
host/         ---- the Dawnhub page contract: selectors, table rows, the page's own raids requests
        |
        v
components/   ---- features (ui/*), the Dawnhub API client, game data
        |
        v
utils/        ---- generic formatting, time, timers, DOM controls, toasts
```

## Main areas

| Area | Responsibility | Start here when... |
| --- | --- | --- |
| `entrypoints/content/` | Mounting features into a loaded Dawn page, and taking them off again | a feature should start, stop, or react to navigation |
| `entrypoints/popup/` | The toolbar popup: the list of tools and guide links | changing first-run guidance |
| `host/` | The Dawn page contract: selectors, table rows, the raids-list request | Dawn changes its markup or API |
| `components/<feature>/`, `components/ui/` | Each feature's rules and UI | adding or changing a feature |
| `components/api/` | Dawnhub requests | loading more Dawnhub data |
| `hosted/` | The public website: home, user guide, privacy policy, downloads | documentation or policy changes |

## Shared plumbing

- **Page integrations** (`entrypoints/content/integrations/`) own one area of the page each: the toolbar slot and the
  raids table. Each returns an `Integration` whose `stop()` takes
  everything it added back off the page, which the content script calls when the extension is updated or removed.
  A new feature usually plugs into an existing integration (a toolbar button, a row decoration) rather than adding
  its own.
- **The raids on screen** come from `host/dawnhub-raids-request.ts`, which watches the page's own resource timing
  entries for Dawnhub's `/api/raids?...` requests and reloads the same list (with `&ext` appended, so it is never
  mistaken for Dawnhub's own). The table's rows are numbered by their position in exactly that response, so the
  extension reuses Dawnhub's query rather than building one - with neither the `webRequest` permission nor a
  background script. `entrypoints/content/integrations/raids-table.ts` keeps that list in memory for the row-level features.
- **Namespacing:** every class, attribute, and storage key is prefixed `dat-` / `dawnhubAdvertiserTools:`.

## Features

| Feature | Where | Notes |
| --- | --- | --- |
| Find a buyer | `components/ui/BookingSearch.vue` | Loads the raids in the page's own date filters, with their bookings |
| Raids with slots available | `components/ui/open-slots-filter.ts` | Hides rows in place, so row numbering stays intact |
| Raid time links | `components/ui/raid-link.ts` | Mirrors Dawnhub's cell content into a link instead of moving it |
| Late starts | `utils/raid-delays.ts`, `components/ui/raid-delay.ts` | Times a lock from Dawnhub's own refreshes of the list, halfway between the two that showed the change; locks are kept in extension storage for a day, so every Dawnhub tab goes by the same ones |

## Adding a feature

1. Put Dawn selectors and page lookups in `host/`, with a fixture-backed test.
2. Put the feature's rules in `components/<feature>/` and its UI in `components/ui/`.
3. Hook it into the integration that owns that part of the page, and make sure `stop()` takes it back off.
4. Add it to the tool list in `components/ui/ExtensionPopup.vue`, to the website (`hosted/index.html` and a section of
   `hosted/guide.html`), and to the privacy policy if it reads, stores, or sends anything new.

## Host-page contract

The Dawnhub page is not controlled by this repository. All assumptions about its DOM and requests live in `host/` and
are covered by a realistic HTML fixture.

## Testing

Tests describe user outcomes, such as finding a buyer or filtering the raids list. Content script tests
(`entrypoints/content/__tests__`) use the saved Dawnhub fixture with the page's raids-list requests stubbed. Vue components are mounted with `mountVue` from
`utils/__tests__/support/mount-vue.ts`; drive them the way a user would and check what they would see.
