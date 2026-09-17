(() => {
  const defaults = {
    enabled: true,
    debug: false,
    state: {
      status: 'idle',
      fromPage: 1,
      toPage: 1,
      targetPages: 1,
      recordsCollected: 0,
      duplicatesRemoved: 0,
      uniqueRecords: 0,
      pagesScraped: 0,
      pagesAvailable: null,
      startedAt: null,
      completedAt: null,
      error: null,
      reason: null,
      tabId: null,
      url: null
    },
    records: []
  };

  async function get(keys = null) {
    return await chrome.storage.local.get(keys ?? defaults);
  }
  async function set(value) { return await chrome.storage.local.set(value); }
  async function clearJob() { return await chrome.storage.local.set({ state: defaults.state, records: [] }); }
  async function getEnabled() { return (await get({ enabled: true })).enabled !== false; }
  async function getDebug() { return (await get({ debug: false })).debug === true; }

  globalThis.SNSStorage = { defaults, get, set, clearJob, getEnabled, getDebug };
})();
