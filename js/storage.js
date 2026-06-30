// Simple localStorage-backed data layer for the invoicing app.
const Storage = (() => {
  const KEYS = {
    clients: "bbm_clients",
    invoices: "bbm_invoices",
    settings: "bbm_settings",
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
    getSettings() {
      return read(KEYS.settings, {
        businessName: "Braised Animation",
        businessEmail: "",
        businessAddress: "",
        currency: "$",
      });
    },
    saveSettings(settings) { write(KEYS.settings, settings); },
    uid,
  };
})();
