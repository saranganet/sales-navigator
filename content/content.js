(() => {
  const SNScraper = (window.SNScraper = window.SNScraper || {});

  const runtime = {
    status: 'idle',
    fromPage: 1,
    toPage: 1,
    targetPages: 1,
    currentPage: 1,
    records: [],
    duplicatesRemoved: 0,
    pagesScraped: 0,
    startedAt: null,
    completedAt: null,
    error: null,
    reason: null,
    pageSignature: null,
    debug: false,
    enabled: true,
    recordsOnCurrentPage: 0,
    pagesAvailable: null,
    tabId: null
  };

  const log = (...args) => { if (runtime.debug) console.log('[Scraper]', ...args); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  SNScraper.sleep = sleep;

  function mergePageRecordsInto(targetMap, records) {
    for (const record of records) {
      const url = String(record.profileUrl || '').trim().toLowerCase();
      const key = url
        ? `url:${url}`
        : `fallback:${String(record.fullName || '').trim().toLowerCase()}|${String(record.companyName || '').trim().toLowerCase()}`;
      if (!targetMap.has(key)) targetMap.set(key, record);
    }
  }

  async function waitForResultListSettled(stableMs = 1000, timeoutMs = 8000) {
    const started = Date.now();
    let lastSignature = '';
    let stableSince = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (SNScraper.pageDetector.detectRestriction()) return false;
      const records = SNScraper.extractor.getRecords(25);
      const signature = records.map(r => r.profileUrl || `${r.fullName}|${r.companyName}`).join('|');
      if (signature && signature === lastSignature) {
        if (Date.now() - stableSince >= stableMs) return true;
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }
      await sleep(250);
    }
    return true;
  }
  SNScraper.waitForResultListSettled = waitForResultListSettled;

  async function loadSettings() {
    const data = await chrome.storage.local.get(['enabled', 'debug', 'state', 'records']);
    runtime.enabled = data.enabled !== false;
    runtime.debug = data.debug === true;
    if (data.state) {
      runtime.fromPage = Number(data.state.fromPage || 1);
      runtime.toPage = Number(data.state.toPage || data.state.targetPages || runtime.fromPage);
      runtime.targetPages = Math.max(1, runtime.toPage - runtime.fromPage + 1);
      runtime.currentPage = Number(data.state.currentPage || runtime.currentPage);
      runtime.pagesScraped = Number(data.state.pagesScraped || 0);
      runtime.duplicatesRemoved = Number(data.state.duplicatesRemoved || 0);
      runtime.recordsOnCurrentPage = Number(data.state.recordsOnCurrentPage || 0);
      runtime.reason = data.state.reason || null;
      runtime.error = data.state.error || null;
      runtime.startedAt = data.state.startedAt || null;
      runtime.completedAt = data.state.completedAt || null;
      runtime.tabId = data.state.tabId || null;
      runtime.pagesAvailable = data.state.pagesAvailable ?? null;
      if (['running', 'paused'].includes(data.state.status) && data.state.tabId == null) runtime.status = data.state.status;
    }
    if (Array.isArray(data.records) && runtime.status === 'idle') runtime.records = data.records;
  }

  async function persist() {
    const state = {
      status: runtime.status,
      fromPage: runtime.fromPage,
      toPage: runtime.toPage,
      targetPages: runtime.targetPages,
      recordsCollected: runtime.records.length + runtime.duplicatesRemoved,
      duplicatesRemoved: runtime.duplicatesRemoved,
      uniqueRecords: runtime.records.length,
      pagesScraped: runtime.pagesScraped,
      pagesAvailable: runtime.pagesAvailable,
      recordsOnCurrentPage: runtime.recordsOnCurrentPage,
      currentPage: runtime.currentPage,
      startedAt: runtime.startedAt,
      completedAt: runtime.completedAt,
      error: runtime.error,
      reason: runtime.reason,
      tabId: runtime.tabId || null,
      url: location.href
    };
    await chrome.storage.local.set({ state, records: runtime.records });
  }

  function detect() { return SNScraper.pageDetector.inspect(); }

  function recordKey(record) {
    const url = String(record.profileUrl || '').trim().toLowerCase();
    return url
      ? `url:${url}`
      : `fallback:${String(record.fullName || '').trim().toLowerCase()}|${String(record.companyName || '').trim().toLowerCase()}`;
  }

  function uniqueMerge(pageRecords) {
    const keys = new Set(runtime.records.map(recordKey));
    let duplicates = 0;
    for (const record of pageRecords) {
      const key = recordKey(record);
      if (keys.has(key)) { duplicates++; continue; }
      keys.add(key);
      runtime.records.push(record);
    }
    runtime.duplicatesRemoved += duplicates;
    return duplicates;
  }

  function findScrollableElements() {
    const candidates = [
      document.querySelector('[data-scroll-container]'),
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.querySelector('.scaffold-layout__main'),
      ...[...document.querySelectorAll('div, section, ul, ol')].slice(0, 2500)
    ].filter(Boolean);

    const seen = new Set();
    const result = [];
    for (const el of candidates) {
      if (seen.has(el) || !SNScraper.isVisible(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const isScrollable = el.scrollHeight > el.clientHeight + 80 && /auto|scroll/.test(style.overflowY || '');
      if (isScrollable) result.push(el);
    }
    return result.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)).slice(0, 5);
  }

  function scrollRoots() {
    const roots = findScrollableElements();
    if (roots.length) return roots;
    return [document.scrollingElement || document.documentElement];
  }

  function resetScrollPositions() {
    const roots = scrollRoots();
    for (const root of roots) {
      root.scrollTo({ top: 0, behavior: 'auto' });
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  SNScraper.resetScrollPositions = resetScrollPositions;

  async function scrollToLoadAllResults(timeoutMs = 30000) {
    const started = Date.now();
    const pageRecords = new Map();
    let stableRounds = 0;
    let lastHeightSignature = '';
    let reachedBottom = false;
    let rounds = 0;

    log('Scrolling result area to load all records');
    resetScrollPositions();
    await sleep(500);

    while (Date.now() - started < timeoutMs && rounds < 120) {
      rounds++;
      if (runtime.status === 'stopped') return { ok: false, reason: 'stopped' };
      if (SNScraper.pageDetector.detectRestriction()) return { ok: false, reason: 'restriction' };

      mergePageRecordsInto(pageRecords, SNScraper.extractor.getRecords(25));
      runtime.recordsOnCurrentPage = Math.min(pageRecords.size, 25);
      await persist();

      const roots = scrollRoots();
      let moved = false;
      let maxHeightSignature = '';
      for (const root of roots) {
        const max = Math.max(0, root.scrollHeight - root.clientHeight);
        maxHeightSignature += `${max}|`;
        const step = Math.max(450, Math.floor(root.clientHeight * 0.82));
        const nextTop = Math.min(max, root.scrollTop + step);
        if (nextTop > root.scrollTop + 5) moved = true;
        root.scrollTo({ top: nextTop, behavior: 'auto' });
      }

      // The browser viewport can also be relevant when the results pane is not independently scrollable.
      const scrollingElement = document.scrollingElement || document.documentElement;
      const pageMax = Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
      const pageNext = Math.min(pageMax, window.scrollY + Math.max(450, Math.floor(window.innerHeight * 0.82)));
      if (pageNext > window.scrollY + 5) {
        window.scrollTo({ top: pageNext, behavior: 'auto' });
        moved = true;
      }

      await sleep(500);
      await waitForResultListSettled(500, 2500);
      mergePageRecordsInto(pageRecords, SNScraper.extractor.getRecords(25));
      runtime.recordsOnCurrentPage = Math.min(pageRecords.size, 25);

      const atAllBottom = roots.every(root => root.scrollTop >= root.scrollHeight - root.clientHeight - 8) &&
        window.scrollY >= pageMax - 8;
      const currentHeightSignature = `${maxHeightSignature}|${pageMax}|${pageRecords.size}`;

      if (currentHeightSignature === lastHeightSignature && !moved) stableRounds += 1;
      else stableRounds = 0;
      lastHeightSignature = currentHeightSignature;

      if (atAllBottom) {
        reachedBottom = true;
        if (stableRounds >= 2) break;
      }
      if (!moved && stableRounds >= 3) break;
    }

    // Final extraction pass after the list has settled at the bottom.
    await sleep(700);
    await waitForResultListSettled(1000, 3000);
    mergePageRecordsInto(pageRecords, SNScraper.extractor.getRecords(25));

    const records = [...pageRecords.values()].slice(0, 25);
    runtime.recordsOnCurrentPage = records.length;
    log('Scroll complete. Unique records observed on page:', pageRecords.size, 'records returned:', records.length, 'reachedBottom:', reachedBottom);
    return { ok: records.length > 0, records, observedCount: pageRecords.size, reachedBottom };
  }
  SNScraper.scrollToLoadAllResults = scrollToLoadAllResults;

  async function waitForResults(timeoutMs = 15000) {
    const start = Date.now();
    return await new Promise(resolve => {
      let done = false;
      let observer;
      let poll;
      const finish = result => {
        if (done) return;
        done = true;
        observer?.disconnect();
        clearInterval(poll);
        resolve(result);
      };
      const check = () => {
        if (!runtime.enabled) return finish({ ok: false, reason: 'disabled' });
        if (SNScraper.pageDetector.detectRestriction()) return finish({ ok: false, reason: 'restriction' });
        const cards = SNScraper.extractor.findResultCards();
        if (cards.length > 0) return finish({ ok: true, cards: cards.length });
        if (Date.now() - start >= timeoutMs) finish({ ok: false, reason: 'timeout' });
      };
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      poll = setInterval(check, 400);
      check();
    });
  }

  async function waitWhilePaused() {
    while (runtime.status === 'paused') await sleep(300);
  }

  async function checkStillSupported() {
    const info = detect();
    if (info.restricted) {
      setError('Scraping stopped because an access restriction was detected.');
      return false;
    }
    if (!info.supported) {
      setError('Scraping stopped because the Sales Navigator page changed.');
      return false;
    }
    return true;
  }

  async function moveToStartPage() {
    runtime.currentPage = SNScraper.paginator.getCurrentPage() || runtime.currentPage || 1;
    if (runtime.currentPage === runtime.fromPage) return true;

    log('Moving from page', runtime.currentPage, 'to start page', runtime.fromPage);
    const result = await SNScraper.paginator.moveToPage(runtime.fromPage, 25000, Math.max(500, Math.abs(runtime.currentPage - runtime.fromPage) + 5));
    if (!result.ok) {
      if (result.reason === 'restriction') setError('Scraping stopped because an access restriction was detected.');
      else if (result.reason === 'no-next' || result.reason === 'no-previous') setError(`Unable to reach page ${runtime.fromPage}. Pagination control is unavailable.`);
      else setError(`Unable to navigate to start page ${runtime.fromPage}.`);
      return false;
    }
    runtime.currentPage = result.currentPage || runtime.fromPage;
    runtime.pageSignature = result.signature || SNScraper.paginator.pageSignature();
    return runtime.currentPage === runtime.fromPage;
  }

  async function scrapeCurrentPage() {
    const ready = await waitForResults();
    if (!ready.ok) {
      if (ready.reason === 'restriction') setError('Scraping stopped because an access restriction was detected.');
      else if (ready.reason === 'disabled') setError('Scraping stopped because the extension is OFF.');
      else setError('No search results were detected on this page.');
      return false;
    }

    const pageLoad = await scrollToLoadAllResults(30000);
    if (!pageLoad.ok) {
      if (pageLoad.reason === 'restriction') setError('Scraping stopped because an access restriction was detected.');
      else if (pageLoad.reason === 'stopped') return false;
      else setError('Unable to load the Sales Navigator result list completely.');
      return false;
    }

    const records = pageLoad.records;
    const observed = pageLoad.observedCount;
    runtime.recordsOnCurrentPage = records.length;

    if (!records.length) {
      setError('Unable to identify the Sales Navigator result structure.');
      return false;
    }

    const dupes = uniqueMerge(records);
    runtime.pagesScraped += 1;
    runtime.currentPage = SNScraper.paginator.getCurrentPage() || runtime.currentPage;
    runtime.pageSignature = SNScraper.paginator.pageSignature();
    log('Current page:', runtime.currentPage);
    log('Records observed while scrolling:', observed);
    log('Extracted:', records.length);
    log('Duplicates:', dupes);
    await persist();

    // Treat fewer than 25 observed unique records after a full bottom pass as the final page.
    if (observed < 25 && pageLoad.reachedBottom) {
      runtime.status = 'completed';
      runtime.completedAt = new Date().toISOString();
      runtime.pagesAvailable = runtime.currentPage;
      runtime.reason = `Final page detected: ${observed} unique result${observed === 1 ? '' : 's'} observed after scrolling.`;
      await persist();
      return true;
    }
    return true;
  }

  async function controller() {
    if (!runtime.enabled || runtime.status !== 'running') return;
    if (!(await checkStillSupported())) return;
    if (!(await moveToStartPage())) return;
    if (runtime.status !== 'running') return;

    while (runtime.status === 'running') {
      await waitWhilePaused();
      if (runtime.status !== 'running') return;
      if (!(await checkStillSupported())) return;

      runtime.currentPage = SNScraper.paginator.getCurrentPage() || runtime.currentPage;
      if (runtime.currentPage < runtime.fromPage) {
        if (!(await moveToStartPage())) return;
      }

      if (runtime.currentPage > runtime.toPage) {
        runtime.status = 'completed';
        runtime.completedAt = new Date().toISOString();
        runtime.reason = 'Target page range reached.';
        await persist();
        return;
      }

      if (runtime.pagesScraped >= runtime.targetPages) {
        runtime.status = 'completed';
        runtime.completedAt = new Date().toISOString();
        runtime.reason = 'Requested page range reached.';
        await persist();
        return;
      }

      const beforeScraped = runtime.pagesScraped;
      if (!(await scrapeCurrentPage())) return;
      if (runtime.status !== 'running') return;
      if (runtime.pagesScraped <= beforeScraped) return;

      if (runtime.currentPage >= runtime.toPage) {
        runtime.status = 'completed';
        runtime.completedAt = new Date().toISOString();
        runtime.reason = 'Requested page range reached.';
        await persist();
        log('Scraping complete');
        return;
      }

      // Scroll to the bottom before looking for pagination so a lazy-rendered Next control can appear.
      await scrollToLoadAllResults(12000);
      const info = SNScraper.paginator.paginationInfo();
      if (!info.hasNext || info.nextDisabled) {
        runtime.status = 'completed';
        runtime.completedAt = new Date().toISOString();
        runtime.pagesAvailable = runtime.currentPage;
        runtime.reason = 'No additional pages available before the requested end page.';
        await persist();
        return;
      }

      const expectedPage = runtime.currentPage + 1;
      log('Navigating to page', expectedPage);
      const previous = runtime.pageSignature;
      const result = await SNScraper.paginator.clickNextAndWait(previous, expectedPage, 25000);
      if (!result.ok) {
        if (result.reason === 'restriction') setError('Scraping stopped because an access restriction was detected.');
        else if (result.reason === 'no-next') {
          runtime.status = 'completed'; runtime.completedAt = new Date().toISOString(); runtime.reason = 'No additional pages available before the requested end page.'; await persist();
        } else setError('Unable to confirm that the next page loaded.');
        return;
      }

      runtime.currentPage = result.currentPage || expectedPage;
      runtime.pageSignature = result.signature || SNScraper.paginator.pageSignature();
      runtime.recordsOnCurrentPage = result.cards || 0;
      await persist();
      log('Page', runtime.currentPage, 'loaded. Waiting for full result list.');

      if (runtime.currentPage !== expectedPage) {
        // Keep the workflow moving using the expected pagination step if the UI does not expose the page number.
        runtime.currentPage = expectedPage;
        await persist();
      }
    }
  }

  function setError(message) {
    runtime.status = 'error';
    runtime.error = message;
    runtime.reason = message;
    runtime.completedAt = new Date().toISOString();
    void persist();
  }

  async function start(fromPage, toPage) {
    const from = Math.max(1, Number(fromPage) || 1);
    const to = Math.max(from, Number(toPage) || from);
    runtime.fromPage = from;
    runtime.toPage = to;
    runtime.targetPages = to - from + 1;
    runtime.currentPage = SNScraper.paginator.getCurrentPage() || 1;
    runtime.status = 'running';
    runtime.records = [];
    runtime.duplicatesRemoved = 0;
    runtime.pagesScraped = 0;
    runtime.recordsOnCurrentPage = 0;
    runtime.pagesAvailable = null;
    runtime.startedAt = new Date().toISOString();
    runtime.completedAt = null;
    runtime.error = null;
    runtime.reason = null;
    runtime.tabId = runtime.tabId || null;
    runtime.pageSignature = SNScraper.paginator.pageSignature();
    await persist();
    void controller();
    return { ok: true };
  }

  async function stop() {
    runtime.status = 'stopped';
    runtime.completedAt = new Date().toISOString();
    runtime.reason = 'Stopped by user.';
    await persist();
  }

  async function pause() {
    if (runtime.status === 'running') {
      runtime.status = 'paused';
      await persist();
    }
  }

  async function resume() {
    if (runtime.status === 'paused') {
      runtime.status = 'running';
      await persist();
      void controller();
    }
  }

  async function maybeAutoResume() {
    await loadSettings();
    if (runtime.enabled && runtime.status === 'running') {
      runtime.status = 'running';
      runtime.pageSignature = SNScraper.paginator.pageSignature();
      void controller();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message?.type === 'inspect-page') {
        const info = detect();
        const cards = info.supported ? SNScraper.extractor.findResultCards() : [];
        sendResponse({ ok: true, ...info, currentPage: SNScraper.paginator.getCurrentPage(), recordsOnPage: cards.length, debug: runtime.debug, selectorNotes: SNScraper.SELECTOR_NOTES });
        return;
      }
      if (message?.type === 'start') { runtime.tabId = sender.tab?.id ?? runtime.tabId; sendResponse(await start(message.fromPage, message.toPage)); return; }
      if (message?.type === 'stop') { await stop(); sendResponse({ ok: true }); return; }
      if (message?.type === 'pause') { await pause(); sendResponse({ ok: true }); return; }
      if (message?.type === 'resume') { await resume(); sendResponse({ ok: true }); return; }
      if (message?.type === 'debug-dump') {
        const info = detect();
        const cards = info.supported ? SNScraper.extractor.findResultCards() : [];
        sendResponse({
          ok: true,
          page: info,
          currentPage: SNScraper.paginator.getCurrentPage(),
          resultCards: cards.length,
          sampleRecords: SNScraper.extractor.getRecords().slice(0, 3),
          nextButtonFound: !!SNScraper.paginator.findNextButton(),
          previousButtonFound: !!SNScraper.paginator.findPreviousButton(),
          scrollableRoots: SNScraper.paginator.visibleResultContainer() ? 1 : 0,
          pageSignature: SNScraper.paginator.pageSignature(),
          selectors: SNScraper.SELECTOR_NOTES
        });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message type' });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.enabled) runtime.enabled = changes.enabled.newValue !== false;
    if (changes.debug) runtime.debug = changes.debug.newValue === true;
  });

  void maybeAutoResume();
})();
