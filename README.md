# Braised — Invoicing & Business Management

A lightweight, Bonsai-inspired invoicing tool that runs entirely in the browser and deploys for free on GitHub Pages. No backend, no database — your data lives in your browser's `localStorage`.

## Features

- **Clients** — store name, company, email, and address
- **Invoices** — create invoices with line items, tax rate, due dates, and notes
- **Duplicate** — copy any invoice into a new draft, from the invoice list or the invoice view
- **Tracking** — dashboard with outstanding / overdue / paid / draft totals, invoice status badges (auto-flips to "overdue" past the due date)
- **Send** — downloads the invoice PDF and opens a pre-filled Gmail compose window (or your default mail app — switchable in Settings)
- **Print / PDF** — clean printable invoice view (use your browser's "Save as PDF")

### Duplicating an invoice

Hit **Copy** on a row in the invoice list, or **Duplicate** while viewing an invoice. The copy keeps the client, line items, tax rate and notes, and reuses the original's payment terms — a 30-day invoice copied today is due 30 days from today. It gets the next invoice number, today's issue date, and `draft` status. Nothing is written until you press **Save Invoice**, so the original is never touched.

## Running locally

This is a static site — just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploying to GitHub Pages

> **Bump the cache buster when you change CSS or JS.** `index.html` loads
> `css/style.css?v=N`, `js/storage.js?v=N` and `js/app.js?v=N`. Raise `N` in all
> three whenever you edit those files. GitHub Pages sends the same cache headers
> for the HTML and its assets, but browsers revalidate the page far more eagerly
> than the files it references — so without a new `?v=`, visitors get the new
> markup running last deploy's JavaScript. New buttons render and silently do
> nothing.


1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to the `main` branch, root folder.
3. Your site will be live at `https://<username>.github.io/<repo>/`.

## Notes / limitations

Since this is a static site with no server, all data is stored locally in your browser (`localStorage`). It won't sync across devices or browsers, and clearing browser data will erase it. "Sending" an invoice opens a pre-filled email rather than emailing through a backend service.

**The PDF can't be attached automatically.** Gmail's compose link accepts a recipient, subject and body, but there is no URL parameter for attachments — no website can put a file into your Gmail draft. So **Send via Email** downloads the invoice PDF and opens Gmail with everything else filled in; you drag the PDF in or use the paperclip. Genuine one-click attaching would need the Gmail API with OAuth sign-in and a Google Cloud project, which means this app would no longer be a pure static site.
