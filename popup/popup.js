const $ = (id) => document.getElementById(id);
let activeTabId = null;
let latestRecords = [];
let latestInspection = null;

function setError(message = '') {
  $('errorBox').textContent = message;
  $('errorBox').classList.toggle('hidden', !message);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function send(type, extra = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab.');
  activeTabId = tab.id;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch (error) {
    throw new Error('Please open a Sales Navigator page and refresh it once after installing the extension.');
  }
}

async function readState() {
  return await chrome.storage.local.get(['enabled','debug','state','records']);
}

function statusLabel(state, inspection) {
  if (state?.status === 'running') return 'Scraping';
  if (state?.status === 'paused') return 'Paused';
  if (state?.status === 'completed') return 'Scraping complete';
  if (state?.status === 'stopped') return 'Stopped';
  if (state?.status === 'error') return 'Error';
  if (inspection?.restricted) return 'Access restriction detected';
  return inspection?.supported ? 'Sales Navigator detected ✓' : 'Please open Sales Navigator';
}

function render(data, inspection) {
  const state = data.state || {};
  latestRecords = Array.isArray(data.records) ? data.records : [];
  latestInspection = inspection;
  $('enabledToggle').checked = data.enabled !== false;
  $('detectedStatus').textContent = statusLabel(state, inspection);
  $('currentPage').textContent = state.currentPage ?? inspection?.currentPage ?? '—';
  $('recordsOnPage').textContent = inspection?.recordsOnPage ?? '—';
  $('pagesStat').textContent = String(state.pagesScraped ?? 0);
  $('collectedStat').textContent = state.recordsCollected ?? latestRecords.length;
  $('dupesStat').textContent = state.duplicatesRemoved ?? 0;
  $('uniqueStat').textContent = state.uniqueRecords ?? latestRecords.length;
  $('reasonText').textContent = state.reason || state.error || '';

  const fromPage = Number(state.fromPage || $('fromPageInput').value || 1);
  const toPage = Number(state.toPage || $('toPageInput').value || fromPage);
  const totalPages = Math.max(1, toPage - fromPage + 1);
  const scraped = Number(state.pagesScraped || 0);
  const progress = Math.min(100, Math.round((scraped / totalPages) * 100));
  $('progressBar').style.width = `${progress}%`;
  $('progressLabel').textContent = `${progress}%`;
  $('rangeProgress').textContent = `Pages ${scraped} / ${totalPages} (${fromPage}–${toPage})`;

  if (!['running','paused'].includes(state.status)) {
    if (Number.isFinite(fromPage) && fromPage >= 1) $('fromPageInput').value = fromPage;
    if (Number.isFinite(toPage) && toPage >= fromPage) $('toPageInput').value = toPage;
  }

  const active = ['running','paused'].includes(state.status);
  $('startBtn').disabled = active || data.enabled === false;
  $('stopBtn').disabled = !active;
  $('pauseBtn').disabled = state.status !== 'running';
  $('resumeBtn').disabled = state.status !== 'paused';
  $('csvBtn').disabled = latestRecords.length === 0;
  $('jsonBtn').disabled = latestRecords.length === 0;
  $('fromPageInput').disabled = active;
  $('toPageInput').disabled = active;

  if (state.error) setError(state.error);
  else if (inspection?.restricted) setError('Scraping stopped because an access restriction was detected.');
  else setError('');
}

async function inspect() {
  const data = await readState();
  try {
    const inspection = await send('inspect-page');
    render(data, inspection);
  } catch (e) {
    render(data, { supported:false, recordsOnPage:0 });
    setError(e.message);
  }
}

async function refresh() {
  const data = await readState();
  let inspection = null;
  try { inspection = await send('inspect-page'); } catch (_) {}
  render(data, inspection);
}

async function startScraping() {
  setError('');
  let fromPage = Math.max(1, Math.min(5000, parseInt($('fromPageInput').value, 10) || 1));
  let toPage = Math.max(1, Math.min(5000, parseInt($('toPageInput').value, 10) || fromPage));
  if (toPage < fromPage) toPage = fromPage;
  $('fromPageInput').value = fromPage;
  $('toPageInput').value = toPage;

  const response = await send('start', { fromPage, toPage });
  if (!response?.ok) { setError(response?.error || 'Unable to start.'); return; }
  await refresh();
}

async function updateToggle() {
  const enabled = $('enabledToggle').checked;
  await chrome.storage.local.set({ enabled });
  if (!enabled) {
    try { await send('stop'); } catch (_) {}
  }
  await refresh();
}

async function exportFile(kind) {
  if (!latestRecords.length) return;
  const date = new Date().toISOString().slice(0,10);
  const content = kind === 'csv' ? window.SNSCSV.toCSV(latestRecords) : window.SNSJSON.toJSON(latestRecords);
  const mime = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const blobUrl = URL.createObjectURL(new Blob([content], { type: mime }));
  await chrome.downloads.download({
    url: blobUrl,
    filename: `sales_navigator_export_${date}.${kind}`,
    saveAs: true,
    conflictAction: 'uniquify'
  });
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

async function debugDump() {
  try {
    const response = await send('debug-dump');
    $('debugOutput').textContent = JSON.stringify(response, null, 2);
    $('debugOutput').classList.remove('hidden');
  } catch (e) {
    $('debugOutput').textContent = e.message;
    $('debugOutput').classList.remove('hidden');
  }
}

$('enabledToggle').addEventListener('change', updateToggle);
$('startBtn').addEventListener('click', startScraping);
$('stopBtn').addEventListener('click', async () => { await send('stop'); await refresh(); });
$('pauseBtn').addEventListener('click', async () => { await send('pause'); await refresh(); });
$('resumeBtn').addEventListener('click', async () => { await send('resume'); await refresh(); });
$('csvBtn').addEventListener('click', () => exportFile('csv'));
$('jsonBtn').addEventListener('click', () => exportFile('json'));
$('debugBtn').addEventListener('click', debugDump);

chrome.storage.onChanged.addListener(() => refresh().catch(() => {}));
setInterval(() => refresh().catch(() => {}), 800);
inspect();
