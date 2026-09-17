(() => {
  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  function toCSV(records) {
    const headers = ['First Name','Last Name','Full Name','Job Title','Company Name','Company Domain','Location','Profile URL','Connection Degree','Industry','Scraped At'];
    const keys = ['firstName','lastName','fullName','jobTitle','companyName','companyDomain','location','profileUrl','connectionDegree','industry','scrapedAt'];
    return '\uFEFF' + [headers.join(','), ...records.map(r => keys.map(k => csvEscape(r[k])).join(','))].join('\r\n');
  }
  globalThis.SNSCSV = { toCSV };
})();
