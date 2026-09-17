(() => {
  const SNScraper = (window.SNScraper = window.SNScraper || {});
  const S = SNScraper.SELECTORS;

  let lastKnownPage = 1;

  function parsePositiveInt(value) {
    const n = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getCurrentPage() {
    for (const selector of S.currentPageMarkers) {
      const el = document.querySelector(selector);
      if (!el || !SNScraper.isVisible(el)) continue;
      const candidates = [
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('data-page-number'),
        el.getAttribute('data-current-page')
      ];
      for (const candidate of candidates) {
        const n = parsePositiveInt(candidate);
        if (n) {
          lastKnownPage = n;
          return n;
        }
      }
    }

    const pagePatterns = [
      /(?:page|পৃষ্ঠা)\s*(\d+)/i,
      /\b(\d+)\s*\/\s*\d+\b/
    ];
    const bodyText = SNScraper.normalizeText(document.body?.innerText || '');
    for (const pattern of pagePatterns) {
      const match = bodyText.match(pattern);
      const n = parsePositiveInt(match?.[1]);
      if (n) {
        lastKnownPage = n;
        return n;
      }
    }

    try {
      const u = new URL(location.href);
      for (const key of ['page', 'pageNumber', 'page_num', 'start']) {
        const raw = u.searchParams.get(key);
        const n = key === 'start' ? (parsePositiveInt(raw) ? Math.floor((parsePositiveInt(raw) - 1) / 25) + 1 : null) : parsePositiveInt(raw);
        if (n) {
          lastKnownPage = n;
          return n;
        }
      }
    } catch (_) {}

    return lastKnownPage || 1;
  }

  function findNavButton(direction) {
    const selectors = direction === 'next' ? S.nextButtons : (S.previousButtons || S.nextButtons);
    const words = direction === 'next' ? /\bnext\b/i : /\b(previous|prev)\b/i;
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(SNScraper.isVisible);
      const candidate = nodes.find(el => {
        const label = SNScraper.normalizeText(el.getAttribute('aria-label') || '');
        const title = SNScraper.normalizeText(el.getAttribute('title') || '');
        const text = SNScraper.normalizeText(el.textContent || '');
        if (SNScraper.isDisabled(el)) return false;
        if (words.test(label) || words.test(title) || words.test(text)) return true;
        if (direction === 'next') return ['›', '→', '>'].includes(text);
        return ['‹', '←', '<'].includes(text);
      });
      if (candidate) return candidate;
    }
    return null;
  }

  function findNextButton() { return findNavButton('next'); }
  function findPreviousButton() { return findNavButton('previous'); }

  function pageSignature() {
    const cards = SNScraper.extractor?.findResultCards?.() || [];
    const urls = cards.map(c => {
      const link = c.querySelector('a[href*="/in/"], a[href*="/sales/lead/"]');
      return SNScraper.extractor.cleanUrl(link?.href || '');
    }).filter(Boolean).slice(0, 8);
    const firstTexts = cards.slice(0, 3).map(c => SNScraper.normalizeText(c.textContent).slice(0, 220));
    return `${getCurrentPage()}|${urls.join('|')}|${firstTexts.join('|')}|${location.pathname}${location.search}`;
  }

  function paginationInfo() {
    const next = findNextButton();
    const previous = findPreviousButton();
    return {
      currentPage: getCurrentPage(),
      hasNext: !!next,
      nextDisabled: next ? SNScraper.isDisabled(next) : true,
      hasPrevious: !!previous,
      previousDisabled: previous ? SNScraper.isDisabled(previous) : true,
      nextButton: next,
      previousButton: previous
    };
  }

  function visibleResultContainer() {
    const cards = SNScraper.extractor?.findResultCards?.() || [];
    const firstCard = cards[0];
    if (!firstCard) return null;
    let node = firstCard.parentElement;
    let best = null;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const style = getComputedStyle(node);
      const scrollable = node.scrollHeight > node.clientHeight + 40 && /auto|scroll/.test(style.overflowY || '');
      if (scrollable) best = node;
    }
    return best;
  }

  async function clickDirectionAndWait(direction, previousSignature, expectedPage, timeoutMs = 25000) {
    const button = direction === 'next' ? findNextButton() : findPreviousButton();
    if (!button || SNScraper.isDisabled(button)) return { ok: false, reason: direction === 'next' ? 'no-next' : 'no-previous' };

    const beforePage = getCurrentPage();
    const beforeUrl = location.href;
    const beforeCards = (SNScraper.extractor?.getRecords?.(5) || []).map(r => r.profileUrl || r.fullName).filter(Boolean).join('|');

    // Capture the click immediately before mutating the DOM. Do not assume a full navigation.
    button.scrollIntoView({ block: 'center', behavior: 'instant' });
    button.click();
    lastKnownPage = expectedPage || (direction === 'next' ? beforePage + 1 : Math.max(1, beforePage - 1));

    const started = Date.now();
    return await new Promise(resolve => {
      let observer;
      let poll;
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearInterval(poll);
        resolve(result);
      };
      const check = async () => {
        if (SNScraper.pageDetector.detectRestriction()) {
          finish({ ok: false, reason: 'restriction' });
          return;
        }

        const currentPage = getCurrentPage();
        const currentUrl = location.href;
        const currentCards = SNScraper.extractor?.getRecords?.(5) || [];
        const currentCardKey = currentCards.map(r => r.profileUrl || r.fullName).filter(Boolean).join('|');
        const sig = pageSignature();
        const pageNumberChanged = currentPage !== beforePage;
        const urlChanged = currentUrl !== beforeUrl;
        const cardsChanged = currentCardKey && currentCardKey !== beforeCards;
        const signatureChanged = sig !== previousSignature;
        const expectedReached = expectedPage ? currentPage === expectedPage : false;

        if ((pageNumberChanged || urlChanged || cardsChanged) && currentCards.length > 0) {
          // Let the result list settle before handing control back to the scraper.
          await SNScraper.waitForResultListSettled(1200, Math.min(7000, timeoutMs));
          SNScraper.resetScrollPositions?.();
          finish({ ok: true, currentPage: expectedReached ? expectedPage : currentPage, signature: pageSignature(), cards: (SNScraper.extractor?.findResultCards?.() || []).length });
          return;
        }

        if (Date.now() - started >= timeoutMs) finish({ ok: false, reason: 'timeout' });
      };
      observer = new MutationObserver(() => { void check(); });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      poll = setInterval(() => { void check(); }, 500);
      void check();
    });
  }

  async function clickNextAndWait(previousSignature, expectedPage, timeoutMs = 25000) {
    return clickDirectionAndWait('next', previousSignature, expectedPage, timeoutMs);
  }

  async function clickPreviousAndWait(previousSignature, expectedPage, timeoutMs = 25000) {
    return clickDirectionAndWait('previous', previousSignature, expectedPage, timeoutMs);
  }

  async function moveToPage(targetPage, timeoutMs = 25000, maxSteps = 500) {
    let current = getCurrentPage() || 1;
    if (current === targetPage) return { ok: true, currentPage: current, signature: pageSignature() };

    for (let step = 0; step < maxSteps; step++) {
      const direction = targetPage > current ? 'next' : 'previous';
      const info = paginationInfo();
      const button = direction === 'next' ? info.nextButton : info.previousButton;
      if (!button || SNScraper.isDisabled(button)) {
        return { ok: false, reason: direction === 'next' ? 'no-next' : 'no-previous', currentPage: current };
      }
      const previous = pageSignature();
      const expected = direction === 'next' ? current + 1 : Math.max(1, current - 1);
      const result = direction === 'next'
        ? await clickNextAndWait(previous, expected, timeoutMs)
        : await clickPreviousAndWait(previous, expected, timeoutMs);
      if (!result.ok) return { ...result, currentPage: getCurrentPage() || current };

      // Prefer the observed number, but use the expected step when the SPA does not expose one.
      const observedPage = Number(result.currentPage);
      current = (Number.isFinite(observedPage) && observedPage === expected) ? observedPage : expected;
      if (current === targetPage) {
        lastKnownPage = current;
        return { ok: true, currentPage: current, signature: result.signature };
      }
    }
    return { ok: false, reason: 'step-limit', currentPage: current };
  }

  SNScraper.paginator = {
    getCurrentPage,
    findNextButton,
    findPreviousButton,
    pageSignature,
    paginationInfo,
    clickNextAndWait,
    clickPreviousAndWait,
    moveToPage,
    visibleResultContainer
  };
})();
