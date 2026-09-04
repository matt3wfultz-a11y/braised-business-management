// Simple localStorage-backed data layer for the invoicing app.
const Storage = (() => {
  const KEYS = {
    clients: "bbm_clients",
    invoices: "bbm_invoices",
    estimates: "bbm_estimates",
    settings: "bbm_settings",
  };

  // Scope and terms lines a new estimate starts with, so the common case is
  // "fill in the deliverables and send". Editable under Settings → Estimate
  // Defaults; editing an estimate never writes back to these.
  const DEFAULT_SCOPE = [
    { label: "Deliverables", value: "" },
    { label: "Duration", value: "" },
    { label: "Format", value: "2D Motion Design (After Effects / Cavalry)" },
    { label: "Aspect Ratios", value: "9:16 and 16:9" },
    { label: "Client Responsibilities", value: "Storyboards, designs, assets, and voiceover provided by Client" },
  ];

  const DEFAULT_TERMS = [
    { label: "Payment Terms", value: "30% deposit upon acceptance; 70% upon final delivery. Payment due net 30 from invoice date." },
    { label: "Revisions", value: "Two (2) rounds of revisions included per deliverable. Additional revisions billed at $70/hour." },
    { label: "Delivery", value: "High-quality video files in 9:16 and 16:9 aspect ratios (.mp4, ProRes, or format specified)." },
  ];

  const DEFAULT_SETTINGS = {
    businessName: "Braised Animation",
    businessEmail: "",
    businessAddress: "",
    businessPhone: "",
    businessWebsite: "",
    currency: "$",
    emailMethod: "gmail",
    estimatePrefix: "EST-",
    estimateValidDays: 14,
    estimateScope: DEFAULT_SCOPE,
    estimateTerms: DEFAULT_TERMS,
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    getClients() { return read(KEYS.clients, []); },
    saveClients(clients) { write(KEYS.clients, clients); },
    getInvoices() { return read(KEYS.invoices, []); },
    saveInvoices(invoices) { write(KEYS.invoices, invoices); },
    getEstimates() { return read(KEYS.estimates, []); },
    saveEstimates(estimates) { write(KEYS.estimates, estimates); },
    getSettings() {
      // Spread over the defaults so settings saved before a field existed still
      // come back with it — otherwise everyone who used the app already would
      // get an estimate with no scope, no terms and no phone number.
      return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
    },
    saveSettings(settings) { write(KEYS.settings, settings); },
    defaultScope() { return DEFAULT_SCOPE.map((r) => ({ ...r })); },
    defaultTerms() { return DEFAULT_TERMS.map((r) => ({ ...r })); },
    uid,
  };
})();
