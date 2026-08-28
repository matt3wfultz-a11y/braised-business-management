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

function effectiveStatus(inv) {
  if (inv.status === "sent" && inv.dueDate) {
    const due = new Date(inv.dueDate + "T00:00:00");
    if (due < new Date(new Date().toDateString())) return "overdue";
  }
  return inv.status;
}

// "overdue" is derived by effectiveStatus(), never something you pick — it's a
// sent invoice past its due date. Invoices saved as "overdue" before the status
// dropdowns dropped that option read back as "sent", which is what they mean.
function settableStatus(status) {
  return status === "overdue" ? "sent" : status;
}

// An inline status picker for table rows. The dot keeps the colour-at-a-glance
// the old badge gave; "overdue" is derived so it shows as a past-due marker on
// the stored status rather than as a pickable option.
function statusCellHtml(inv) {
  const st = effectiveStatus(inv);
  const current = settableStatus(inv.status);
  const options = [["draft", "Draft"], ["sent", "Sent"], ["paid", "Paid"]]
    .map(([v, label]) => `<option value="${v}"${v === current ? " selected" : ""}>${label}</option>`)
    .join("");
  return `<div class="status-cell">
      <span class="status-dot status-${st}"></span>
      <select class="status-select">${options}</select>
      ${st === "overdue" ? `<span class="status-hint">past due</span>` : ""}
    </div>`;
}

// Saves on change, and keeps the click off any row handler underneath.
function wireStatusCell(row, inv, afterChange) {
  const cell = row.querySelector(".status-cell");
  cell.addEventListener("click", (e) => e.stopPropagation());
  cell.querySelector("select").addEventListener("change", (e) => {
    inv.status = e.target.value;
    Storage.saveInvoices(invoices);
    afterChange();
  });
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
    if (btn.dataset.view === "settings") renderSettingsForm();
  });
});

// ---------- Dashboard ----------
function renderDashboard() {
  let outstanding = 0, overdue = 0, paid = 0, draft = 0;
  invoices.forEach((inv) => {
    const { total } = invoiceTotal(inv);
    const st = effectiveStatus(inv);
    if (st === "paid") paid += total;
    else if (st === "overdue") overdue += total;
    else if (st === "sent") outstanding += total;
    else if (st === "draft") draft += total;
  });
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
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${inv.number}</td><td>${clientName(inv.clientId)}</td><td>${fmtDate(inv.issueDate)}</td><td>${fmtDate(inv.dueDate)}</td><td>${fmtMoney(total)}</td><td>${statusCellHtml(inv)}</td>`;
    // Re-render the whole dashboard so the stat cards move with the change.
    wireStatusCell(tr, inv, renderDashboard);
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
    tr.innerHTML = `<td>${inv.number}</td><td>${clientName(inv.clientId)}</td><td>${fmtDate(inv.issueDate)}</td><td>${fmtDate(inv.dueDate)}</td><td>${fmtMoney(total)}</td><td><span class="status-badge status-${st}">${st}</span></td><td class="row-actions"><button class="btn btn-small" data-act="copy">Copy</button><button class="btn btn-small btn-danger" data-act="del">Delete</button></td>`;

    const actions = tr.querySelector(".row-actions");
    actions.addEventListener("click", (e) => e.stopPropagation());
    actions.querySelector('[data-act="copy"]').addEventListener("click", () => duplicateInvoice(inv.id));
    actions.querySelector('[data-act="del"]').addEventListener("click", () => {
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

// Highest trailing number across existing invoices, +1. Counting invoices isn't
// enough once any have been deleted or duplicated — that reuses numbers.
function nextInvoiceNumber() {
  let highest = 0;
  invoices.forEach((inv) => {
    const match = String(inv.number || "").match(/(\d+)\s*$/);
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  });
  return "INV-" + String(Math.max(highest, invoices.length) + 1).padStart(4, "0");
}

// toISOString() is UTC, which lands on the wrong day for anyone west of GMT.
function toDateInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Days between issue and due on an existing invoice, so a copy keeps the same terms.
function paymentTermDays(inv) {
  if (!inv.issueDate || !inv.dueDate) return 14;
  const days = Math.round(
    (new Date(inv.dueDate + "T00:00:00") - new Date(inv.issueDate + "T00:00:00")) / 86400000
  );
  return Number.isFinite(days) && days >= 0 ? days : 14;
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

// invoiceId => edit that invoice. copyOf => start a new invoice seeded from it.
function openInvoiceEditor(invoiceId, copyOf) {
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
    $("#inv-status").value = settableStatus(inv.status);
    $("#inv-notes").value = inv.notes || "";
    inv.items.forEach(addItemRow);
  } else {
    // A copy reuses the client, line items, tax rate, notes and payment terms —
    // but gets a fresh number, today's dates and draft status.
    const today = new Date();
    const due = new Date();
    due.setDate(due.getDate() + (copyOf ? paymentTermDays(copyOf) : 14));

    $("#editor-title").textContent = copyOf ? `New Invoice — copy of ${copyOf.number}` : "New Invoice";
    $("#inv-number").value = nextInvoiceNumber();
    $("#inv-issue-date").value = toDateInput(today);
    $("#inv-due-date").value = toDateInput(due);
    $("#inv-status").value = "draft";

    if (copyOf) {
      $("#inv-client").value = copyOf.clientId;
      $("#inv-tax-rate").value = copyOf.taxRate || 0;
      $("#inv-notes").value = copyOf.notes || "";
      (copyOf.items || []).forEach(addItemRow);
    } else {
      $("#inv-client").selectedIndex = 0;
      $("#inv-tax-rate").value = 0;
      $("#inv-notes").value = "";
    }
    if (!$$("#items-tbody tr").length) addItemRow();
  }
  recalcTotals();
  showView("invoice-editor");
}

// Copies are unsaved until the user hits Save, so nothing is created by accident.
function duplicateInvoice(sourceId) {
  const source = invoices.find((i) => i.id === sourceId);
  if (!source) return;
  openInvoiceEditor(null, source);
}

$("#btn-new-invoice").addEventListener("click", () => openInvoiceEditor(null));
$("#btn-duplicate-invoice").addEventListener("click", () => duplicateInvoice(viewingInvoiceId));
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
    </div>
    ${inv.notes ? `<div style="margin-top:20px;"><strong>Notes</strong><p class="muted">${escapeHtml(inv.notes).replace(/\n/g, "<br>")}</p></div>` : ""}
  `;

  // The header control tracks the stored status; the badge above shows the
  // derived one, so flag when they differ rather than looking contradictory.
  $("#view-status").value = settableStatus(inv.status);
  $("#status-hint").textContent = st === "overdue" ? "· past due" : "";

  showView("invoice-view");
}

// Change status straight from the invoice, without a trip through the editor.
$("#view-status").addEventListener("change", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  if (!inv) return;
  inv.status = $("#view-status").value;
  Storage.saveInvoices(invoices);
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

// Renders the on-screen invoice to a jsPDF doc. Shared by Download and Send.
async function buildInvoicePdf() {
  const canvas = await html2canvas($("#invoice-paper"), { scale: 2, backgroundColor: "#fdfdfb" });
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
  return pdf;
}

async function withBusyButton(btn, label, fn) {
  const originalLabel = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
}

$("#btn-download-pdf").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  return withBusyButton($("#btn-download-pdf"), "Generating...", async () => {
    try {
      (await buildInvoicePdf()).save(`${inv.number}.pdf`);
    } catch (e) {
      alert("Couldn't generate PDF. Try Print instead.");
    }
  });
});

// ---------- Sending ----------
function composeEmail(inv, client) {
  const { total } = invoiceTotal(inv);
  const business = settings.businessName || "Your Business";
  const subject = `Invoice ${inv.number} from ${business}`;
  const body =
    `Hi ${client.name},\n\nPlease find invoice ${inv.number} for ${fmtMoney(total)}, due ${fmtDate(inv.dueDate)}.\n\n` +
    inv.items.map((it) => `- ${it.description}: ${it.qty} x ${fmtMoney(it.rate)} = ${fmtMoney(it.qty * it.rate)}`).join("\n") +
    `\n\nTotal due: ${fmtMoney(total)}\n\n${inv.notes || ""}\n\nThanks,\n${settings.businessName || ""}`;
  return { subject, body };
}

function gmailComposeUrl(to, subject, body) {
  return "https://mail.google.com/mail/?view=cm&fs=1&tf=1" +
    "&to=" + encodeURIComponent(to) +
    "&su=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body);
}

function markInvoiceSent(inv) {
  if (inv.status === "draft") {
    inv.status = "sent";
    Storage.saveInvoices(invoices);
    openInvoiceView(inv.id);
  }
}

let pendingSend = null; // { invoiceId, url }

$("#btn-send-invoice").addEventListener("click", () => {
  const inv = invoices.find((i) => i.id === viewingInvoiceId);
  const client = clients.find((c) => c.id === inv.clientId);
  if (!client || !client.email) {
    alert("This client has no email address on file. Add one in Clients.");
    return;
  }
  const { subject, body } = composeEmail(inv, client);

  if ((settings.emailMethod || "gmail") === "mailto") {
    window.location.href =
      `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    markInvoiceSent(inv);
    return;
  }

  // Gmail has no way to attach a file from a compose link, so download the PDF
  // first and hand the user a Gmail tab with everything else already filled in.
  return withBusyButton($("#btn-send-invoice"), "Preparing...", async () => {
    let filename = null;
    try {
      filename = `${inv.number}.pdf`;
      (await buildInvoicePdf()).save(filename);
    } catch (e) {
      filename = null;
    }
    pendingSend = { invoiceId: inv.id, url: gmailComposeUrl(client.email, subject, body) };

    $("#send-modal-title").textContent = `Send Invoice ${inv.number}`;
    $("#send-modal-to").innerHTML = `To <strong>${escapeHtml(client.email)}</strong> — subject and message are filled in for you.`;
    const status = $("#send-modal-status");
    status.classList.toggle("warn", !filename);
    status.innerHTML = filename
      ? `<strong>${escapeHtml(filename)}</strong> has been downloaded. Gmail can't attach it automatically from a link, so drag it into the Gmail window or use the paperclip button before you send.`
      : `The PDF couldn't be generated. You can still send the message, or go back and use Print to save a copy.`;
    $("#send-modal-backdrop").classList.add("active");
  });
});

$("#btn-cancel-send").addEventListener("click", () => {
  pendingSend = null;
  $("#send-modal-backdrop").classList.remove("active");
});

// Opened from a real click so the browser doesn't treat it as a blocked popup.
$("#btn-open-gmail").addEventListener("click", () => {
  if (!pendingSend) return;
  window.open(pendingSend.url, "_blank", "noopener");
  const inv = invoices.find((i) => i.id === pendingSend.invoiceId);
  pendingSend = null;
  $("#send-modal-backdrop").classList.remove("active");
  if (inv) markInvoiceSent(inv);
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
  $("#set-email-method").value = settings.emailMethod || "gmail";
  $("#set-business-address").value = settings.businessAddress || "";
}

$("#btn-save-settings").addEventListener("click", () => {
  settings = {
    businessName: $("#set-business-name").value.trim(),
    businessEmail: $("#set-business-email").value.trim(),
    currency: $("#set-currency").value.trim() || "$",
    emailMethod: $("#set-email-method").value,
    businessAddress: $("#set-business-address").value.trim(),
  };
  Storage.saveSettings(settings);
  alert("Settings saved.");
});

// ---------- Init ----------
renderDashboard();
renderInvoicesTable();
renderClientsTable();
renderSettingsForm();
