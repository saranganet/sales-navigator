(() => {
  globalThis.SNSHelpers = {
    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
    nowISO() { return new Date().toISOString(); },
    filenameDate() { return new Date().toISOString().slice(0, 10); },
    recordKey(record) {
      const url = String(record.profileUrl || '').trim().toLowerCase();
      if (url) return `url:${url}`;
      return `fallback:${String(record.fullName || '').trim().toLowerCase()}|${String(record.companyName || '').trim().toLowerCase()}`;
    },
    isSameSupportedPage(url) {
      try {
        const u = new URL(url);
        return u.hostname.endsWith('linkedin.com') && /^\/sales\//i.test(u.pathname);
      } catch { return false; }
    }
  };
})();
