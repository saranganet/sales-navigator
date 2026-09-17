const DEFAULT_STATE = {
  status: 'idle', currentPage: 1, targetPages: 1, recordsCollected: 0,
  duplicatesRemoved: 0, uniqueRecords: 0, pagesScraped: 0, pagesAvailable: null,
  startedAt: null, completedAt: null, error: null, reason: null, tabId: null, url: null
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['enabled', 'debug', 'state', 'records']);
  await chrome.storage.local.set({
    enabled: existing.enabled ?? true,
    debug: existing.debug ?? false,
    state: existing.state ?? DEFAULT_STATE,
    records: existing.records ?? []
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'content-state-update') {
      await chrome.storage.local.set({ state: message.state, records: message.records });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'get-storage') {
      sendResponse(await chrome.storage.local.get(['enabled','debug','state','records']));
      return;
    }
    if (message?.type === 'ping') {
      sendResponse({ ok: true, tabId: sender.tab?.id ?? null });
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message type' });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const { state } = await chrome.storage.local.get(['state']);
  if (!state || state.tabId !== tabId || !['running', 'paused'].includes(state.status)) return;
  try {
    const u = new URL(changeInfo.url);
    const stillSalesNavigator = u.hostname.endsWith('linkedin.com') && /^\/sales\//i.test(u.pathname);
    if (!stillSalesNavigator) {
      await chrome.storage.local.set({
        state: {
          ...state,
          status: 'stopped',
          completedAt: new Date().toISOString(),
          reason: 'Scraping stopped because the Sales Navigator page changed.'
        }
      });
    }
  } catch (_) {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { state } = await chrome.storage.local.get(['state']);
  if (state?.status === 'running' || state?.status === 'paused') {
    if (state.tabId === tabId) {
      await chrome.storage.local.set({ state: { ...state, status: 'stopped', reason: 'Scraping stopped because the Sales Navigator tab was closed.' } });
    }
  }
});
