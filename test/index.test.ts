// Wire-contract tests for the endpoints added in 0.7.0. A fake fetch records the
// request and returns a canned response; nothing touches the network.
// Run: npm test (Node 22.6+, uses node:test and --experimental-transform-types).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PdfOps, PdfOpsError, SDK_VERSION } from '../src/index.ts';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const OUT = new TextEncoder().encode('%PDF-1.4 x');

interface Seen {
  path: string;
  method?: string;
  headers: Record<string, string>;
  json?: unknown;
  parts: [string, FormDataEntryValue][];
}

const harness = (respond: () => Response) => {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = init.body;
    seen.push({
      path: new URL(url).pathname,
      method: init.method,
      headers: init.headers as Record<string, string>,
      json: typeof body === 'string' ? JSON.parse(body) : undefined,
      parts: body instanceof FormData ? [...body.entries()] : [],
    });
    return respond();
  }) as unknown as typeof fetch;
  return { seen, client: new PdfOps({ fetch: fetchImpl, baseUrl: 'https://example.test' }) };
};

const pdfResponse = (headers: Record<string, string> = {}) => () =>
  new Response(OUT, { headers: { 'content-type': 'application/pdf', ...headers } });
const jsonResponse = (body: unknown) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const field = (s: Seen, name: string) => s.parts.find(([k]) => k === name)?.[1];

test('SDK_VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, pkg.version);
  assert.equal(SDK_VERSION, '0.7.0');
});

test('addFields sends fields JSON and surfaces x-pdfops-warning', async () => {
  const { seen, client } = harness(pdfResponse({ 'x-pdfops-warning': 'xfa-layer-dropped: hybrid form' }));
  const fields = [{ type: 'text' as const, name: 'a', page: 1, x: 10, y: 10, width: 100, height: 20 }];
  const r = await client.addFields(PDF, fields, { password: 'pw' });
  assert.equal(seen[0].path, '/api/add-fields');
  assert.equal(field(seen[0], 'fields'), JSON.stringify(fields));
  assert.equal(field(seen[0], 'password'), 'pw');
  assert.equal(r.warning, 'xfa-layer-dropped: hybrid form');
  assert.equal(r.pdf.length, OUT.length);

  const plain = harness(pdfResponse());
  assert.equal((await plain.client.addFields(PDF, fields)).warning, undefined);
  assert.equal(field(plain.seen[0], 'password'), undefined);
});

test('attach sends repeated file parts, aligned options, and parses attachment keys', async () => {
  const keys = [{ name: 'a.xml', key: 'a.xml' }, { name: 'b.json', key: 'b.json' }];
  const { seen, client } = harness(pdfResponse({ 'x-pdfops-attachment-keys': JSON.stringify(keys) }));
  const r = await client.attach(PDF, [
    { data: new TextEncoder().encode('<x/>'), name: 'a.xml', mimeType: 'text/xml', relationship: 'Data' },
    { data: new Blob(['{}'], { type: 'application/json' }), name: 'b.json', description: 'd' },
  ]);
  assert.equal(seen[0].path, '/api/attach');
  const files = seen[0].parts.filter(([k]) => k === 'file').map(([, v]) => v as File);
  assert.deepEqual(files.map((f) => f.name), ['a.xml', 'b.json']);
  assert.equal(files[0].type, 'text/xml');
  assert.equal(files[1].type, 'application/json');
  assert.deepEqual(JSON.parse(field(seen[0], 'options') as string), [
    { name: 'a.xml', mime_type: 'text/xml', relationship: 'Data' },
    { name: 'b.json', description: 'd' },
  ]);
  assert.deepEqual(r.attachmentKeys, keys);
});

test('edit sends items JSON and image parts named by key', async () => {
  const { seen, client } = harness(pdfResponse());
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  await client.edit(
    PDF,
    [
      { type: 'text', page: 1, x: 5, y: 5, text: 'hi' },
      { type: 'image', page: 1, x: 5, y: 50, image: 'logo' },
      { type: 'barcode', page: 1, x: 5, y: 100, format: 'qrcode', value: 'https://pdfops.dev' },
    ],
    { images: { logo: png } },
  );
  assert.equal(seen[0].path, '/api/edit');
  assert.equal(JSON.parse(field(seen[0], 'items') as string)[1].image, 'logo');
  const logo = field(seen[0], 'logo') as File;
  assert.equal(logo.size, 4);
  assert.equal(field(seen[0], 'password'), undefined);
});

test('extractText forwards pages and tables_format, returns the JSON body', async () => {
  const body = { pageCount: 1, pages: [], pagesWithoutText: [], truncated: true };
  const { seen, client } = harness(jsonResponse(body));
  const r = await client.extractText(PDF, { pages: '2-', tablesFormat: 'csv' });
  assert.equal(seen[0].path, '/api/extract-text');
  assert.equal(field(seen[0], 'pages'), '2-');
  assert.equal(field(seen[0], 'tables_format'), 'csv');
  assert.equal(field(seen[0], 'format'), undefined);
  assert.deepEqual(r, body);
});

test('extractTextPlain asks for format=text and reads X-PDFops-Truncated', async () => {
  const { seen, client } = harness(
    () => new Response('a\fb', { headers: { 'content-type': 'text/plain', 'X-PDFops-Truncated': 'true' } }),
  );
  const r = await client.extractTextPlain(PDF);
  assert.equal(field(seen[0], 'format'), 'text');
  assert.deepEqual(r, { text: 'a\fb', truncated: true });
});

test('extractTablesXlsx returns bytes and the truncation headers', async () => {
  const { seen, client } = harness(
    pdfResponse({
      'X-PDFops-Truncated': 'true',
      'X-PDFops-Truncated-By': 'pages,sheets',
      'X-PDFops-Cells-Truncated': 'true',
    }),
  );
  const r = await client.extractTablesXlsx(PDF, { pages: '1-3' });
  assert.equal(field(seen[0], 'tables_format'), 'xlsx');
  assert.equal(r.xlsx.length, OUT.length);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.truncatedBy, ['pages', 'sheets']);
  assert.equal(r.cellsTruncated, true);

  const clean = harness(pdfResponse());
  const c = await clean.client.extractTablesXlsx(PDF);
  assert.deepEqual([c.truncated, c.truncatedBy, c.cellsTruncated], [false, [], false]);
});

test('no_tables error exposes truncated and nextPage on PdfOpsError.body', async () => {
  const { client } = harness(
    () =>
      new Response(JSON.stringify({ error: 'no_tables', details: 'stopped early', truncated: true, nextPage: 201 }), {
        status: 400,
      }),
  );
  await assert.rejects(client.extractTablesXlsx(PDF), (e: unknown) => {
    assert.ok(e instanceof PdfOpsError);
    assert.equal(e.status, 400);
    assert.equal(e.code, 'no_tables');
    assert.equal(e.body?.nextPage, 201);
    return true;
  });
});

test('findText maps options to the API field names and returns nextPage', async () => {
  const body = { count: 0, truncated: true, hits: [], pagesWithoutText: [], pagesScanned: 5, nextPage: 6 };
  const { seen, client } = harness(jsonResponse(body));
  const r = await client.findText(PDF, 'INV-\\d+', {
    regex: true,
    caseSensitive: false,
    wholeWord: true,
    maxHits: 5,
    pages: '1-5',
  });
  assert.equal(seen[0].path, '/api/find-text');
  assert.equal(field(seen[0], 'query'), 'INV-\\d+');
  assert.equal(field(seen[0], 'regex'), 'true');
  assert.equal(field(seen[0], 'case_sensitive'), 'false');
  assert.equal(field(seen[0], 'whole_word'), 'true');
  assert.equal(field(seen[0], 'max_hits'), '5');
  assert.equal(r.nextPage, 6);

  const bare = harness(jsonResponse(body));
  await bare.client.findText(PDF, 'x');
  assert.deepEqual(bare.seen[0].parts.map(([k]) => k), ['pdf', 'query']);
});

test('htmlToPdf posts JSON and reads the page and blocked-request headers', async () => {
  const { seen, client } = harness(pdfResponse({ 'x-pdfops-pages': '3', 'x-pdfops-blocked-requests': '2' }));
  const r = await client.htmlToPdf({ html: '<p>hi</p>', page_size: 'a4', margin: { top: 10 } });
  assert.equal(seen[0].path, '/api/html-to-pdf');
  assert.equal(seen[0].headers['content-type'], 'application/json');
  assert.deepEqual(seen[0].json, { html: '<p>hi</p>', page_size: 'a4', margin: { top: 10 } });
  assert.equal(r.pages, 3);
  assert.equal(r.blockedRequests, 2);

  const bare = harness(pdfResponse());
  const b = await bare.client.htmlToPdf({ html: 'x' });
  assert.deepEqual(Object.keys(b), ['pdf']);
});

test('imageToPdf sends one pdf part per image plus options', async () => {
  const { seen, client } = harness(pdfResponse());
  await client.imageToPdf([new Uint8Array([0xff, 0xd8]), new Uint8Array([0x89, 0x50])], {
    pageSize: 'a4',
    orientation: 'portrait',
    margin: 20,
  });
  assert.equal(seen[0].path, '/api/image-to-pdf');
  assert.equal(seen[0].parts.filter(([k]) => k === 'pdf').length, 2);
  assert.equal(field(seen[0], 'page_size'), 'a4');
  assert.equal(field(seen[0], 'orientation'), 'portrait');
  assert.equal(field(seen[0], 'margin'), '20');
});

test('textToPdf posts the request as JSON', async () => {
  const { seen, client } = harness(pdfResponse());
  const out = await client.textToPdf({ content: '# Hi', format: 'markdown', page_numbers: true });
  assert.equal(seen[0].path, '/api/text-to-pdf');
  assert.deepEqual(seen[0].json, { content: '# Hi', format: 'markdown', page_numbers: true });
  assert.equal(out.length, OUT.length);
});

test('invoice passes the Factur-X fields through and einvoice_fields_required exposes missing', async () => {
  const request = {
    e_invoice: 'factur-x' as const,
    from: { name: 'Acme GmbH', country: 'DE', street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin', vat_id: 'DE123456789' },
    to: { name: 'Globex SARL', country: 'FR' },
    invoice_number: 'INV-1',
    date: '2026-11-01',
    due: '2026-12-01',
    currency: 'EUR',
    tax_rate: 19,
    iban: 'DE89370400440532013000',
    items: [{ description: 'Work', quantity: 2, unit: 'HUR', unit_price: 100 }],
  };
  const ok = harness(pdfResponse());
  await ok.client.invoice(request);
  assert.deepEqual(ok.seen[0].json, request);

  const missing = ['from.country', 'items[0].unit'];
  const bad = harness(
    () =>
      new Response(
        JSON.stringify({ error: 'einvoice_fields_required', details: 'also requires: ...', missing }),
        { status: 400 },
      ),
  );
  await assert.rejects(bad.client.invoice(request), (e: unknown) => {
    assert.ok(e instanceof PdfOpsError);
    assert.equal(e.code, 'einvoice_fields_required');
    assert.deepEqual(e.body?.missing, missing);
    return true;
  });
});

test('invalid_einvoice_field and unrenderable_text surface as PdfOpsError codes', async () => {
  for (const code of ['invalid_einvoice_field', 'unrenderable_text']) {
    const { client } = harness(() => new Response(JSON.stringify({ error: code, details: 'd' }), { status: 400 }));
    await assert.rejects(client.invoice({ from: 'a', to: 'b', items: [] }), (e: unknown) => {
      assert.ok(e instanceof PdfOpsError);
      assert.equal(e.code, code);
      return true;
    });
  }
});

test('a non-JSON error body keeps the status fallback and has no body', async () => {
  const { client } = harness(() => new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
  await assert.rejects(client.textToPdf({ content: 'x' }), (e: unknown) => {
    assert.ok(e instanceof PdfOpsError);
    assert.equal(e.code, 'http_502');
    assert.equal(e.body, undefined);
    return true;
  });
});

// ---- trust-boundary fixes ----

test('every request passes redirect: manual, and a 3xx is a PdfOpsError', async () => {
  const inits: RequestInit[] = [];
  const client = new PdfOps({
    baseUrl: 'https://example.test',
    fetch: (async (_u: string, init: RequestInit) => {
      inits.push(init);
      return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
    apiKey: 'k',
  });
  await client.inspect(PDF);
  await client.invoice({ from: 'a', to: 'b', items: [] });
  await client.usage();
  await client.signup('a@b.c');
  assert.equal(inits.length, 4);
  for (const i of inits) assert.equal(i.redirect, 'manual');
  const redirected = new PdfOps({
    baseUrl: 'https://example.test',
    fetch: (async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/x' } })) as unknown as typeof fetch,
    apiKey: 'k',
  });
  await assert.rejects(redirected.usage(), (e: unknown) => e instanceof PdfOpsError && e.status === 302 && e.code === 'http_302');
});

test('the default fetch is not called as a method of the client', async () => {
  const real = globalThis.fetch;
  const receivers: unknown[] = [];
  globalThis.fetch = function (this: unknown) {
    receivers.push(this);
    return Promise.resolve(new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }));
  } as typeof fetch;
  try {
    await new PdfOps({ baseUrl: 'https://example.test', apiKey: 'k' }).usage();
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(receivers, [undefined]);
});

test('edit refuses bad or reserved image keys before sending', async () => {
  const { seen, client } = harness(pdfResponse());
  const item = [{ type: 'image' as const, page: 1, x: 1, y: 1, image: 'x' }];
  for (const key of ['logo%22small', 'a b', '', 'x'.repeat(65), 'pdf', 'password', 'items', 'a"b']) {
    await assert.rejects(client.edit(PDF, item, { images: { [key]: PDF } }), /image key/);
  }
  assert.equal(seen.length, 0);
  await client.edit(PDF, item, { images: { 'logo_1.v-2': PDF } });
  assert.equal(seen.length, 1);
});

test('malformed attachment keys header gives []; one bad entry or a count mismatch drops them all', async () => {
  for (const h of ['not json', '{"a":1}', '"str"', 'null']) {
    const { client } = harness(pdfResponse({ 'x-pdfops-attachment-keys': h }));
    assert.deepEqual((await client.attach(PDF, [{ data: PDF, name: 'a' }])).attachmentKeys, []);
  }
  const mixed = JSON.stringify([{ name: 'a', key: 'k' }, { name: 1, key: 'k' }, null, { name: 'b' }]);
  const { client } = harness(pdfResponse({ 'x-pdfops-attachment-keys': mixed }));
  assert.deepEqual((await client.attach(PDF, [{ data: PDF, name: 'a' }])).attachmentKeys, []);
  const shifted = JSON.stringify([null, { name: 'b', key: 'k' }]);
  const two = [{ data: PDF, name: 'a' }, { data: PDF, name: 'b' }];
  assert.deepEqual((await harness(pdfResponse({ 'x-pdfops-attachment-keys': shifted })).client.attach(PDF, two)).attachmentKeys, []);
});

test('non-numeric page and blocked headers are undefined, not NaN', async () => {
  const { client } = harness(pdfResponse({ 'x-pdfops-pages': 'abc', 'x-pdfops-blocked-requests': '1e3' }));
  const r = await client.htmlToPdf({ html: 'x' });
  assert.equal(r.pages, undefined);
  assert.equal(r.blockedRequests, undefined);
});

test('odd error bodies never break PdfOpsError construction', async () => {
  for (const body of [{ error: { a: 1 }, details: 5 }, { error: 42 }, [1, 2], null, 'str']) {
    const { client } = harness(() => new Response(JSON.stringify(body), { status: 400, statusText: 'Bad' }));
    await assert.rejects(client.textToPdf({ content: 'x' }), (e: unknown) => {
      assert.ok(e instanceof PdfOpsError);
      assert.equal(e.code, 'http_400');
      const plain = body !== null && typeof body === 'object' && !Array.isArray(body);
      assert.equal(e.body !== undefined, plain);
      return true;
    });
  }
});

test('extractText with tablesFormat xlsx throws before sending', async () => {
  const { seen, client } = harness(jsonResponse({}));
  await assert.rejects(client.extractText(PDF, { tablesFormat: 'xlsx' as never }), /extractTablesXlsx/);
  assert.equal(seen.length, 0);
});
