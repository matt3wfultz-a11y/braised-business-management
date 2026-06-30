# Braised — Invoicing & Business Management

A lightweight, Bonsai-inspired invoicing tool that runs entirely in the browser and deploys for free on GitHub Pages. No backend, no database — your data lives in your browser's `localStorage`.

## Features

- **Clients** — store name, company, email, and address
- **Invoices** — create invoices with line items, tax rate, due dates, and notes
- **Tracking** — dashboard with outstanding / overdue / paid / draft totals, invoice status badges (auto-flips to "overdue" past the due date)
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

Since this is a static site with no server, all data is stored locally in your browser (`localStorage`). It won't sync across devices or browsers, and clearing browser data will erase it. "Sending" an invoice opens a pre-filled email in your mail client rather than emailing through a backend service.
