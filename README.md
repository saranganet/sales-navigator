# Sales Navigator Scraper

A locally installable Chrome Extension (Manifest V3) that extracts structured data from Sales Navigator search-result pages that the already-authenticated user is authorized to access.

## Compliance boundary

This MVP reads only information rendered in the active Sales Navigator interface. It does not log in, bypass authentication, solve CAPTCHA, defeat rate limits, access hidden/private APIs, remove paywalls, or circumvent access restrictions. When a restriction/challenge pattern is detected, the job stops and the UI reports it.

Chrome's extension platform supports MV3, `chrome.storage`, `chrome.downloads`, and content scripts for this architecture. See the official Chrome extension documentation for current API details. 

## Architecture

```text
sales-navigator-scraper/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   ├── content.js          # scraper controller/state machine
│   ├── extractor.js        # card discovery + field extraction
│   ├── paginator.js        # pagination + SPA page-change detection
│   ├── page-detector.js    # supported page + access restriction detection
│   └── selectors.js        # replaceable selector configuration
├── background/
│   └── service-worker.js   # persistence relay + tab lifecycle handling
├── utils/
│   ├── storage.js
│   ├── csv-export.js
│   ├── json-export.js
│   └── helpers.js
├── assets/icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    ├── fixtures/sales-nav-fixture.html
    └── harness.html
```

## Implementation stages

### Stage 1 — Page detection + result-card detection

Implemented:
- Sales Navigator route detection (`/sales/...` on LinkedIn).
- Access-restriction keyword detection.
- Layered result-card discovery using semantic attributes, profile links, repeated list-like containers, and scoring.
- Debug output for detected card count and page state.

Test:
1. Open a Sales Navigator search-result page.
2. Open the extension.
3. Confirm `Sales Navigator detected ✓`.
4. Confirm `Records on page` is non-zero.
5. Click **Inspect / Debug** and review `resultCards`, `sampleRecords`, and `nextButtonFound`.

### Stage 2 — Data extraction

Implemented:
- Full name and first/last split.
- Job title/headline.
- Company name.
- Company domain: extracted directly from DOM external website links, data attributes, and outbound redirects.
- Location.
- Profile URL normalization: automatically converts internal Sales Navigator URLs (`/sales/lead/` or `/sales/people/`) into the person's actual public LinkedIn profile URL (`https://www.linkedin.com/in/...`).
- Connection degree.
- Industry when visibly available.
- Per-record `scrapedAt` timestamp.
- Missing fields become empty strings.

The current DOM cannot be guaranteed without inspecting a live Sales Navigator account. The extractor therefore does **not** claim fixed LinkedIn CSS classes are authoritative. `content/selectors.js` is the maintenance point.

### Stage 3 — CSV / JSON export

Implemented:
- CSV header order requested by the specification.
- UTF-8 BOM for spreadsheet compatibility.
- Correct CSV quoting/escaping for commas, quotes, and line breaks.
- JSON array export.
- Date-based filenames such as `sales_navigator_export_2026-09-12.csv`.

Test:
- Use fixture data containing commas, Unicode names, and quoted values; inspect the exported file in Excel/Google Sheets and a text editor.

### Stage 4 — Pagination

Implemented:
- Current page detection using accessibility/current-state markers and URL fallback.
- Next button discovery using semantic attributes and visible text.
- No navigation beyond requested page count.
- Stop when Next is missing/disabled.
- SPA-aware page-change confirmation using page signatures and result-card appearance.

### Stage 5 — Multi-page scraper controller

Implemented as a state machine with:
`idle → running → extracting → pagination → navigating/waiting → completed`
plus `paused`, `stopped`, and `error` outcomes.

The controller verifies that the page state changes before treating the next page as loaded. Waiting uses `MutationObserver` plus a bounded polling fallback rather than relying on one fixed delay.

### Stage 6 — Progress UI + persistent state

Implemented:
- ON/OFF toggle.
- Start / Stop / Pause / Resume.
- Page progress.
- Records collected, duplicates, and unique records.
- Persistent records/state in `chrome.storage.local`.
- Closing the popup does not intentionally stop the running content-script controller.

### Stage 7 — Errors and edge cases

Implemented messages for:
- unsupported page
- no results
- unavailable/disabled pagination
- failure to confirm page load
- user navigation away from Sales Navigator
- restriction/challenge detection
- unexpected result structure
- extension turned off


## Page range scraping

The popup now accepts a **From page** and **To page** instead of only a page count. For example, entering **20** and **40** scrapes pages 20 through 40 inclusive (21 pages).

If the user is currently on another page, the scraper uses the visible Sales Navigator pagination controls to move to the requested start page before extracting anything. It can move forward or backward when the corresponding previous/next control is available.

Pages are counted only after they are actually extracted. With the fixed 25-record MVP rule, each page contributes at most 25 records; a page with fewer than 25 detected records is treated as the final available page and the job stops.

The scraper does not jump directly to a guessed URL parameter because Sales Navigator is a dynamic application and URL formats may change.

## Selector inspection / maintenance

Because Sales Navigator is a dynamic web application and its DOM may change, treat `selectors.js` as a configuration layer, not a guarantee.

When extraction breaks:

1. Open a Sales Navigator results page.
2. Open DevTools → Console.
3. Open the extension → **Inspect / Debug**.
4. Review the returned `sampleRecords`, `resultCards`, and `pageSignature`.
5. Inspect one visible result card in DevTools.
6. Look for stable attributes such as `aria-label`, `data-testid`, `data-*`, semantic elements, or stable parent/child relationships.
7. Update `content/selectors.js` and/or the focused extractor function rather than rewriting the controller.

Do not add private API calls or request interception to make extraction work.

## Debug mode

The popup exposes **Inspect / Debug**. Runtime logging is controlled by `chrome.storage.local.debug`.

To enable verbose logs manually:

```js
chrome.storage.local.set({ debug: true });
```

Then open the Sales Navigator page DevTools Console and look for messages prefixed with `[Scraper]`.

## Install locally

1. Unzip or copy this project to a folder.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the project folder.
7. Open LinkedIn Sales Navigator and run a filtered search.
8. Open the extension.
9. Start with **1 page**.
10. Export CSV.
11. Verify the CSV contents.
12. Test again with multiple pages.

## Testing checklist

- [ ] One page
- [ ] Five pages
- [ ] Multiple pages with duplicates
- [ ] No results
- [ ] Missing fields
- [ ] Duplicate profiles by URL
- [ ] Duplicate fallback by name + company
- [ ] Last available page
- [ ] Requested page count exceeds available pages
- [ ] Stop during scraping
- [ ] Pause / Resume
- [ ] Close popup while scraping
- [ ] Navigate away from Sales Navigator
- [ ] Slow result loading
- [ ] Dynamic DOM replacement
- [ ] CSV values containing commas
- [ ] CSV values containing quotes
- [ ] CSV Unicode values
- [ ] JSON export
- [ ] Access restriction / CAPTCHA message
- [ ] Selector inspection debug output

## Fixture testing

`tests/fixtures/sales-nav-fixture.html` is a simple local page that mimics the semantic signals used by the extractor. It is useful for regression testing selector logic without interacting with LinkedIn.

`tests/harness.html` provides a browser fixture harness. For more advanced automated tests, the same modules can be loaded into a test runner later without changing the extension architecture.

## Known limitations of this MVP

1. The live Sales Navigator DOM was not assumed to be stable or guaranteed. The first launch may require small selector tuning after you inspect your specific UI.
2. Restriction detection is intentionally conservative and text-based. A new challenge message may need to be added to `page-detector.js`.
3. The extractor is designed for visible result-card data; it does not open private APIs or hidden profile endpoints.
4. Browser tab/page behavior can vary with LinkedIn SPA changes. The debug dump is intended to make those changes diagnosable.


### Fixed records-per-page behavior
The MVP treats Sales Navigator search pages as 25-record pages. The extractor takes at most the first 25 detected result cards from each page. If the current page contains fewer than 25 detected result cards, the scraper treats that page as the final available page and stops automatically. This avoids trying to paginate past a partial final page.
