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

    // ---- Backup / restore ----
    // Bundles everything into a single portable object.
    exportAll() {
      return {
        app: "braised-business-management",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
          clients: read(KEYS.clients, []),
          invoices: read(KEYS.invoices, []),
          settings: read(KEYS.settings, null),
        },
      };
    },

    // Merge a backup into the current data. Never deletes: existing entries
    // are kept, and imported entries are added, de-duplicated by id (the
    // imported copy wins on an id clash). Returns a summary of what changed.
    importMerge(bundle) {
      const incoming = (bundle && bundle.data) ? bundle.data : bundle;
      if (!incoming || typeof incoming !== "object") {
        throw new Error("This file doesn't look like a Braised backup.");
      }
      const summary = { clientsAdded: 0, invoicesAdded: 0 };

      const mergeById = (existing, imported) => {
        const list = Array.isArray(existing) ? existing.slice() : [];
        const index = new Map(list.map((x, i) => [x.id, i]));
        let added = 0;
        (Array.isArray(imported) ? imported : []).forEach((item) => {
          if (!item || !item.id) return;
          if (index.has(item.id)) {
            list[index.get(item.id)] = item; // update in place
          } else {
            index.set(item.id, list.length);
            list.push(item);
            added += 1;
          }
        });
        return { list, added };
      };

      const c = mergeById(read(KEYS.clients, []), incoming.clients);
      write(KEYS.clients, c.list);
      summary.clientsAdded = c.added;

      const i = mergeById(read(KEYS.invoices, []), incoming.invoices);
      write(KEYS.invoices, i.list);
      summary.invoicesAdded = i.added;

      // Only adopt imported settings if the user hasn't set their own yet.
      if (incoming.settings && !read(KEYS.settings, null)) {
        write(KEYS.settings, incoming.settings);
      }
      return summary;
    },
  };
})();
