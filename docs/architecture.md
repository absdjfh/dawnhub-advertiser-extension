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
host/         ---- the Dawnhub page contract: selectors, table rows, the booking form, the page's own raids requests
        |
        v
components/   ---- features (booking-intent, ui/*), the Dawnhub API client, game data
        |
        v
utils/        ---- generic formatting, time, timers, DOM controls, toasts
```

## Main areas

| Area | Responsibility | Start here when... |
| --- | --- | --- |
| `entrypoints/content/` | Mounting features into a loaded Dawn page, and taking them off again | a feature should start, stop, or react to navigation |
| `entrypoints/popup/` | The toolbar popup: the list of tools, and status a tool needs to show (e.g. on-device AI) | changing first-run guidance |
| `host/` | The Dawn page contract: selectors, table rows, form fields, the raids-list request | Dawn changes its markup or API |
| `components/<feature>/`, `components/ui/` | Each feature's rules and UI | adding or changing a feature |
| `components/api/` | Dawnhub requests | loading more Dawnhub data |
| `hosted/` | The public website: home, user guide, privacy policy, downloads | documentation or policy changes |

## Shared plumbing

- **Page integrations** (`entrypoints/content/integrations/`) own one area of the page each: the toolbar slot, the
  raids table, the booking form, the page-wide paste listener. Each returns an `Integration` whose `stop()` takes
  everything it added back off the page, which the content script calls when the extension is updated or removed.
  A new feature usually plugs into an existing integration (a toolbar button, a row decoration) rather than adding
  its own.
- **The raids on screen** come from `host/dawnhub-raids-request.ts`, which watches the page's own resource timing
  entries for Dawnhub's `/api/raids?...` requests and reloads the same list (with `&ext` appended, so it is never
  mistaken for Dawnhub's own). The table's rows are numbered by their position in exactly that response, so the
  extension reuses Dawnhub's query rather than building one - with neither the `webRequest` permission nor a
  background script. `entrypoints/content/integrations/raids-table.ts` keeps that list for every row-level feature,
  and the last list's URL is kept in the tab's `sessionStorage` for features used on a raid's own page.
- **Namespacing:** every class, attribute, and storage key is prefixed `dat-` / `dawnhubAdvertiserTools:`.

## Features

| Feature | Where | Notes |
| --- | --- | --- |
| Fill booking from a DM | `components/booking-intent/`, `components/ui/BookingIntentPanel.vue`, `booking-intent-panel.ts` | See below |
| Find a buyer | `components/ui/BookingSearch.vue` | Loads the raids in the page's own date filters, with their bookings |
| Raids with slots available | `components/ui/open-slots-filter.ts` | Hides rows in place, so row numbering stays intact |
| Raid time links | `components/ui/raid-link.ts` | Mirrors Dawnhub's cell content into a link instead of moving it |

### Fill booking from a DM

1. A pasted image, or a click on **Fill booking from DM**, opens the panel (`components/ui/booking-intent-panel.ts`)
   with the raids on screen that still take a buyer, narrowed to those starting within three hours when any do. The
   panel holds a list of bookings (`components/ui/booking-intent/`), since one DM regularly asks for several.
2. `components/booking-intent/booking-intent.ts` turns a screenshot into text with Tesseract (bundled in
   `public/tesseract`), then asks Chrome's on-device model to read plain facts from the text (time, raid name,
   difficulty, loot, class/armor type, price, curve boss, Name-Realm) against a constrained JSON schema - one entry
   per character the DM asks to book. It never asks the model to choose the raid: the extension scores the open
   raids against each entry's facts itself, with the weights in `BOOKING_INTENT_SCORING`.
3. **Open & fill** asks the background script (`entrypoints/background.ts`, `pending-booking.ts`) to open the raid
   in a new tab and keep the booking's fields in the extension's session storage under that tab's id - only the
   caller of `tabs.create` learns it. `entrypoints/content/integrations/booking-form.ts` asks for them once the
   booking form appears, and `components/booking-intent/booking-form.ts` fills Name-Realm, Pot and the curve boss,
   then clicks Dawnhub's own character search. Nothing is ever submitted.

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

Tests describe user outcomes, such as reading a pasted DM, filtering the raids list, or filling the booking form. The
content script is also tested end to end (`entrypoints/content/__tests__`) against the saved Dawnhub fixture with the
page's requests and the Prompt API stubbed. Vue components are mounted with `mountVue` from
`utils/__tests__/support/mount-vue.ts`; drive them the way a user would and check what they would see.
