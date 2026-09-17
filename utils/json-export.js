(() => {
  function toJSON(records) { return JSON.stringify(records, null, 2); }
  globalThis.SNSJSON = { toJSON };
})();
