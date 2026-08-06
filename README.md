# pdfops-sdk

Typed client for the [PDFops API](https://pdfops.dev) — deterministic PDF **fill**, **merge**, and **inspect** over HTTP. No Chromium, no native deps, no infrastructure.

Edge-safe by construction: the client uses only `fetch`/`FormData`/`Blob`, so the same build runs in **Cloudflare Workers, Vercel Edge, Deno, Bun, Node 18+, and browsers**.

```bash
npm install pdfops-sdk
```

## Quick start

```ts
import { PdfOps } from 'pdfops-sdk';

const pdfops = new PdfOps({ apiKey: process.env.PDFOPS_API_KEY }); // or omit for keyless trial (100 req/IP/mo)

// 1. Discover the form's field names
const { fields, fillTemplate } = await pdfops.inspect(templatePdf);

// 2. Fill it
const filled = await pdfops.fillForm(templatePdf, {
  customer_name: 'Ada Lovelace',
  total: '$1,250.00',
  agree: 'true',
});

// 3. Merge with a cover page
const combined = await pdfops.merge([coverPdf, filled]);
```

## Generate an invoice (no template needed)

```ts
const pdf = await pdfops.invoice({
  from: { name: 'Acme LLC', lines: ['100 Main St', 'Springfield, IL'] },
  to: 'Globex Corporation',
  invoice_number: 'INV-0042',
  date: '2026-07-21',
  tax_rate: 8.5,
  items: [{ description: 'Consulting', quantity: 10, unit_price: 145 }],
});
```

Deterministic: the same request returns **byte-identical** bytes — safe to re-render idempotently from webhooks and crons. Free-tier output carries a small pdfops.dev footer; paid tiers render clean.

`fillForm`/`merge` return `Uint8Array` PDF bytes — hand them to R2/S3/Blob storage, a `Response`, or an email attachment as-is. `fillForm(pdf, fields, { flatten: true })` bakes the values in and drops the AcroForm so fields are no longer editable.

`inspect()` also reports each text field's `maxLength` (over-length values are rejected with `exceeds_max_length`) and a top-level `hasXFA` flag — hybrid AcroForm/XFA forms (all current IRS forms) lose their XFA layer on fill, which is fine in every mainstream viewer. Encrypted PDFs are rejected with `encrypted_pdf` and decrypt advice — many government blanks ship encrypted with an empty user password; `qpdf --decrypt` unlocks them.

## API keys

- **Keyless**: 100 requests / IP / month — try it without an account.
- **Free key**: 250 requests / month, no card — `await pdfops.signup('you@example.com')` or the form at [pdfops.dev/pricing](https://pdfops.dev/pricing). The key arrives by email.
- **Paid**: Indie $16/mo (4,000 req) · Pro $79/mo (25,000 req) — [pdfops.dev/pricing](https://pdfops.dev/pricing).

Check your quota anytime:

```ts
const { used, remaining, resets_at } = await pdfops.usage();
```

## Errors

Every non-2xx response throws a `PdfOpsError` with the API's stable error slug:

```ts
import { PdfOpsError } from 'pdfops-sdk';

try {
  await pdfops.fillForm(pdf, { nope: 'x' });
} catch (e) {
  if (e instanceof PdfOpsError) {
    console.log(e.status, e.code); // 400 'unknown_field'
  }
}
```

Common codes: `unknown_field`, `invalid_pdf`, `invalid_api_key` (401), `rate_limited` (429 — includes a `Retry-After` on the HTTP response).

## Docs

Full API reference: [pdfops.dev/docs](https://pdfops.dev/docs) · Field inspector web tool: [pdfops.dev/tools/inspect](https://pdfops.dev/tools/inspect)

MIT © PDFops
