// App state
let clients = Storage.getClients();
let invoices = Storage.getInvoices();
let estimates = Storage.getEstimates();
let settings = Storage.getSettings();
let currentInvoiceId = null;   // invoice being edited
let viewingInvoiceId = null;   // invoice being viewed/sent
let currentEstimateId = null;  // estimate being edited
let viewingEstimateId = null;  // estimate being viewed/sent
let editingClientId = null;
let convertingEstimateId = null; // estimate the open invoice editor came from

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtMoney(n) {
  const sym = settings.currency || "$";
  return sym + (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
// the old badge gave; a derived status ("overdue", "expired") colours the dot
// and shows as a hint, rather than appearing as a pickable option.
function statusCellHtml(derived, current, options, hint) {
  const opts = options
    .map(([v, label]) => `<option value="${v}"${v === current ? " selected" : ""}>${label}</option>`)
    .join("");
  return `<div class="status-cell">
      <span class="status-dot status-${derived}"></span>
      <select class="status-select">${opts}</select>
      ${hint ? `<span class="status-hint">${hint}</span>` : ""}
    </div>`;
}

// Keeps the click off any row handler underneath, and hands the new value to
// the caller — which owns saving it.
function wireStatusCell(row, onChange) {
  const cell = row.querySelector(".status-cell");
  cell.addEventListener("click", (e) => e.stopPropagation());
  cell.querySelector("select").addEventListener("change", (e) => onChange(e.target.value));
}

const INVOICE_STATUS_OPTIONS = [["draft", "Draft"], ["sent", "Sent"], ["paid", "Paid"]];

function invoiceStatusCellHtml(inv) {
  const st = effectiveStatus(inv);
  return statusCellHtml(st, settableStatus(inv.status), INVOICE_STATUS_OPTIONS,
    st === "overdue" ? "past due" : "");
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
    if (btn.dataset.view === "estimates") renderEstimatesTable();
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

  renderEstimateStats();

  const recent = [...invoices].sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || "")).slice(0, 6);
  const tbody = $("#recent-invoices-table tbody");
  tbody.innerHTML = "";
  if (recent.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="6" class="empty-state">No invoices yet. Create your first one from the Invoices tab.</td></tr>`;
  } else {
    recent.forEach((inv) => {
      const { total } = invoiceTotal(inv);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${inv.number}</td><td>${clientName(inv.clientId)}</td><td>${fmtDate(inv.issueDate)}</td><td>${fmtDate(inv.dueDate)}</td><td>${fmtMoney(total)}</td><td>${invoiceStatusCellHtml(inv)}</td>`;
      // Re-render the whole dashboard so the stat cards move with the change.
      wireStatusCell(tr, (value) => {
        inv.status = value;
        Storage.saveInvoices(invoices);
        renderDashboard();
      });
      tr.addEventListener("click", () => openInvoiceView(inv.id));
      tbody.appendChild(tr);
    });
  }

  renderRecentEstimates();
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

// Line-item rows work the same in the invoice and estimate editors; only the
// tbody they land in and the totals they drive differ.
function makeItemRow(item, onChange) {
  item = item || { description: "", qty: 1, rate: 0 };
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="item-desc" value="${escapeHtml(item.description)}" placeholder="Description"></td>
    <td><input type="number" class="item-qty" value="${item.qty}" min="0" step="1"></td>
    <td><input type="number" class="item-rate" value="${item.rate}" min="0" step="0.01"></td>
    <td class="item-amount">${fmtMoney((item.qty || 0) * (item.rate || 0))}</td>
    <td><button class="btn btn-small btn-danger">✕</button></td>
  `;
  const refresh = () => {
    const qty = Number(tr.querySelector(".item-qty").value) || 0;
    const rate = Number(tr.querySelector(".item-rate").value) || 0;
    tr.querySelector(".item-amount").textContent = fmtMoney(qty * rate);
    onChange();
  };
  tr.querySelector(".item-qty").addEventListener("input", refresh);
  tr.querySelector(".item-rate").addEventListener("input", refresh);
  tr.querySelector("button").addEventListener("click", () => { tr.remove(); onChange(); });
  return tr;
}

function addItemRow(item) {
  $("#items-tbody").appendChild(makeItemRow(item, recalcTotals));
}

function subtotalOf(tbodySel) {
  let subtotal = 0;
  $$(tbodySel + " tr").forEach((tr) => {
    const qty = Number(tr.querySelector(".item-qty").value) || 0;
    const rate = Number(tr.querySelector(".item-rate").value) || 0;
    subtotal += qty * rate;
  });
  return subtotal;
}

function readItemRows(tbodySel) {
  return [...$$(tbodySel + " tr")].map((tr) => ({
    description: tr.querySelector(".item-desc").value.trim(),
    qty: Number(tr.querySelector(".item-qty").value) || 0,
    rate: Number(tr.querySelector(".item-rate").value) || 0,
  })).filter((it) => it.description || it.qty || it.rate);
}

function recalcTotals() {
  const subtotal = subtotalOf("#items-tbody");
  const taxRate = Number($("#inv-tax-rate").value) || 0;
  const tax = subtotal * (taxRate / 100);
  $("#totals-subtotal").textContent = fmtMoney(subtotal);
  $("#totals-tax").textContent = fmtMoney(tax);
  $("#totals-grand").textContent = fmtMoney(subtotal + tax);
}

$("#inv-tax-rate").addEventListener("input", recalcTotals);
$("#btn-add-item").addEventListener("click", () => addItemRow());

// invoiceId => edit that invoice. seed => start a new invoice pre-filled from
// something else: a copy of another invoice, or an accepted estimate.
// seed = { label, clientId, taxRate, notes, items, termDays, fromEstimateId }
function openInvoiceEditor(invoiceId, seed) {
  if (clients.length === 0) {
    alert("Add a client first before creating an invoice.");
    showView("clients");
    return;
  }
  currentInvoiceId = invoiceId || null;
  convertingEstimateId = (seed && seed.fromEstimateId) || null;
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
    // A seeded invoice reuses the client, line items, tax rate, notes and
    // payment terms — but gets a fresh number, today's dates and draft status.
    const today = new Date();
    const due = new Date();
    due.setDate(due.getDate() + (seed && seed.termDays != null ? seed.termDays : 14));

    $("#editor-title").textContent = seed && seed.label ? `New Invoice — ${seed.label}` : "New Invoice";
    $("#inv-number").value = nextInvoiceNumber();
    $("#inv-issue-date").value = toDateInput(today);
    $("#inv-due-date").value = toDateInput(due);
    $("#inv-status").value = "draft";

    if (seed) {
      $("#inv-client").value = seed.clientId;
      $("#inv-tax-rate").value = seed.taxRate || 0;
      $("#inv-notes").value = seed.notes || "";
      (seed.items || []).forEach(addItemRow);
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
  openInvoiceEditor(null, {
    label: `copy of ${source.number}`,
    clientId: source.clientId,
    taxRate: source.taxRate || 0,
    notes: source.notes || "",
    items: source.items || [],
    termDays: paymentTermDays(source),
  });
}

$("#btn-new-invoice").addEventListener("click", () => openInvoiceEditor(null));
$("#btn-duplicate-invoice").addEventListener("click", () => duplicateInvoice(viewingInvoiceId));
$("#btn-cancel-invoice").addEventListener("click", () => {
  convertingEstimateId = null;
  showView("invoices");
});

$("#btn-save-invoice").addEventListener("click", () => {
  const items = readItemRows("#items-tbody");

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
    const created = { id: Storage.uid(), ...data };
    invoices.push(created);
    linkConvertedEstimate(created);
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

// Blocks a page break shouldn't cut through: their top edges, in CSS pixels
// from the top of the document. Selectors that match nothing (an invoice has no
// scope list, an estimate has no .inv-head) simply contribute nothing.
function pageBreakOffsets(el) {
  const top = el.getBoundingClientRect().top;
  const blocks = el.querySelectorAll(
    ".doc-section, .doc-parties, .doc-def, .doc-totals, .doc-accept, .doc-foot, .inv-head, .inv-totals, tr"
  );
  const offsets = [...blocks].map((b) => b.getBoundingClientRect().top - top);
  return [...new Set(offsets.filter((o) => o > 0))].sort((a, b) => a - b);
}

// Renders an on-screen document element to a jsPDF doc, one A4 page at a time.
// Shared by Download and Send, for both invoices and estimates.
//
// JPEG, not PNG: a canvas PNG of a full page of text embeds at ~22MB, and the
// whole point of the send flow is attaching this to an email. At quality 0.95
// the same page is under half a megabyte with no visible difference.
//
// Pages are cut at the last block boundary that fits rather than at a fixed
// height, so a term or a line item doesn't get sliced in half. jsPDF has no
// clip, so the rest of the image is painted over in the page colour afterwards.
async function buildPdfFrom(el, { margin = 0, background = "#ffffff" } = {}) {
  const cssWidth = el.getBoundingClientRect().width;
  const breaks = pageBreakOffsets(el);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: background });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const usableH = pageH - margin * 2;
  const cuts = breaks.map((b) => (b * imgW) / cssWidth); // CSS px -> points

  for (let y = 0, page = 0; y < imgH - 0.5; page++) {
    let end = Math.min(y + usableH, imgH);
    if (end < imgH) {
      // Never give a page less than a quarter of its height, so an over-tall
      // block falls back to a hard cut instead of stranding a near-empty page.
      const fits = cuts.filter((c) => c > y + usableH * 0.25 && c <= end);
      if (fits.length) end = fits[fits.length - 1];
    }
    if (page > 0) pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, margin - y, imgW, imgH);

    pdf.setFillColor(background);
    if (margin > 0) {
      pdf.rect(0, 0, pageW, margin, "F");
      pdf.rect(0, 0, margin, pageH, "F");
      pdf.rect(pageW - margin, 0, margin, pageH, "F");
    }
    const filled = margin + (end - y);
    if (filled < pageH) pdf.rect(0, filled, pageW, pageH - filled, "F");
    y = end;
  }
  return pdf;
}

const buildInvoicePdf = () => buildPdfFrom($("#invoice-paper"), { background: "#fdfdfb" });

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

let pendingSend = null; // { kind: "invoice" | "estimate", id, url }

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
    pendingSend = { kind: "invoice", id: inv.id, url: gmailComposeUrl(client.email, subject, body) };

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
  const { kind, id, url } = pendingSend;
  window.open(url, "_blank", "noopener");
  pendingSend = null;
  $("#send-modal-backdrop").classList.remove("active");
  if (kind === "estimate") {
    const est = estimates.find((e) => e.id === id);
    if (est) markEstimateSent(est);
  } else {
    const inv = invoices.find((i) => i.id === id);
    if (inv) markInvoiceSent(inv);
  }
});

// ---------- Estimates ----------
// An estimate is the document that comes before an invoice: what the work is,
// what it costs, and what the client is agreeing to. It carries a project
// title, a scope block and a terms block that an invoice doesn't need, and it
// expires instead of falling overdue.

const ESTIMATE_STATUS_OPTIONS = [
  ["draft", "Draft"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"],
];
const ESTIMATE_STATUS_LABELS = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired",
};

const SCOPE_PLACEHOLDER = ["Deliverables", "Ten (10) creative UI motion animations"];
const TERMS_PLACEHOLDER = ["Payment Terms", "30% deposit upon acceptance; 70% on final delivery."];

function estimateTotal(est) {
  const subtotal = (est.items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const tax = subtotal * ((Number(est.taxRate) || 0) / 100);
  const total = subtotal + tax;
  return { subtotal, tax, total, deposit: total * ((Number(est.depositPercent) || 0) / 100) };
}

// "expired" is derived the way invoices derive "overdue" — a sent estimate past
// its valid-until date. Accepted and declined estimates are settled, so they
// never expire out from under you.
function estimateStatus(est) {
  if (est.status === "sent" && est.validUntil) {
    const until = new Date(est.validUntil + "T00:00:00");
    if (until < new Date(new Date().toDateString())) return "expired";
  }
  return est.status;
}

function settableEstimateStatus(status) {
  return status === "expired" ? "sent" : status;
}

function estimateStatusCellHtml(est) {
  const st = estimateStatus(est);
  return statusCellHtml(st, settableEstimateStatus(est.status), ESTIMATE_STATUS_OPTIONS,
    st === "expired" ? "expired" : "");
}

// ---------- Label / detail rows (scope, terms) ----------
function addKvRow(tbodySel, row, placeholder) {
  row = row || { label: "", value: "" };
  const tr = document.createElement("tr");
  tr.className = "no-hover";
  tr.innerHTML = `
    <td><input type="text" class="kv-label" value="${escapeHtml(row.label)}" placeholder="${escapeHtml(placeholder[0])}"></td>
    <td><input type="text" class="kv-value" value="${escapeHtml(row.value)}" placeholder="${escapeHtml(placeholder[1])}"></td>
    <td><button class="btn btn-small btn-danger" title="Remove line">✕</button></td>
  `;
  tr.querySelector("button").addEventListener("click", () => tr.remove());
  $(tbodySel).appendChild(tr);
}

function fillKvRows(tbodySel, rows, placeholder) {
  $(tbodySel).innerHTML = "";
  (rows || []).forEach((row) => addKvRow(tbodySel, row, placeholder));
  if (!$$(tbodySel + " tr").length) addKvRow(tbodySel, null, placeholder);
}

function readKvRows(tbodySel) {
  return [...$$(tbodySel + " tr")].map((tr) => ({
    label: tr.querySelector(".kv-label").value.trim(),
    value: tr.querySelector(".kv-value").value.trim(),
  })).filter((r) => r.label || r.value);
}

// ---------- Estimates list ----------
function renderEstimatesTable() {
  const search = ($("#estimate-search").value || "").toLowerCase();
  const statusFilter = $("#estimate-filter-status").value;
  const tbody = $("#estimates-table tbody");
  tbody.innerHTML = "";

  const list = [...estimates]
    .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""))
    .filter((est) => {
      if (statusFilter && estimateStatus(est) !== statusFilter) return false;
      if (search) {
        const hay = (est.number + " " + clientName(est.clientId) + " " + (est.projectTitle || "")).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

  if (list.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="8" class="empty-state">${
      estimates.length ? "No estimates found." : "No estimates yet. Create your first one with + New Estimate."
    }</td></tr>`;
    return;
  }

  list.forEach((est) => {
    const { total } = estimateTotal(est);
    const st = estimateStatus(est);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(est.number)}</td><td>${escapeHtml(clientName(est.clientId))}</td><td>${escapeHtml(est.projectTitle || "—")}</td><td>${fmtDate(est.issueDate)}</td><td>${fmtDate(est.validUntil)}</td><td>${fmtMoney(total)}</td><td><span class="status-badge status-${st}">${st}</span></td><td class="row-actions"><button class="btn btn-small" data-act="copy">Copy</button><button class="btn btn-small btn-danger" data-act="del">Delete</button></td>`;

    const actions = tr.querySelector(".row-actions");
    actions.addEventListener("click", (e) => e.stopPropagation());
    actions.querySelector('[data-act="copy"]').addEventListener("click", () => duplicateEstimate(est.id));
    actions.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (confirm("Delete this estimate?")) {
        estimates = estimates.filter((e) => e.id !== est.id);
        Storage.saveEstimates(estimates);
        renderEstimatesTable();
      }
    });
    tr.addEventListener("click", () => openEstimateView(est.id));
    tbody.appendChild(tr);
  });
}

$("#estimate-search").addEventListener("input", renderEstimatesTable);
$("#estimate-filter-status").addEventListener("change", renderEstimatesTable);

// ---------- Estimates on the dashboard ----------
function renderEstimateStats() {
  let open = 0, expired = 0, accepted = 0, draft = 0;
  estimates.forEach((est) => {
    const { total } = estimateTotal(est);
    const st = estimateStatus(est);
    if (st === "accepted") accepted += total;
    else if (st === "expired") expired += total;
    else if (st === "sent") open += total;
    else if (st === "draft") draft += total;
  });
  $("#stat-est-open").textContent = fmtMoney(open);
  $("#stat-est-expired").textContent = fmtMoney(expired);
  $("#stat-est-accepted").textContent = fmtMoney(accepted);
  $("#stat-est-draft").textContent = fmtMoney(draft);
}

function renderRecentEstimates() {
  const recent = [...estimates]
    .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || "")).slice(0, 6);
  const tbody = $("#recent-estimates-table tbody");
  tbody.innerHTML = "";
  if (recent.length === 0) {
    tbody.innerHTML = `<tr class="no-hover"><td colspan="7" class="empty-state">No estimates yet. Create your first one from the Estimates tab.</td></tr>`;
    return;
  }
  recent.forEach((est) => {
    const { total } = estimateTotal(est);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(est.number)}</td><td>${escapeHtml(clientName(est.clientId))}</td><td>${escapeHtml(est.projectTitle || "—")}</td><td>${fmtDate(est.issueDate)}</td><td>${fmtDate(est.validUntil)}</td><td>${fmtMoney(total)}</td><td>${estimateStatusCellHtml(est)}</td>`;
    wireStatusCell(tr, (value) => {
      est.status = value;
      Storage.saveEstimates(estimates);
      renderDashboard();
    });
    tr.addEventListener("click", () => openEstimateView(est.id));
    tbody.appendChild(tr);
  });
}

// ---------- Estimate editor ----------
function addEstItemRow(item) {
  $("#est-items-tbody").appendChild(makeItemRow(item, recalcEstimateTotals));
}

function recalcEstimateTotals() {
  const subtotal = subtotalOf("#est-items-tbody");
  const taxRate = Number($("#est-tax-rate").value) || 0;
  const depositPct = Number($("#est-deposit").value) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  $("#est-totals-subtotal").textContent = fmtMoney(subtotal);
  $("#est-totals-tax").textContent = fmtMoney(tax);
  $("#est-totals-grand").textContent = fmtMoney(total);
  $("#est-deposit-label").textContent = `Deposit (${depositPct}%)`;
  $("#est-totals-deposit").textContent = fmtMoney(total * (depositPct / 100));
  $("#est-deposit-row").hidden = depositPct <= 0;
}

$("#est-tax-rate").addEventListener("input", recalcEstimateTotals);
$("#est-deposit").addEventListener("input", recalcEstimateTotals);
$("#btn-add-est-item").addEventListener("click", () => addEstItemRow());
$("#btn-add-scope").addEventListener("click", () => addKvRow("#est-scope-tbody", null, SCOPE_PLACEHOLDER));
$("#btn-add-term").addEventListener("click", () => addKvRow("#est-terms-tbody", null, TERMS_PLACEHOLDER));

function nextEstimateNumber() {
  const prefix = settings.estimatePrefix || "EST-";
  let highest = 0;
  estimates.forEach((est) => {
    const match = String(est.number || "").match(/(\d+)\s*$/);
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  });
  return prefix + String(Math.max(highest, estimates.length) + 1).padStart(4, "0");
}

// Days an existing estimate was good for, so a copy keeps the same window.
function validityDays(est) {
  const fallback = Number(settings.estimateValidDays) || 14;
  if (!est || !est.issueDate || !est.validUntil) return fallback;
  const days = Math.round(
    (new Date(est.validUntil + "T00:00:00") - new Date(est.issueDate + "T00:00:00")) / 86400000
  );
  return Number.isFinite(days) && days >= 0 ? days : fallback;
}

// estimateId => edit it. copyOf => start a new estimate seeded from it.
function openEstimateEditor(estimateId, copyOf) {
  if (clients.length === 0) {
    alert("Add a client first before creating an estimate.");
    showView("clients");
    return;
  }
  currentEstimateId = estimateId || null;
  $("#est-client").innerHTML = clients
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.company ? " — " + escapeHtml(c.company) : ""}</option>`)
    .join("");
  $("#est-items-tbody").innerHTML = "";

  const source = estimateId ? estimates.find((e) => e.id === estimateId) : copyOf;

  if (estimateId) {
    $("#est-editor-title").textContent = "Edit Estimate";
    $("#est-number").value = source.number;
    $("#est-issue-date").value = source.issueDate || "";
    $("#est-valid-until").value = source.validUntil || "";
    $("#est-status").value = settableEstimateStatus(source.status);
  } else {
    // A copy keeps the scope, terms, items and validity window; the dates,
    // number and status start over.
    const until = new Date();
    until.setDate(until.getDate() + validityDays(copyOf));
    $("#est-editor-title").textContent = copyOf ? `New Estimate — copy of ${copyOf.number}` : "New Estimate";
    $("#est-number").value = nextEstimateNumber();
    $("#est-issue-date").value = toDateInput(new Date());
    $("#est-valid-until").value = toDateInput(until);
    $("#est-status").value = "draft";
  }

  const seed = source || {};
  $("#est-client").value = seed.clientId || clients[0].id;
  if (!$("#est-client").value) $("#est-client").selectedIndex = 0;
  $("#est-project").value = seed.projectTitle || "";
  $("#est-tax-rate").value = seed.taxRate || 0;
  $("#est-deposit").value = seed.depositPercent || 0;
  $("#est-notes").value = seed.notes || "";
  $("#est-extra-emails").value = seed.extraEmails || "";
  // A new estimate starts from the saved defaults; an existing one from itself.
  fillKvRows("#est-scope-tbody", seed.scope || settings.estimateScope, SCOPE_PLACEHOLDER);
  fillKvRows("#est-terms-tbody", seed.terms || settings.estimateTerms, TERMS_PLACEHOLDER);
  (seed.items || []).forEach(addEstItemRow);
  if (!$$("#est-items-tbody tr").length) addEstItemRow();

  recalcEstimateTotals();
  showView("estimate-editor");
}

// Copies are unsaved until Save Estimate, so nothing is created by accident.
function duplicateEstimate(sourceId) {
  const source = estimates.find((e) => e.id === sourceId);
  if (source) openEstimateEditor(null, source);
}

$("#btn-new-estimate").addEventListener("click", () => openEstimateEditor(null));
$("#btn-duplicate-estimate").addEventListener("click", () => duplicateEstimate(viewingEstimateId));
$("#btn-edit-estimate").addEventListener("click", () => openEstimateEditor(viewingEstimateId));
$("#btn-cancel-estimate").addEventListener("click", () => { showView("estimates"); renderEstimatesTable(); });

$("#btn-save-estimate").addEventListener("click", () => {
  const items = readItemRows("#est-items-tbody");
  if (!$("#est-client").value) { alert("Select a client."); return; }
  if (items.length === 0) { alert("Add at least one line item."); return; }

  const deposit = Number($("#est-deposit").value) || 0;
  const data = {
    clientId: $("#est-client").value,
    number: $("#est-number").value.trim() || nextEstimateNumber(),
    projectTitle: $("#est-project").value.trim(),
    issueDate: $("#est-issue-date").value,
    validUntil: $("#est-valid-until").value,
    taxRate: Number($("#est-tax-rate").value) || 0,
    depositPercent: Math.min(Math.max(deposit, 0), 100),
    status: $("#est-status").value,
    scope: readKvRows("#est-scope-tbody"),
    terms: readKvRows("#est-terms-tbody"),
    extraEmails: $("#est-extra-emails").value.trim(),
    notes: $("#est-notes").value.trim(),
    items,
  };

  let id = currentEstimateId;
  if (currentEstimateId) {
    const idx = estimates.findIndex((e) => e.id === currentEstimateId);
    estimates[idx] = { ...estimates[idx], ...data };
  } else {
    id = Storage.uid();
    estimates.push({ id, convertedInvoiceId: null, ...data });
  }
  Storage.saveEstimates(estimates);
  // Straight to the document — an estimate is written to be looked at and sent.
  openEstimateView(id);
});

// ---------- The estimate document ----------
// A client's Email field can hold several addresses ("a@x.com, ap@x.com"),
// which is also what a mail link wants, so split it for display.
function splitContacts(raw) {
  return String(raw || "").split(/[,;\n]/).map((e) => e.trim()).filter(Boolean);
}

// The client record holds the standing contacts; an estimate can add extras for
// a one-off — an AP inbox, a producer copied on this job and no other. Both the
// document and the send flow use this list, so what's printed is what's mailed.
function estimateContacts(est, client) {
  const seen = new Set();
  const out = [];
  [...splitContacts(client.email), ...splitContacts(est.extraEmails)].forEach((email) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(email);
  });
  return out;
}

function docDefs(rows) {
  return rows.map((r) => `
        <div class="doc-def">
          <dt>${escapeHtml(r.label)}</dt>
          <dd>${escapeHtml(r.value).replace(/\n/g, "<br>")}</dd>
        </div>`).join("");
}

function estimateDocHtml(est) {
  const client = clients.find((c) => c.id === est.clientId) || {};
  const { subtotal, tax, total, deposit } = estimateTotal(est);
  const st = estimateStatus(est);
  const scope = (est.scope || []).filter((r) => r.label || r.value);
  const terms = (est.terms || []).filter((r) => r.label || r.value);
  const business = settings.businessName || "Your Business";
  const footer = [settings.businessEmail, settings.businessPhone, settings.businessWebsite]
    .filter(Boolean).map(escapeHtml).join(" &nbsp;·&nbsp; ");

  // Draft and sent are the app's business, not the client's — only a settled
  // or lapsed estimate gets stamped on the page they receive.
  const stamped = ["accepted", "declined", "expired"].includes(st);

  const itemRows = (est.items || []).map((it) => `
          <tr>
            <td>${escapeHtml(it.description)}</td>
            <td class="num">${it.qty}</td>
            <td class="num">${fmtMoney(it.rate)}</td>
            <td class="num">${fmtMoney(it.qty * it.rate)}</td>
          </tr>`).join("");

  return `
  <article class="doc">
    <header class="doc-band">
      <div class="doc-band-brand">
        <div class="doc-brand">${escapeHtml(business)}</div>
        ${settings.businessWebsite ? `<div class="doc-brand-meta">${escapeHtml(settings.businessWebsite)}</div>` : ""}
      </div>
      <div class="doc-band-id">
        <div class="doc-kicker">Estimate</div>
        <div class="doc-number">${escapeHtml(est.number)}</div>
        ${stamped ? `<div class="doc-stamp doc-stamp-${st}">${ESTIMATE_STATUS_LABELS[st]}</div>` : ""}
      </div>
    </header>

    <div class="doc-meta">
      <div class="doc-meta-cell"><span>Date</span><strong>${fmtDate(est.issueDate) || "—"}</strong></div>
      <div class="doc-meta-cell"><span>Valid until</span><strong>${fmtDate(est.validUntil) || "—"}</strong></div>
      <div class="doc-meta-cell"><span>Project</span><strong>${escapeHtml(est.projectTitle) || "—"}</strong></div>
      <div class="doc-meta-cell doc-meta-total"><span>Estimated total</span><strong>${fmtMoney(total)}</strong></div>
    </div>

    <div class="doc-body">
      <section class="doc-parties">
        <div class="doc-party">
          <h3 class="doc-section-title">Prepared for</h3>
          <div class="doc-party-name">${escapeHtml(client.company || client.name || "—")}</div>
          ${client.company && client.name ? `<div class="doc-party-line">${escapeHtml(client.name)}</div>` : ""}
          ${client.address ? `<div class="doc-party-line">${escapeHtml(client.address).replace(/\n/g, "<br>")}</div>` : ""}
          ${estimateContacts(est, client).map((e) => `<div class="doc-party-line">${escapeHtml(e)}</div>`).join("")}
        </div>
        <div class="doc-party">
          <h3 class="doc-section-title">Prepared by</h3>
          <div class="doc-party-name">${escapeHtml(business)}</div>
          ${settings.businessAddress ? `<div class="doc-party-line">${escapeHtml(settings.businessAddress).replace(/\n/g, "<br>")}</div>` : ""}
        </div>
      </section>

      ${scope.length ? `
      <section class="doc-section">
        <h3 class="doc-section-title">Project scope</h3>
        <dl class="doc-defs">${docDefs(scope)}
        </dl>
      </section>` : ""}

      <section class="doc-section">
        <h3 class="doc-section-title">Proposal</h3>
        <table class="doc-table">
          <thead>
            <tr>
              <th>Description</th>
              <th class="num col-qty">Qty</th>
              <th class="num col-rate">Rate</th>
              <th class="num col-amount">Amount</th>
            </tr>
          </thead>
          <tbody>${itemRows}
          </tbody>
        </table>
        <div class="doc-totals">
          <div class="doc-total-row"><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
          ${est.taxRate ? `<div class="doc-total-row"><span>Tax (${est.taxRate}%)</span><span>${fmtMoney(tax)}</span></div>` : ""}
          <div class="doc-total-row doc-total-grand"><span>Total</span><span>${fmtMoney(total)}</span></div>
          ${deposit ? `<div class="doc-total-row doc-total-deposit"><span>${est.depositPercent}% deposit on acceptance</span><span>${fmtMoney(deposit)}</span></div>` : ""}
        </div>
      </section>

      ${terms.length ? `
      <section class="doc-section">
        <h3 class="doc-section-title">Terms &amp; conditions</h3>
        <dl class="doc-defs doc-defs-stacked">${docDefs(terms)}
        </dl>
      </section>` : ""}

      ${est.notes ? `
      <section class="doc-section">
        <h3 class="doc-section-title">Notes</h3>
        <p class="doc-notes">${escapeHtml(est.notes).replace(/\n/g, "<br>")}</p>
      </section>` : ""}

      <section class="doc-accept">
        <h3 class="doc-accept-title">Acceptance</h3>
        <p>Signing below approves the scope, schedule and pricing set out above${
          est.validUntil ? ` and must be returned by ${fmtDate(est.validUntil)}` : ""
        }. Work begins once this estimate is signed${
          deposit ? " and the deposit has cleared" : ""
        }.</p>
        <div class="doc-sign">
          <div class="doc-sign-line">Authorised signature</div>
          <div class="doc-sign-line">Printed name</div>
          <div class="doc-sign-line">Date</div>
        </div>
      </section>
    </div>

    ${footer ? `<footer class="doc-foot">${footer}</footer>` : ""}
  </article>`;
}

function openEstimateView(estimateId) {
  const est = estimates.find((e) => e.id === estimateId);
  if (!est) return;
  viewingEstimateId = estimateId;
  $("#estimate-paper").innerHTML = estimateDocHtml(est);

  const st = estimateStatus(est);
  $("#est-view-status").value = settableEstimateStatus(est.status);
  $("#est-status-hint").textContent = st === "expired" ? "· expired" : "";

  // Where this estimate ended up, kept outside the document so it never prints.
  const invoice = est.convertedInvoiceId && invoices.find((i) => i.id === est.convertedInvoiceId);
  const note = $("#est-converted-note");
  note.hidden = !invoice;
  if (invoice) note.textContent = `Invoiced as ${invoice.number} on ${fmtDate(invoice.issueDate)}.`;

  showView("estimate-view");
}

$("#est-view-status").addEventListener("change", () => {
  const est = estimates.find((e) => e.id === viewingEstimateId);
  if (!est) return;
  est.status = $("#est-view-status").value;
  Storage.saveEstimates(estimates);
  openEstimateView(est.id);
});

$("#btn-back-from-est-view").addEventListener("click", () => {
  showView("estimates");
  renderEstimatesTable();
});

$("#btn-print-estimate").addEventListener("click", () => {
  $("#view-estimate-view").classList.add("printing");
  window.print();
  setTimeout(() => $("#view-estimate-view").classList.remove("printing"), 500);
});

// The estimate sits on the page as a card, so it gets a page margin rather than
// running edge to edge like the invoice does.
const buildEstimatePdf = () => buildPdfFrom($("#estimate-paper .doc"), { margin: 26 });

$("#btn-download-est-pdf").addEventListener("click", () => {
  const est = estimates.find((e) => e.id === viewingEstimateId);
  return withBusyButton($("#btn-download-est-pdf"), "Generating...", async () => {
    try {
      (await buildEstimatePdf()).save(`${est.number}.pdf`);
    } catch (e) {
      alert("Couldn't generate PDF. Try Print instead.");
    }
  });
});

// ---------- Converting an accepted estimate into an invoice ----------
$("#btn-convert-estimate").addEventListener("click", () => {
  const est = estimates.find((e) => e.id === viewingEstimateId);
  if (!est) return;
  const already = est.convertedInvoiceId && invoices.find((i) => i.id === est.convertedInvoiceId);
  if (already && !confirm(`This estimate is already invoiced as ${already.number}. Create another invoice from it?`)) return;

  // Carry the payment terms across as the invoice note, so what the client
  // agreed to is what they get billed under.
  const paymentTerm = (est.terms || []).find((t) => /payment/i.test(t.label || ""));
  const notes = [
    `Per estimate ${est.number}${est.projectTitle ? " — " + est.projectTitle : ""}.`,
    paymentTerm ? paymentTerm.value : "",
    est.notes || "",
  ].filter(Boolean).join("\n\n");

  openInvoiceEditor(null, {
    label: `from estimate ${est.number}`,
    clientId: est.clientId,
    taxRate: est.taxRate || 0,
    notes,
    items: est.items || [],
    fromEstimateId: est.id,
  });
});

// Runs when the converted invoice is actually saved — backing out of the editor
// leaves the estimate untouched.
function linkConvertedEstimate(invoice) {
  if (!convertingEstimateId) return;
  const est = estimates.find((e) => e.id === convertingEstimateId);
  convertingEstimateId = null;
  if (!est) return;
  est.convertedInvoiceId = invoice.id;
  // Invoicing it is the clearest possible signal the client said yes.
  if (est.status === "draft" || est.status === "sent") est.status = "accepted";
  Storage.saveEstimates(estimates);
}

// ---------- Sending an estimate ----------
function composeEstimateEmail(est, client) {
  const { total, deposit } = estimateTotal(est);
  const business = settings.businessName || "Your Business";
  const subject = `Estimate ${est.number}${est.projectTitle ? " — " + est.projectTitle : ""} from ${business}`;
  const body =
    `Hi ${client.name || "there"},\n\n` +
    `Here's the estimate for ${est.projectTitle || "the project"} — ${fmtMoney(total)} total` +
    (est.validUntil ? `, valid through ${fmtDate(est.validUntil)}` : "") + `.\n\n` +
    (est.items || []).map((it) => `- ${it.description}: ${it.qty} x ${fmtMoney(it.rate)} = ${fmtMoney(it.qty * it.rate)}`).join("\n") +
    `\n\nTotal: ${fmtMoney(total)}` +
    (deposit ? `\nDeposit on acceptance (${est.depositPercent}%): ${fmtMoney(deposit)}` : "") +
    `\n\nThe attached PDF has the full scope and terms. Happy to walk through any of it.\n\nThanks,\n${business}`;
  return { subject, body };
}

function markEstimateSent(est) {
  if (est.status === "draft") {
    est.status = "sent";
    Storage.saveEstimates(estimates);
    openEstimateView(est.id);
  }
}

$("#btn-send-estimate").addEventListener("click", () => {
  const est = estimates.find((e) => e.id === viewingEstimateId);
  const client = clients.find((c) => c.id === est.clientId) || {};
  // Everyone listed on the document, so the recipients match what's printed.
  const to = estimateContacts(est, client).join(", ");
  if (!to) {
    alert("No email address for this estimate. Add one to the client in Clients, or use Additional Contacts on the estimate.");
    return;
  }
  const { subject, body } = composeEstimateEmail(est, client);

  if ((settings.emailMethod || "gmail") === "mailto") {
    window.location.href =
      `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    markEstimateSent(est);
    return;
  }

  return withBusyButton($("#btn-send-estimate"), "Preparing...", async () => {
    let filename = null;
    try {
      filename = `${est.number}.pdf`;
      (await buildEstimatePdf()).save(filename);
    } catch (e) {
      filename = null;
    }
    pendingSend = { kind: "estimate", id: est.id, url: gmailComposeUrl(to, subject, body) };

    $("#send-modal-title").textContent = `Send Estimate ${est.number}`;
    $("#send-modal-to").innerHTML = `To <strong>${escapeHtml(to)}</strong> — subject and message are filled in for you.`;
    const status = $("#send-modal-status");
    status.classList.toggle("warn", !filename);
    status.innerHTML = filename
      ? `<strong>${escapeHtml(filename)}</strong> has been downloaded. Gmail can't attach it automatically from a link, so drag it into the Gmail window or use the paperclip button before you send.`
      : `The PDF couldn't be generated. You can still send the message, or go back and use Print to save a copy.`;
    $("#send-modal-backdrop").classList.add("active");
  });
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
      if (invoices.some((i) => i.clientId === c.id) || estimates.some((e) => e.clientId === c.id)) {
        alert("Can't delete a client with existing invoices or estimates.");
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
  $("#set-business-phone").value = settings.businessPhone || "";
  $("#set-business-website").value = settings.businessWebsite || "";
  $("#set-estimate-prefix").value = settings.estimatePrefix || "EST-";
  $("#set-estimate-valid-days").value = settings.estimateValidDays || 14;
  fillKvRows("#set-scope-tbody", settings.estimateScope, SCOPE_PLACEHOLDER);
  fillKvRows("#set-terms-tbody", settings.estimateTerms, TERMS_PLACEHOLDER);
}

$("#btn-add-default-scope").addEventListener("click", () => addKvRow("#set-scope-tbody", null, SCOPE_PLACEHOLDER));
$("#btn-add-default-term").addEventListener("click", () => addKvRow("#set-terms-tbody", null, TERMS_PLACEHOLDER));

$("#btn-reset-defaults").addEventListener("click", () => {
  if (!confirm("Replace the scope and terms defaults with the standard set?")) return;
  fillKvRows("#set-scope-tbody", Storage.defaultScope(), SCOPE_PLACEHOLDER);
  fillKvRows("#set-terms-tbody", Storage.defaultTerms(), TERMS_PLACEHOLDER);
});

$("#btn-save-settings").addEventListener("click", () => {
  const validDays = parseInt($("#set-estimate-valid-days").value, 10);
  settings = {
    ...settings,
    businessName: $("#set-business-name").value.trim(),
    businessEmail: $("#set-business-email").value.trim(),
    currency: $("#set-currency").value.trim() || "$",
    emailMethod: $("#set-email-method").value,
    businessAddress: $("#set-business-address").value.trim(),
    businessPhone: $("#set-business-phone").value.trim(),
    businessWebsite: $("#set-business-website").value.trim(),
    estimatePrefix: $("#set-estimate-prefix").value.trim(),
    estimateValidDays: Number.isFinite(validDays) && validDays > 0 ? validDays : 14,
    estimateScope: readKvRows("#set-scope-tbody"),
    estimateTerms: readKvRows("#set-terms-tbody"),
  };
  Storage.saveSettings(settings);
  alert("Settings saved.");
});

// ---------- Init ----------
renderDashboard();
renderInvoicesTable();
renderEstimatesTable();
renderClientsTable();
renderSettingsForm();
