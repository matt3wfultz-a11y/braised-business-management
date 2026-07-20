# Braised — Invoicing & Business Management

A lightweight, Bonsai-inspired invoicing tool that runs entirely in the browser and deploys for free on GitHub Pages. No backend, no database — your data lives in your browser's `localStorage`.

## Features

- **Clients** — store name, company, email, and address
- **Invoices** — create invoices with line items, tax rate, due dates, and notes
- **Payments** — record deposits and partial payments against an invoice; the invoice shows Amount Paid / Balance Due and the status flips to "paid" automatically once the balance is covered
- **Tracking** — dashboard with cash received, outstanding, and overdue balances (partial payments included); status badges auto-flip to "overdue" past the due date
- **Reports** — per-year Invoiced / Collected / Outstanding / Sales-tax-billed totals, a monthly-invoiced bar chart, top clients by revenue, and an outstanding & overdue aging list
- **Backup** — one-click JSON backup of everything, safe merge-restore, and a CSV export of invoices for your accountant
- **Send** — generates a pre-filled `mailto:` email to the client with the invoice summary
- **Print / PDF** — clean printable invoice view (use your browser's "Save as PDF")

## Running locally

This is a static site — just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to the `main` branch, root folder.
3. Your site will be live at `https://<username>.github.io/<repo>/`.

## Notes / limitations

Since this is a static site with no server, all data is stored locally in your browser (`localStorage`). It won't sync across devices or browsers, and clearing browser data will erase it. **Use Settings → Data & Backup to download a backup file regularly** — that file is the only way to move data between browsers/computers or recover it after clearing browser data. "Sending" an invoice opens a pre-filled email in your mail client rather than emailing through a backend service.
