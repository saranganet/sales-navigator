(() => {
  const SNScraper = (window.SNScraper = window.SNScraper || {});

  function isLinkedInHost() {
    return location.hostname === 'www.linkedin.com' || location.hostname.endsWith('.linkedin.com');
  }

  function isSalesNavigatorPath() {
    return /^\/sales\//i.test(location.pathname);
  }

  function looksLikeResultsPage() {
    const path = location.pathname.toLowerCase();
    if (!isLinkedInHost() || !isSalesNavigatorPath()) return false;
    if (path.includes('/search/')) return true;
    if (document.querySelector('[data-testid*="search"]')) return true;
    if (document.body?.innerText?.toLowerCase().includes('search filters')) return true;
    return true; // Sales Navigator route with no cards is still detected; UI can explain "no results".
  }

  function detectRestriction() {
    const text = SNScraper.normalizeText(document.body?.innerText || '').toLowerCase();
    const patterns = [
      'captcha',
      'verify you are human',
      'unusual activity',
      'temporarily restricted',
      'access denied',
      'security challenge',
      'challenge required'
    ];
    return patterns.some(p => text.includes(p));
  }

  function inspect() {
    const supported = looksLikeResultsPage();
    const restricted = supported && detectRestriction();
    return {
      supported,
      restricted,
      url: location.href,
      path: location.pathname,
      reason: !isLinkedInHost() ? 'not-linkedin' : !isSalesNavigatorPath() ? 'not-sales-navigator' : 'supported'
    };
  }

  SNScraper.pageDetector = { inspect, detectRestriction };
})();
