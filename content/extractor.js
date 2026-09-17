(() => {
  const SNScraper = (window.SNScraper = window.SNScraper || {});
  const S = SNScraper.SELECTORS;

  function cleanUrl(url) {
    try {
      const u = new URL(url, location.origin);
      u.hash = '';
      for (const key of [...u.searchParams.keys()]) {
        if (/trk|tracking|miniProfile|lipi|sessionId|context|ref/i.test(key)) {
          u.searchParams.delete(key);
        }
      }
      return u.href;
    } catch {
      return '';
    }
  }

  function textOf(el) {
    return SNScraper.normalizeText(el?.textContent || el?.getAttribute?.('aria-label') || '');
  }

  function isTenure(text) {
    if (!text) return false;
    const s = String(text).toLowerCase().trim();
    return /\b(?:in role|in company|years in role|months in role|yr in role|mo in role|year in role|month in role)\b/i.test(s) ||
           /\b\d+\s*(?:years?|months?|yrs?|mos?)\s+(?:in role|in company)\b/i.test(s) ||
           /^in role\s*(?:\||·)?\s*in company$/i.test(s) ||
           /in role\s*(?:\||·)\s*.*in company/i.test(s);
  }

  function firstMatching(root, selectors) {
    for (const selector of selectors) {
      const nodes = [...root.querySelectorAll(selector)];
      const found = nodes.find(SNScraper.isVisible);
      if (found) return found;
    }
    return null;
  }

  function visibleElements(root, selectors) {
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        if (!seen.has(node) && SNScraper.isVisible(node)) {
          seen.add(node);
          out.push(node);
        }
      }
    }
    return out;
  }

  function elementByLabel(root, labels) {
    const wanted = labels.map(v => v.toLowerCase());
    return [...root.querySelectorAll('[aria-label], [data-label], [title]')].find(el => {
      const value = String(el.getAttribute('aria-label') || el.getAttribute('data-label') || el.getAttribute('title') || '').toLowerCase();
      return wanted.some(label => value.includes(label)) && SNScraper.isVisible(el);
    }) || null;
  }

  function escapeRegex(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractProfileUrl(card) {
    const link = visibleElements(card, S.profileLinks).find(a => {
      const href = String(a.getAttribute('href') || a.href || '');
      return /\/sales\/(?:lead|people)\//i.test(href) || /\/in\//i.test(href);
    });
    return link ? cleanUrl(link.getAttribute('href') || link.href) : '';
  }

  function cleanName(raw) {
    let name = SNScraper.normalizeText(raw || '');
    name = name.replace(/^view\s+(.+)'s\s+profile.*$/i, '$1');
    name = name.replace(/^profile result\s*[–-]\s*/i, '');
    name = name.replace(/\s*\(.*?\)$/i, '');
    name = name.replace(/\s+(?:is reachable|is open to work|open to work|premium|verified)\b/gi, '');
    name = name.replace(/\s*(?:·|,|-)?\s*\b(?:1st|2nd|3rd)\b(?:\s*degree(?:\s*connection)?)?.*$/i, '');
    return name.trim();
  }

  function splitName(fullName) {
    const clean = cleanName(fullName);
    if (!clean) return { firstName: '', lastName: '' };
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }

  function extractName(card) {
    const node = firstMatching(card, S.nameNodes);
    if (node) {
      const aria = SNScraper.normalizeText(node.getAttribute('aria-label') || '');
      const value = textOf(node) || aria;
      const cleaned = cleanName(value);
      if (cleaned) return cleaned;
    }
    const profileLink = visibleElements(card, S.profileLinks)[0];
    if (profileLink) {
      const aria = SNScraper.normalizeText(profileLink.getAttribute('aria-label'));
      const text = textOf(profileLink);
      const cleaned = cleanName(aria || text);
      if (cleaned) return cleaned;
    }
    const nameNode = elementByLabel(card, ['name', 'full name', 'profile name']);
    return nameNode ? cleanName(textOf(nameNode)) : '';
  }

  function cleanCompany(raw) {
    if (isTenure(raw)) return '';
    let comp = SNScraper.normalizeText(raw || '');
    comp = comp.replace(/^(?:at|@|company:)\s*/i, '');
    comp = comp.replace(/^see more about\s*/i, '');
    comp = comp.replace(/^["'“”]+|["'“”]+$/g, '').trim();

    // LinkedIn often includes metadata like " · 51-200 employees" or " · Full-time"
    if (comp.includes(' · ')) {
      const parts = comp.split(' · ').map(s => s.trim()).filter(Boolean);
      if (parts[0] && !/employee|experience|yr|mo|full-time|part-time|in role|in company/i.test(parts[0])) {
        comp = parts[0];
      }
    } else if (comp.includes(' • ')) {
      const parts = comp.split(' • ').map(s => s.trim()).filter(Boolean);
      if (parts[0] && !/employee|experience|yr|mo|full-time|part-time|in role|in company/i.test(parts[0])) {
        comp = parts[0];
      }
    }

    comp = comp.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return isTenure(comp) ? '' : comp;
  }

  function cleanTitle(raw, companyName) {
    if (isTenure(raw)) return '';
    let title = SNScraper.normalizeText(raw || '');
    // Remove prefixes like "Current: ", "Present: "
    title = title.replace(/^(?:current|present|headline|title)\s*[:\-–]\s*/i, '');

    // If company name is provided, remove trailing " at Company" / " @ Company" / " · Company"
    if (companyName) {
      const safeComp = escapeRegex(companyName.trim());
      const atCompanyRegex = new RegExp(`\\s+(?:at|@|·|,|-)\\s+${safeComp}\\b.*$`, 'i');
      title = title.replace(atCompanyRegex, '');
    }

    // If title has mid-dot or bullet separator, e.g. "Owner / CEO · Standard Trading Limited"
    if (title.includes(' · ')) {
      const parts = title.split(' · ').map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        title = parts[0];
      }
    }

    // Remove any trailing badges, degrees, or connections
    title = title.replace(/\s*[·•,]\s*(?:1st|2nd|3rd)\b.*$/i, '');
    title = title.replace(/\s*\b(?:1st|2nd|3rd)\s*degree\b.*$/i, '');

    title = title.trim();
    return isTenure(title) ? '' : title;
  }

  function extractCompany(card, rawTitleHint) {
    // 1. Check dedicated company node/link
    const explicitNode = firstMatching(card, [
      '[data-anonymize="company-name"] a',
      '[data-anonymize="company-name"]',
      'a[href*="/sales/company/"]',
      'a[href*="/company/"]',
      '.artdeco-entity-lockup__subtitle button[aria-label*="See more about"]',
      'button[aria-label*="See more about"]',
      'button.entity-hovercard_ally-trigger'
    ]);

    if (explicitNode) {
      const aria = explicitNode.getAttribute('aria-label');
      const ariaMatch = aria && aria.match(/see more about\s+(.+)/i);
      const text = ariaMatch ? ariaMatch[1] : textOf(explicitNode);
      const cleaned = cleanCompany(text);
      if (cleaned && !isTenure(cleaned)) return cleaned;
    }

    // 2. Check within the subtitle element
    const subtitleEl = card.querySelector('.artdeco-entity-lockup__subtitle, .result-lockup__position');
    if (subtitleEl) {
      // Check for button or link inside subtitle
      const subBtn = subtitleEl.querySelector('button, a');
      if (subBtn) {
        const aria = subBtn.getAttribute('aria-label');
        const ariaMatch = aria && aria.match(/see more about\s+(.+)/i);
        const text = ariaMatch ? ariaMatch[1] : textOf(subBtn);
        const cleaned = cleanCompany(text);
        if (cleaned && !isTenure(cleaned)) return cleaned;
      }

      // Check text after separator like "Owner · DOPT" or "Owner / CEO · Standard Trading Limited"
      const subText = textOf(subtitleEl);
      if (subText.includes(' · ')) {
        const parts = subText.split(' · ').map(s => s.trim()).filter(Boolean);
        if (parts.length > 1) {
          const cand = cleanCompany(parts[1]);
          if (cand && !isTenure(cand)) return cand;
        }
      }
    }

    const labeled = elementByLabel(card, ['company', 'current company', 'organization']);
    if (labeled) {
      const text = cleanCompany(textOf(labeled));
      if (text && !isTenure(text)) return text;
    }

    // 3. Check visible company links
    const links = visibleElements(card, S.companyLinks);
    for (const link of links) {
      const text = cleanCompany(textOf(link));
      if (text && !isTenure(text) && (!rawTitleHint || text.toLowerCase() !== rawTitleHint.toLowerCase())) {
        return text;
      }
    }

    // 4. Fallback: If title has " at <Company>" or " @ <Company>"
    if (rawTitleHint && !isTenure(rawTitleHint)) {
      const match = rawTitleHint.match(/\s+(?:at|@)\s+([^·|,\n]+)/i);
      if (match && match[1]) {
        const cand = cleanCompany(match[1]);
        if (cand && !isTenure(cand)) return cand;
      }
    }

    return '';
  }

  function extractTitle(card, fullName, companyName) {
    let rawTitle = '';

    // 1. Direct match on data-anonymize="title" (LinkedIn's exact title element!)
    const directTitle = card.querySelector('[data-anonymize="title"]');
    if (directTitle && SNScraper.isVisible(directTitle)) {
      const val = textOf(directTitle);
      if (val && !isTenure(val)) {
        return cleanTitle(val, companyName);
      }
    }

    // 2. Check subtitle container
    const subtitleEl = card.querySelector('.artdeco-entity-lockup__subtitle, .entity-result__primary-subtitle, .result-lockup__position');
    if (subtitleEl && SNScraper.isVisible(subtitleEl)) {
      const titleSpan = subtitleEl.querySelector('[data-anonymize="title"]');
      if (titleSpan) {
        const val = textOf(titleSpan);
        if (val && !isTenure(val)) {
          return cleanTitle(val, companyName);
        }
      }

      // Check if subtitle has company button or link inside
      const compTarget = subtitleEl.querySelector('button, a[href*="/company/"]');
      if (compTarget) {
        const compText = textOf(compTarget);
        let subText = textOf(subtitleEl);
        if (compText) {
          subText = subText.replace(new RegExp(`\\s*(?:at|@|·)?\\s*${escapeRegex(compText)}.*$`, 'i'), '');
        }
        if (subText && !isTenure(subText)) {
          rawTitle = subText;
        }
      } else {
        const subText = textOf(subtitleEl);
        if (subText.includes(' · ')) {
          const parts = subText.split(' · ').map(s => s.trim()).filter(Boolean);
          if (parts[0] && !isTenure(parts[0])) {
            rawTitle = parts[0];
          }
        } else if (!isTenure(subText)) {
          rawTitle = subText;
        }
      }
    }

    // 3. Fallback to titleNodes list
    if (!rawTitle) {
      for (const selector of S.titleNodes) {
        const nodes = [...card.querySelectorAll(selector)];
        for (const n of nodes) {
          if (!SNScraper.isVisible(n)) continue;
          const val = textOf(n);
          if (val && !isTenure(val)) {
            rawTitle = val;
            break;
          }
        }
        if (rawTitle) break;
      }
    }

    if (!rawTitle) {
      const labeled = elementByLabel(card, ['headline', 'job title', 'current position']);
      if (labeled) {
        const val = textOf(labeled);
        if (val && !isTenure(val)) rawTitle = val;
      }
    }

    // 4. Safe structural fallback: search visible text lines, explicitly skipping tenure and names
    if (!rawTitle) {
      const lines = [...card.querySelectorAll('span, div, p, h3, h4')]
        .filter(SNScraper.isVisible)
        .map(textOf)
        .filter(Boolean);

      const nameClean = SNScraper.normalizeText(fullName);
      const compClean = SNScraper.normalizeText(companyName);

      const filtered = lines.filter(text => {
        if (text === nameClean || (compClean && text === compClean)) return false;
        if (text.length < 2 || text.length > 220) return false;
        if (isTenure(text)) return false;
        // Ignore generic actions, degrees, connections
        if (/^(?:save|saved|message|connect|follow|pending|view profile|open to work|shared connection|\d+\s*mutual|\d+[stndrh]+\b)/i.test(text)) return false;
        return true;
      });

      rawTitle = filtered.find(text => /\b(owner|ceo|cto|cmo|coo|founder|co-founder|president|director|manager|head|lead|vp|vice president|engineer|developer|designer|architect|partner|principal|specialist|analyst|consultant|officer)\b/i.test(text)) || filtered[0] || '';
    }

    return cleanTitle(rawTitle, companyName);
  }

  function extractLocation(card) {
    const node = firstMatching(card, S.locationNodes);
    if (node) {
      let value = textOf(node);
      value = value.replace(/^(?:location|geography|where)\s*[:\-–]\s*/i, '');
      value = value.replace(/^[·•]\s*/, '');
      if (value && !isTenure(value) && !/save|message|connect|follow|degree|connection/i.test(value)) {
        return value.trim();
      }
    }

    const labeled = elementByLabel(card, ['location', 'geography', 'where']);
    if (labeled) {
      let value = textOf(labeled);
      value = value.replace(/^[·•]\s*/, '');
      if (value && !isTenure(value)) return value.trim();
    }

    const text = SNScraper.normalizeText(card.textContent || '');
    const parts = text.split(/[·•|]/).map(SNScraper.normalizeText).filter(Boolean);
    const locMatch = parts.find(x => {
      if (x.length < 3 || x.length > 80) return false;
      if (isTenure(x)) return false;
      if (/save|message|connect|follow|experience|employee|school|connection/i.test(x)) return false;
      return /,\s*[a-zA-Z\s]+$/.test(x) || /\b(?:area|region|metro|city|state|country|south korea|korea|seoul|gyeonggi|incheon|india|usa|united states|uk|united kingdom|canada|australia|germany|france|singapore|uae|dubai)\b/i.test(x);
    });

    return locMatch ? locMatch.trim() : '';
  }

  function extractConnectionDegree(card) {
    if (S.badgeNodes) {
      const badge = firstMatching(card, S.badgeNodes);
      if (badge) {
        const text = textOf(badge);
        const match = text.match(/\b(1st|2nd|3rd)\b/i);
        if (match) return match[1];
      }
    }
    const text = SNScraper.normalizeText(card.textContent || '');
    const match = text.match(/\b(1st|2nd|3rd)\s*(?:degree|\+)?\b/i);
    return match ? match[1] : '';
  }

  function extractIndustry(card) {
    const node = firstMatching(card, S.industryNodes);
    if (node) {
      const val = textOf(node);
      if (val && !isTenure(val)) return val;
    }
    const labeled = elementByLabel(card, ['industry']);
    if (labeled) {
      const val = textOf(labeled);
      if (val && !isTenure(val)) return val;
    }
    const text = SNScraper.normalizeText(card.textContent || '');
    const match = text.match(/industry\s*[:\-]\s*([^·|•]+)/i);
    return match ? SNScraper.normalizeText(match[1]) : '';
  }

  function scoreCandidate(card) {
    let score = 0;
    const url = extractProfileUrl(card);
    const name = extractName(card);
    if (url) score += 10;
    if (/\/sales\/(?:lead|people)\//i.test(url)) score += 4;
    if (name) score += 4;
    if (firstMatching(card, S.titleNodes)) score += 2;
    if (firstMatching(card, S.companyNodes)) score += 2;
    if (SNScraper.normalizeText(card.innerText || '').length > 30) score += 1;
    return score;
  }

  function findResultCards() {
    const seen = new Set();
    const candidates = [];
    for (const selector of S.resultCardCandidates) {
      document.querySelectorAll(selector).forEach(node => {
        if (!SNScraper.isVisible(node) || seen.has(node)) return;
        seen.add(node);
        candidates.push(node);
      });
    }

    // Strong structural fallback: use each visible Sales Navigator profile link
    // and walk upward until we find the smallest container that contains identity data.
    for (const link of document.querySelectorAll(S.profileLinks.join(','))) {
      if (!SNScraper.isVisible(link)) continue;
      let parent = link.parentElement;
      let best = null;
      for (let i = 0; i < 8 && parent; i++, parent = parent.parentElement) {
        const score = scoreCandidate(parent);
        if (score >= 10 && (!best || parent.childElementCount <= best.childElementCount)) best = parent;
      }
      if (best && !seen.has(best)) { seen.add(best); candidates.push(best); }
    }

    return candidates
      .filter(card => scoreCandidate(card) >= 10)
      .map(card => ({ card, url: extractProfileUrl(card) }))
      .filter((item, index, arr) => item.url ? arr.findIndex(x => x.url === item.url) === index : true)
      .map(item => item.card);
  }

  function extractCard(card) {
    const fullName = extractName(card);
    const { firstName, lastName } = splitName(fullName);

    // Initial pass to get raw title hint for company extraction
    const rawTitleNode = card.querySelector('[data-anonymize="title"], .artdeco-entity-lockup__subtitle');
    const rawTitleHint = rawTitleNode ? textOf(rawTitleNode) : '';

    let companyName = extractCompany(card, rawTitleHint);
    let jobTitle = extractTitle(card, fullName, companyName);

    // If company was not found earlier, see if title splitting yields company
    if (!companyName && rawTitleHint && !isTenure(rawTitleHint)) {
      const match = rawTitleHint.match(/\s+(?:at|@)\s+([^·|,\n]+)/i);
      if (match && match[1]) {
        companyName = cleanCompany(match[1]);
        jobTitle = cleanTitle(jobTitle, companyName);
      }
    }

    const location = extractLocation(card);
    const profileUrl = extractProfileUrl(card);

    return {
      firstName,
      lastName,
      fullName: cleanName(fullName),
      jobTitle,
      companyName,
      location,
      profileUrl,
      connectionDegree: extractConnectionDegree(card),
      industry: extractIndustry(card),
      scrapedAt: new Date().toISOString()
    };
  }

  function getRecords(limit = S.MAX_RECORDS_PER_PAGE || 25) {
    return findResultCards()
      .slice(0, Math.max(1, Number(limit) || 25))
      .map(extractCard)
      .filter(r => r.fullName || r.profileUrl);
  }

  SNScraper.extractor = {
    findResultCards,
    extractCard,
    getRecords,
    cleanUrl,
    cleanName,
    cleanTitle,
    cleanCompany,
    splitName,
    isTenure
  };
})();
