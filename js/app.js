// App state
let clients = Storage.getClients();
let invoices = Storage.getInvoices();
let settings = Storage.getSettings();
let currentInvoiceId = null;   // invoice being edited
let viewingInvoiceId = null;   // invoice being viewed/sent
let editingClientId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtMoney(n) {
  const sym = settings.currency || "$";
  return sym + (Number(n) || 0).toFixed(2);
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function clientName(id) {
  const c = clients.find((c) => c.id === id);
  return c ? c.name : "—";
}

function invoiceTotal(inv) {
  const subtotal = inv.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const tax = subtotal * ((Number(inv.taxRate) || 0) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

// Sum of recorded payments. Falls back to the full total for legacy invoices
// that were marked "paid" before per-payment tracking existed.
function amountPaid(inv) {
  const recorded = (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (recorded === 0 && inv.status === "paid") return invoiceTotal(inv).total;
  return recorded;
}

function balanceDue(inv) {
  return Math.max(0, invoiceTotal(inv).total - amountPaid(inv));
}

function effectiveStatus(inv) {
  if (inv.status === "sent" && inv.dueDate) {
    const due = new Date(inv.dueDate + "T00:00:00");
    if (due < new Date(new Date().toDateString())) return "overdue";
  }
  return inv.status;
}

// ---------- Navigation ----------
function showView(name) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  $$(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

$$(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "dashboard") renderDashboard();
    if (btn.dataset.view === "invoices") renderInvoicesTable();
    if (btn.dataset.view === "clients") renderClientsTable();
    if (btn.dataset.view === "reports") renderReports();
    if (btn.dataset.view === "settings") { renderSettingsForm(); renderDataSummary(); }
  });
});

// ---------- Dashboard ----------
function renderDashboard() {
  let outstanding = 0, overdue = 0, received = 0, draft = 0;
  invoices.forEach((inv) => {
    const { total } = invoiceTotal(inv);
    const st = effectiveStatus(inv);
    received += amountPaid(inv);           // actual cash collected, incl. partials
    if (st === "overdue") overdue += balanceDue(inv);
    else if (st === "sent") outstanding += balanceDue(inv);
    else if (st === "draft") draft += total;
  });
  const paid = received;
  $("#stat-outstanding").textContent = fmtMoney(outstanding);
  $("#stat-overdue").textContent = fmtMoney(overdue);
  $("#stat-paid").textContent = fmtMoney(paid);
  $("#stat-draft").textContent = fmtMoney(draft);

  const recent = [...invoices].sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || "")).slice(0, 6);
  const tbody = $("#recent-invoices-table tbody");
  tbody.innerHTML = "";
  if (recent.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="6" class="empty-state">No invoices yet. Create your first one from the Invoices tab.</td></tr>`;
    return;
  }
  recent.forEach((inv) => {
    const { total } = invoiceTotal(inv);
    const st = effectiveStatus(inv);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${inv.number}</td><td>${clientName(inv.clientId)}</td><td>${fmtDate(inv.issueDate)}</td><td>${fmtDate(inv.dueDate)}</td><td>${fmtMoney(total)}</td><td><span class="status-badge status-${st}">${st}</span></td>`;
    tr.addEventListener("click", () => openInvoiceView(inv.id));
    tbody.appendChild(tr);
  });
}

// ---------- Invoices list ----------
function renderInvoicesTable() {
  const search = ($("#invoice-search").value || "").toLowerCase();
  const statusFilter = $("#invoice-filter-status").value;
  const tbody = $("#invoices-table tbody");
  tbody.innerHTML = "";

  let list = [...invoices].sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
  list = list.filter((inv) => {
    const st = effectiveStatus(inv);
    if (statusFilter && st !== statusFilter) return false;
    if (search) {
      const hay = (inv.number + " " + clientName(inv.clientId)).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="7" class="empty-state">No invoices found.</td></tr>`;
    return;
  }

  list.forEach((inv) => {
    const { total } = invoiceTotal(inv);
    const st = effectiveStatus(inv);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${inv.number}</td><td>${clientName(inv.clientId)}</td><td>${fmtDate(inv.issueDate)}</td><td>${fmtDate(inv.dueDate)}</td><td>${fmtMoney(total)}</td><td><span class="status-badge status-${st}">${st}</span></td><td><button class="btn btn-small btn-danger" data-id="${inv.id}">Delete</button></td>`;
    tr.querySelector("td:last-child").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this invoice?")) {
        invoices = invoices.filter((i) => i.id !== inv.id);
        Storage.saveInvoices(invoices);
        renderInvoicesTable();
      }
    });
    tr.addEventListener("click", () => openInvoiceView(inv.id));
    tbody.appendChild(tr);
  });
}

$("#invoice-search").addEventListener("input", renderInvoicesTable);
$("#invoice-filter-status").addEventListener("change", renderInvoicesTable);

// ---------- Invoice editor ----------
function populateClientSelect() {
  const sel = $("#inv-client");
  sel.innerHTML = clients.map((c) => `<option value="${c.id}">${c.name}${c.company ? " — " + c.company : ""}</option>`).join("");
}

function nextInvoiceNumber() {
  const n = invoices.length + 1;
  return "INV-" + String(n).padStart(4, "0");
}

function addItemRow(item) {
  item = item || { description: "", qty: 1, rate: 0 };
  const tbody = $("#items-tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="item-desc" value="${item.description || ""}" placeholder="Description"></td>
    <td><input type="number" class="item-qty" value="${item.qty}" min="0" step="1"></td>
    <td><input type="number" class="item-rate" value="${item.rate}" min="0" step="0.01"></td>
    <td class="item-amount">${fmtMoney((item.qty || 0) * (item.rate || 0))}</td>
    <td><button class="btn btn-small btn-danger">✕</button></td>
  `;
  tr.querySelector(".item-qty").addEventListener("input", () => updateItemAmount(tr));
  tr.querySelector(".item-rate").addEventListener("input", () => updateItemAmount(tr));
  tr.querySelector("button").addEventListener("click", () => { tr.remove(); recalcTotals(); });
  tbody.appendChild(tr);
}

function updateItemAmount(tr) {
  const qty = Number(tr.querySelector(".item-qty").value) || 0;
  const rate = Number(tr.querySelector(".item-rate").value) || 0;
  tr.querySelector(".item-amount").textContent = fmtMoney(qty * rate);
  recalcTotals();
}

function recalcTotals() {
  const rows = $$("#items-tbody tr");
  let subtotal = 0;
  rows.forEach((tr) => {
    const qty = Number(tr.querySelector(".item-qty").value) || 0;
    const rate = Number(tr.querySelector(".item-rate").value) || 0;
    subtotal += qty * rate;
  });
  const taxRate = Number($("#inv-tax-rate").value) || 0;
  const tax = subtotal * (taxRate / 100);
  $("#totals-subtotal").textContent = fmtMoney(subtotal);
  $("#totals-tax").textContent = fmtMoney(tax);
  $("#totals-grand").textContent = fmtMoney(subtotal + tax);
}

$("#inv-tax-rate").addEventListener("input", recalcTotals);
$("#btn-add-item").addEventListener("click", () => addItemRow());

function openInvoiceEditor(invoiceId) {
  if (clients.length === 0) {
    alert("Add a client first before creating an invoice.");
    showView("clients");
    return;
  }
  currentInvoiceId = invoiceId || null;
  populateClientSelect();
  $("#items-tbody").innerHTML = "";

  if (invoiceId) {
    const inv = invoices.find((i) => i.id === invoiceId);
    $("#editor-title").textContent = "Edit Invoice";
    $("#inv-client").value = inv.clientId;
    $("#inv-number").value = inv.number;
    $("#inv-issue-date").value = inv.issueDate;
    $("#inv-due-date").value = inv.dueDate;
    $("#inv-tax-rate").value = inv.taxRate;
    $("#inv-status").value = inv.status;
    $("#inv-notes").value = inv.notes || "";
    inv.items.forEach(addItemRow);
  } else {
    $("#editor-title").textContent = "New Invoice";
    $("#inv-client").selectedIndex = 0;
    $("#inv-number").value = nextInvoiceNumber();
    $("#inv-issue-date").value = new Date().toISOString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + 14);
    $("#inv-due-date").value = due.toISOString().slice(0, 10);
    $("#inv-tax-rate").value = 0;
    $("#inv-status").value = "draft";
    $("#inv-notes").value = "";
    addItemRow();
  }
  recalcTotals();
  showView("invoice-editor");
}

$("#btn-new-invoice").addEventListener("click", () => openInvoiceEditor(null));
$("#btn-cancel-invoice").addEventListener("click", () => showView("invoices"));

$("#btn-save-invoice").addEventListener("click", () => {
  const items = [...$$("#items-tbody tr")].map((tr) => ({
    description: tr.querySelector(".item-desc").value.trim(),
    qty: Number(tr.querySelector(".item-qty").value) || 0,
    rate: Number(tr.querySelector(".item-rate").value) || 0,
  })).filter((it) => it.description || it.qty || it.rate);

  if (!$("#inv-client").value) { alert("Select a client."); return; }
  if (items.length === 0) { alert("Add at least one line item."); return; }

  const data = {
    clientId: $("#inv-client").value,
    number: $("#inv-number").value.trim() || nextInvoiceNumber(),
    issueDate: $("#inv-issue-date").value,
    dueDate: $("#inv-due-date").value,
    taxRate: Number($("#inv-tax-rate").value) || 0,
    status: $("#inv-status").value,
    notes: $("#inv-notes").value.trim(),
    items,
  };

  if (currentInvoiceId) {
    const idx = invoices.findIndex((i) => i.id === currentInvoiceId);
    invoices[idx] = { ...invoices[idx], ...data };
  } else {
    invoices.push({ id: Storage.uid(), ...data });
  }
  Storage.saveInvoices(invoices);
  showView("invoices");
  renderInvoicesTable();
});

// ---------- Invoice view / send ----------
function openInvoiceView(invoiceId) {
  viewingInvoiceId = invoiceId;
  const inv = invoices.find((i) => i.id === invoiceId);
  const client = clients.find((c) => c.id === inv.clientId) || {};
  const { subtotal, tax, total } = invoiceTotal(inv);
  const paid = amountPaid(inv);
  const balance = balanceDue(inv);
  const st = effectiveStatus(inv);

  const itemsHtml = inv.items.map((it) => `
    <tr>
      <td>${escapeHtml(it.description)}</td>
      <td>${it.qty}</td>
      <td>${fmtMoney(it.rate)}</td>
      <td>${fmtMoney(it.qty * it.rate)}</td>
    </tr>`).join("");

  $("#invoice-paper").innerHTML = `
    <div class="inv-head">
      <div>
        <h2>${escapeHtml(settings.businessName || "Your Business")}</h2>
        <div class="muted">${escapeHtml(settings.businessEmail || "")}</div>
        <div class="muted">${escapeHtml(settings.businessAddress || "").replace(/\n/g, "<br>")}</div>
      </div>
      <div style="text-align:right;">
        <h2>Invoice ${escapeHtml(inv.number)}</h2>
        <div class="muted">Status: <span class="status-badge status-${st}">${st}</span></div>
        <div class="muted">Issued ${fmtDate(inv.issueDate)}</div>
        <div class="muted">Due ${fmtDate(inv.dueDate)}</div>
      </div>
    </div>
    <div>
      <strong>Bill To</strong>
      <div>${escapeHtml(client.name || "")}</div>
      <div class="muted">${escapeHtml(client.company || "")}</div>
      <div class="muted">${escapeHtml(client.email || "")}</div>
      <div class="muted">${escapeHtml(client.address || "").replace(/\n/g, "<br>")}</div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="inv-totals">
      <div class="totals-row"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
      <div class="totals-row"><span>Tax</span><span>${fmtMoney(tax)}</span></div>
      <div class="totals-row totals-grand"><span>Total</span><span>${fmtMoney(total)}</span></div>
      ${paid > 0 ? `<div class="totals-row"><span>Amount Paid</span><span>−${fmtMoney(paid)}</span></div>
      <div class="totals-row totals-grand"><span>Balance Due</span><span>${fmtMoney(balance)}</span></div>` : ""}
    </div>
    ${inv.notes ? `<div style="margin-top:20px;"><strong>Notes</strong><p class="muted">${escapeHtml(inv.notes).replace(/\n/g, "<br>")}</p></div>` : ""}
  `;
  renderPaymentsPanel(inv);
  showView("invoice-view");
}

// ---------- Payments ----------
function renderPaymentsPanel(inv) {
  const panel = $("#payments-panel");
  const payments = inv.payments || [];
  const paid = amountPaid(inv);
  const balance = balanceDue(inv);
  const rows = payments.length
    ? payments
        .map((p) => `<tr class="no-hover">
            <td>${fmtDate(p.date)}</td>
            <td>${fmtMoney(p.amount)}</td>
            <td>${escapeHtml(p.method || "")}</td>
            <td>${escapeHtml(p.note || "")}</td>
            <td><button class="btn btn-small btn-danger" data-pay-id="${p.id}">Delete</button></td>
          </tr>`)
        .join("")
    : `<tr class="no-hover"><td colspan="5" class="empty-state">No payments recorded yet.</td></tr>`;

  panel.innerHTML = `
    <div class="payments-head">
      <h2 class="section-title" style="margin:0;">Payments</h2>
      <div class="pay-summary">
        <span>Paid <strong class="success">${fmtMoney(paid)}</strong></span>
        <span>Balance <strong class="${balance > 0 ? "danger" : "success"}">${fmtMoney(balance)}</strong></span>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Note</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  panel.querySelectorAll("[data-pay-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this payment?")) return;
      inv.payments = (inv.payments || []).filter((p) => p.id !== btn.dataset.payId);
      // Re-open the paid flag if the invoice is no longer fully covered.
      if (inv.status === "paid" && balanceDue(inv) > 0.005) inv.status = "sent";
      Storage.saveInvoices(invoices);
      openInvoiceView(inv.id);
    });
  });
}

$("#btn-record-payment").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  if (!inv) return;
  $("#pay-date").value = new Date().toISOString().slice(0, 10);
  $("#pay-amount").value = balanceDue(inv).toFixed(2);
  $("#pay-method").value = "";
  $("#pay-note").value = "";
  $("#payment-modal-backdrop").classList.add("active");
});

$("#btn-cancel-payment").addEventListener("click", () => $("#payment-modal-backdrop").classList.remove("active"));

$("#btn-save-payment").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  if (!inv) return;
  const amount = Number($("#pay-amount").value);
  if (!amount || amount <= 0) { alert("Enter a payment amount greater than zero."); return; }
  const payment = {
    id: Storage.uid(),
    date: $("#pay-date").value || new Date().toISOString().slice(0, 10),
    amount,
    method: $("#pay-method").value.trim(),
    note: $("#pay-note").value.trim(),
  };
  inv.payments = (inv.payments || []).concat(payment);
  // Auto-advance status: a payment means it's no longer a draft, and a fully
  // covered balance marks it paid.
  if (inv.status === "draft") inv.status = "sent";
  if (balanceDue(inv) <= 0.005) inv.status = "paid";
  Storage.saveInvoices(invoices);
  $("#payment-modal-backdrop").classList.remove("active");
  openInvoiceView(inv.id);
});

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#btn-back-from-view").addEventListener("click", () => { showView("invoices"); renderInvoicesTable(); });
$("#btn-edit-invoice").addEventListener("click", () => openInvoiceEditor(viewingInvoiceId));

$("#btn-print-invoice").addEventListener("click", () => {
  $("#view-invoice-view").classList.add("printing");
  window.print();
  setTimeout(() => $("#view-invoice-view").classList.remove("printing"), 500);
});

$("#btn-download-pdf").addEventListener("click", async () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  const btn = $("#btn-download-pdf");
  const originalLabel = btn.textContent;
  btn.textContent = "Generating...";
  btn.disabled = true;
  try {
    const node = $("#invoice-paper");
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#fdfdfb" });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`${inv.number}.pdf`);
  } catch (e) {
    alert("Couldn't generate PDF. Try Print instead.");
  } finally {
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

$("#btn-send-invoice").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  const client = clients.find((c) => c.id === inv.clientId);
  if (!client || !client.email) {
    alert("This client has no email address on file. Add one in Clients.");
    return;
  }
  const { total } = invoiceTotal(inv);
  const subject = encodeURIComponent(`Invoice ${inv.number} from ${settings.businessName || "Your Business"}`);
  const body = encodeURIComponent(
    `Hi ${client.name},\n\nPlease find invoice ${inv.number} for ${fmtMoney(total)}, due ${fmtDate(inv.dueDate)}.\n\n` +
    inv.items.map((it) => `- ${it.description}: ${it.qty} x ${fmtMoney(it.rate)} = ${fmtMoney(it.qty * it.rate)}`).join("\n") +
    `\n\nTotal due: ${fmtMoney(total)}\n\n${inv.notes || ""}\n\nThanks,\n${settings.businessName || ""}`
  );
  window.location.href = `mailto:${client.email}?subject=${subject}&body=${body}`;

  if (inv.status === "draft") {
    inv.status = "sent";
    Storage.saveInvoices(invoices);
    openInvoiceView(inv.id);
  }
});

// ---------- Clients ----------
function renderClientsTable() {
  const tbody = $("#clients-table tbody");
  tbody.innerHTML = "";
  if (clients.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="4" class="empty-state">No clients yet.</td></tr>`;
    return;
  }
  clients.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.company || "")}</td><td>${escapeHtml(c.email || "")}</td><td><button class="btn btn-small" data-act="edit">Edit</button> <button class="btn btn-small btn-danger" data-act="del">Delete</button></td>`;
    tr.classList.add("no-hover");
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openClientModal(c.id));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (invoices.some((i) => i.clientId === c.id)) {
        alert("Can't delete a client with existing invoices.");
        return;
      }
      if (confirm("Delete this client?")) {
        clients = clients.filter((x) => x.id !== c.id);
        Storage.saveClients(clients);
        renderClientsTable();
      }
    });
    tbody.appendChild(tr);
  });
}

function openClientModal(clientId) {
  editingClientId = clientId || null;
  const c = clientId ? clients.find((c) => c.id === clientId) : { name: "", company: "", email: "", address: "" };
  $("#client-modal-title").textContent = clientId ? "Edit Client" : "New Client";
  $("#client-name").value = c.name || "";
  $("#client-company").value = c.company || "";
  $("#client-email").value = c.email || "";
  $("#client-address").value = c.address || "";
  $("#client-modal-backdrop").classList.add("active");
}

$("#btn-new-client").addEventListener("click", () => openClientModal(null));
$("#btn-cancel-client").addEventListener("click", () => $("#client-modal-backdrop").classList.remove("active"));

$("#btn-save-client").addEventListener("click", () => {
  const name = $("#client-name").value.trim();
  if (!name) { alert("Client name is required."); return; }
  const data = {
    name,
    company: $("#client-company").value.trim(),
    email: $("#client-email").value.trim(),
    address: $("#client-address").value.trim(),
  };
  if (editingClientId) {
    const idx = clients.findIndex((c) => c.id === editingClientId);
    clients[idx] = { ...clients[idx], ...data };
  } else {
    clients.push({ id: Storage.uid(), ...data });
  }
  Storage.saveClients(clients);
  $("#client-modal-backdrop").classList.remove("active");
  renderClientsTable();
});

// ---------- Settings ----------
function renderSettingsForm() {
  $("#set-business-name").value = settings.businessName || "";
  $("#set-business-email").value = settings.businessEmail || "";
  $("#set-currency").value = settings.currency || "$";
  $("#set-business-address").value = settings.businessAddress || "";
}

$("#btn-save-settings").addEventListener("click", () => {
  settings = {
    businessName: $("#set-business-name").value.trim(),
    businessEmail: $("#set-business-email").value.trim(),
    currency: $("#set-currency").value.trim() || "$",
    businessAddress: $("#set-business-address").value.trim(),
  };
  Storage.saveSettings(settings);
  alert("Settings saved.");
});

// ---------- Data & backup ----------
function renderDataSummary() {
  const el = $("#data-summary");
  if (!el) return;
  el.textContent = `Currently stored in this browser: ${invoices.length} invoice${invoices.length === 1 ? "" : "s"} and ${clients.length} client${clients.length === 1 ? "" : "s"}.`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#btn-backup").addEventListener("click", () => {
  const bundle = Storage.exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`braised-backup-${stamp}.json`, JSON.stringify(bundle, null, 2), "application/json");
});

$("#btn-restore").addEventListener("click", () => $("#restore-file").click());

$("#restore-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const bundle = JSON.parse(reader.result);
      const summary = Storage.importMerge(bundle);
      // Reload in-memory state from storage after the merge.
      clients = Storage.getClients();
      invoices = Storage.getInvoices();
      settings = Storage.getSettings();
      renderDashboard();
      renderInvoicesTable();
      renderClientsTable();
      renderSettingsForm();
      renderDataSummary();
      alert(`Restore complete. Added ${summary.invoicesAdded} invoice(s) and ${summary.clientsAdded} client(s). Nothing was deleted.`);
    } catch (err) {
      alert("Couldn't restore this file. " + (err.message || "Make sure it's a Braised backup file."));
    } finally {
      e.target.value = ""; // allow re-importing the same file later
    }
  };
  reader.readAsText(file);
});

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

$("#btn-export-csv").addEventListener("click", () => {
  if (invoices.length === 0) { alert("No invoices to export yet."); return; }
  const header = ["Invoice #", "Client", "Company", "Issue Date", "Due Date", "Status", "Subtotal", "Tax", "Total", "Notes"];
  const rows = [...invoices]
    .sort((a, b) => (a.issueDate || "").localeCompare(b.issueDate || ""))
    .map((inv) => {
      const client = clients.find((c) => c.id === inv.clientId) || {};
      const { subtotal, tax, total } = invoiceTotal(inv);
      return [
        inv.number, client.name || "", client.company || "",
        inv.issueDate || "", inv.dueDate || "", effectiveStatus(inv),
        subtotal.toFixed(2), tax.toFixed(2), total.toFixed(2), inv.notes || "",
      ].map(csvCell).join(",");
    });
  const csv = [header.map(csvCell).join(","), ...rows].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`braised-invoices-${stamp}.csv`, csv, "text/csv");
});

// ---------- Reports ----------
function invoiceYear(inv) {
  return (inv.issueDate || "").slice(0, 4);
}

function populateReportYears() {
  const sel = $("#report-year");
  const years = [...new Set(invoices.map(invoiceYear).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const thisYear = String(new Date().getFullYear());
  if (!years.includes(thisYear)) years.unshift(thisYear);
  const prev = sel.value;
  sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  sel.value = years.includes(prev) ? prev : years[0];
}

function renderReports() {
  populateReportYears();
  const year = $("#report-year").value;
  const inYear = invoices.filter((inv) => invoiceYear(inv) === year);

  let invoiced = 0, collected = 0, tax = 0, outstanding = 0;
  const months = new Array(12).fill(0);
  const byClient = new Map();

  inYear.forEach((inv) => {
    const t = invoiceTotal(inv);
    const paid = amountPaid(inv);
    invoiced += t.total;
    collected += paid;
    tax += t.tax;
    outstanding += balanceDue(inv);
    const m = Number((inv.issueDate || "").slice(5, 7)) - 1;
    if (m >= 0 && m < 12) months[m] += t.total;
    const key = inv.clientId || "—";
    const agg = byClient.get(key) || { count: 0, invoiced: 0, collected: 0 };
    agg.count += 1; agg.invoiced += t.total; agg.collected += paid;
    byClient.set(key, agg);
  });

  $("#rep-invoiced").textContent = fmtMoney(invoiced);
  $("#rep-collected").textContent = fmtMoney(collected);
  $("#rep-outstanding").textContent = fmtMoney(outstanding);
  $("#rep-tax").textContent = fmtMoney(tax);

  // Monthly bar chart
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const peak = Math.max(...months, 1);
  $("#rep-monthly").innerHTML = months.map((v, i) => `
    <div class="bar-row">
      <span class="bar-label">${names[i]}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v / peak) * 100}%"></span></span>
      <span class="bar-value">${fmtMoney(v)}</span>
    </div>`).join("");

  // Top clients
  const clientRows = [...byClient.entries()]
    .sort((a, b) => b[1].invoiced - a[1].invoiced)
    .map(([id, agg]) => `<tr class="no-hover"><td>${escapeHtml(clientName(id))}</td><td>${agg.count}</td><td>${fmtMoney(agg.invoiced)}</td><td>${fmtMoney(agg.collected)}</td></tr>`)
    .join("");
  $("#rep-clients-table tbody").innerHTML = clientRows ||
    `<tr class="no-hover"><td colspan="4" class="empty-state">No invoices in ${year}.</td></tr>`;

  // Aging — all unpaid balances across all years
  const today = new Date(new Date().toDateString());
  const aging = invoices
    .filter((inv) => balanceDue(inv) > 0.005 && effectiveStatus(inv) !== "draft")
    .map((inv) => {
      const due = inv.dueDate ? new Date(inv.dueDate + "T00:00:00") : null;
      const days = due ? Math.floor((today - due) / 86400000) : null;
      return { inv, days };
    })
    .sort((a, b) => (b.days ?? -Infinity) - (a.days ?? -Infinity));
  const agingRows = aging.map(({ inv, days }) => {
    const st = effectiveStatus(inv);
    const age = days == null ? "—" : days > 0 ? `${days}d overdue` : `due in ${-days}d`;
    const ageClass = days != null && days > 0 ? "danger" : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${inv.number}</td><td>${escapeHtml(clientName(inv.clientId))}</td><td>${fmtDate(inv.dueDate)}</td><td class="${ageClass}">${age}</td><td>${fmtMoney(balanceDue(inv))}</td><td><span class="status-badge status-${st}">${st}</span></td>`;
    tr.addEventListener("click", () => openInvoiceView(inv.id));
    return tr;
  });
  const agingBody = $("#rep-aging-table tbody");
  agingBody.innerHTML = "";
  if (agingRows.length === 0) {
    agingBody.innerHTML = `<tr class="no-hover"><td colspan="6" class="empty-state">Nothing outstanding — you're all paid up. 🎉</td></tr>`;
  } else {
    agingRows.forEach((tr) => agingBody.appendChild(tr));
  }
}

$("#report-year").addEventListener("change", renderReports);

// ---------- Init ----------
renderDashboard();
renderInvoicesTable();
renderClientsTable();
renderSettingsForm();
renderDataSummary();
