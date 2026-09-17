(() => {
  const SNScraper = (window.SNScraper = window.SNScraper || {});

  // Sales Navigator's DOM changes over time. Keep selectors centralized and use
  // semantic/structural fallbacks before generated class names.
  SNScraper.SELECTORS = {
    resultCardCandidates: [
      'li.search-results__result-item',
      'ol.search-results__result-list > li',
      '[data-scroll-into-view*="salesProfile"]',
      '[data-x--lead-card]',
      '[data-view-name*="lead"]',
      'li[data-view-name*="search-entity"]',
      '[data-testid*="lead"]',
      '[data-testid*="search-result"]',
      'li[class*="search-results__result-item"]',
      'li[class*="result-item"]',
      '.artdeco-entity-lockup',
      'article'
    ],
    profileLinks: [
      'a[href*="/sales/lead/"]',
      'a[href*="/sales/people/"]',
      'a[href*="/in/"]',
      'a[href*="linkedin.com/in/"]'
    ],
    companyLinks: [
      'a[href*="/sales/company/"]',
      'a[href*="/company/"]'
    ],
    companyWebsiteLinks: [
      'a[data-anonymize="company-website"]',
      'a[data-anonymize="company-url"]',
      'a[data-control-name*="website"]',
      'a[data-control-name*="company_website"]',
      'a[aria-label*="website" i]',
      'a[aria-label*="company website" i]',
      'a[href*="redir/redirect"]',
      'a[href^="http"]:not([href*="linkedin.com"]):not([href*="licdn.com"])'
    ],
    nameNodes: [
      '[data-anonymize="person-name"] a',
      '[data-anonymize="person-name"]',
      '.artdeco-entity-lockup__title a',
      '.artdeco-entity-lockup__title',
      '.result-lockup__name a',
      '.result-lockup__name',
      'a[href*="/sales/lead/"]',
      'a[href*="/sales/people/"]'
    ],
    titleNodes: [
      '[data-anonymize="title"]',
      '[data-anonymize="headline"]',
      '[data-anonymize="person-headline"]',
      '.artdeco-entity-lockup__subtitle [data-anonymize="title"]',
      '.artdeco-entity-lockup__subtitle',
      '[data-control-name="view_lead_panel_via_search_lead_headline"]',
      '[data-lead-headline]',
      '.entity-result__primary-subtitle',
      '.result-lockup__position'
    ],
    companyNodes: [
      '[data-anonymize="company-name"] a',
      '[data-anonymize="company-name"]',
      'a[href*="/sales/company/"]',
      'a[href*="/company/"]',
      '.artdeco-entity-lockup__subtitle button[aria-label*="See more about"]',
      'button[aria-label*="See more about"]',
      'button[class*="entity-hovercard"]',
      '[data-control-name="view_lead_panel_via_search_lead_company_name"]',
      '.result-lockup__position-company',
      '.entity-result__secondary-subtitle'
    ],
    locationNodes: [
      '[data-anonymize="location"]',
      '.artdeco-entity-lockup__caption',
      '[data-testid*="location"]',
      '.result-lockup__misc-item',
      '.entity-result__secondary-subtitle'
    ],
    badgeNodes: [
      '.artdeco-entity-lockup__badge',
      '[data-anonymize="degree"]',
      '.result-lockup__badge',
      '[class*="degree"]',
      '[class*="badge"]'
    ],
    industryNodes: [
      '[data-anonymize="industry"]'
    ],
    previousButtons: [
      'button[aria-label*="Previous"]',
      '[role="button"][aria-label*="Previous"]',
      'button[title*="Previous"]',
      'a[aria-label*="Previous"]',
      'button[aria-label*="Prev"]',
      '[role="button"][aria-label*="Prev"]'
    ],
    nextButtons: [
      'button[aria-label*="Next"]',
      'button[aria-label*="next"]',
      '[role="button"][aria-label*="Next"]',
      '[role="button"][aria-label*="next"]',
      'button[data-testid*="next"]',
      'a[aria-label*="Next"]',
      'a[aria-label*="next"]',
      'button'
    ],
    scrollContainerCandidates: [
      '[data-scroll-container]',
      '[role="main"]',
      'main',
      '.scaffold-layout__main',
      '[class*="search-results"]',
      '[class*="results-list"]'
    ],
    currentPageMarkers: [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[data-current-page="true"]'
    ]
  };

  SNScraper.SELECTOR_NOTES = {
    resultCardCandidates: 'Primary current/fallback candidates include search-results__result-item and data-scroll-into-view salesProfile containers; runtime scoring filters false positives.',
    profileLinks: 'Prefer Sales Navigator /sales/lead/ links. Public /in/ links remain a fallback when visibly present.',
    nameNodes: 'Prefer result-lockup__name and data-anonymize person-name, then visible Sales Navigator profile link text.',
    titleNodes: 'Prefer result-lockup position/headline patterns and data-anonymize job title/headline.',
    companyNodes: 'Prefer result-lockup company and visible company links.',
    previousButtons: [
      'button[aria-label*="Previous"]',
      '[role="button"][aria-label*="Previous"]',
      'button[title*="Previous"]',
      'a[aria-label*="Previous"]',
      'button[aria-label*="Prev"]',
      '[role="button"][aria-label*="Prev"]'
    ],
    nextButtons: 'Semantic aria-label/testid first; generic button fallback is filtered by visible label and disabled state.',
    currentPageMarkers: 'Accessibility/current-state markers first; URL/page-label fallback is used when needed.'
  };

  SNScraper.normalizeText = function(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  };

  SNScraper.isVisible = function(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const win = el.ownerDocument?.defaultView || window;
    const style = win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    if (el.getClientRects && el.getClientRects().length > 0) return true;
    return Boolean(el.offsetWidth || el.offsetHeight || el.offsetParent);
  };

  SNScraper.isDisabled = function(el) {
    if (!el) return true;
    return el.disabled === true ||
      el.getAttribute('disabled') !== null ||
      el.getAttribute('aria-disabled') === 'true' ||
      /disabled/.test(String(el.className || '').toLowerCase());
  };
})();
