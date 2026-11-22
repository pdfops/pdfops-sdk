// pdfops — typed client for the PDFops API (https://pdfops.dev).
//
// Zero dependencies. Uses only WHATWG fetch / FormData / Blob, so the
// same build runs in Cloudflare Workers, Vercel Edge, Deno, Bun and
// Node 18+. Errors carry the API's structured
// { error, details } body via PdfOpsError.

export interface PdfOpsOptions {
  /** API key from https://pdfops.dev/pricing (free tier: 250 req/mo). Omit for keyless trial calls (100/IP/mo). */
  apiKey?: string;
  /** Override the API origin. Default: https://pdfops.dev */
  baseUrl?: string;
  /** Custom fetch implementation (testing / instrumentation). */
  fetch?: typeof fetch;
  /**
   * Integration identifier sent as X-Pdfops-Client (e.g. "mcp", "n8n").
   * Used only for anonymous usage attribution — set it when embedding
   * this SDK inside another tool. Default: "sdk".
   */
  clientTag?: string;
  /**
   * Version of the embedding integration, sent as X-Pdfops-Client-Version.
   * Default: this SDK's own version when clientTag is omitted, else unset.
   */
  clientVersion?: string;
  /** Host application identity, sent as X-Pdfops-Client-Host (e.g. "claude-ai/0.1.0"). */
  clientHost?: string;
}

/** This package's version — keep in step with sdk/package.json (asserted in tests). */
export const SDK_VERSION = '0.7.0';

/** Binary PDF input: any of the common runtime shapes. */
export type PdfInput = Blob | ArrayBuffer | Uint8Array;

export interface InspectedField {
  name: string;
  /** Alternate/tooltip name (/TU), only when the form has one. */
  label?: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist' | 'unsupported';
  value?: string;
  checked?: boolean;
  options?: string[];
  /** Text fields only: values longer than this are rejected with exceeds_max_length. */
  maxLength?: number;
  readOnly: boolean;
  raw?: string;
}

export interface InspectResult {
  count: number;
  /** Hybrid AcroForm/XFA input: fillForm() writes the AcroForm layer and drops the XFA layer on save. */
  hasXFA: boolean;
  /** The form exceeded an API enumeration cap: `fields` is a prefix, not the full list. */
  truncated: boolean;
  fields: InspectedField[];
  /** Paste-ready `fields` object for fillForm(). */
  fillTemplate: Record<string, string>;
}

export interface InvoiceParty {
  name: string;
  lines?: string[];
  /** ISO 3166-1 alpha-2 code in capitals, e.g. "DE". Required with `e_invoice`; the fields below are used with it. */
  country?: string;
  street?: string;
  postcode?: string;
  city?: string;
  /** Starts with a two-letter capital country prefix, e.g. "DE123456789" ("EL" for Greece). */
  vat_id?: string;
  /** Seller only: EN 16931 has no buyer tax number (to.tax_id is refused, use to.vat_id). */
  tax_id?: string;
  registration_id?: string;
}

export interface InvoiceItem {
  description: string;
  /** Default 1. With `e_invoice`: positive, at most 4 decimals. */
  quantity?: number;
  unit_price: number;
  /** UN/ECE Recommendation 20 unit code, e.g. "C62" (one), "HUR" (hour), "KGM" (kilogram). Required with `e_invoice`. */
  unit?: string;
}

export interface InvoiceRequest {
  from: string | InvoiceParty;
  to: string | InvoiceParty;
  items: InvoiceItem[];
  invoice_number?: string;
  /** Calendar date, strictly `YYYY-MM-DD` (else 400 `invalid_date`). Shown verbatim; also pins the PDF's metadata dates (determinism). */
  date?: string;
  due?: string;
  /** ISO 4217 code. Default "USD". */
  currency?: string;
  /** Percent, 0-100. */
  tax_rate?: number;
  notes?: string;
  /**
   * "factur-x" returns a Factur-X / ZUGFeRD (EN 16931) PDF with the XML embedded.
   * It also requires an object `from` and `to` with `name` and `country`, `invoice_number`,
   * `date`, `currency` (no default), a `due` date or `payment_terms`, a unit on every item,
   * and the seller's `vat_id` (or `tax_id` plus `registration_id`). A request that lacks
   * some of these fails with `einvoice_fields_required`; the names are in `PdfOpsError.body.missing`.
   */
  e_invoice?: 'factur-x';
  /** EN 16931 VAT category: S standard (default when tax_rate > 0), Z zero rate, E exempt, AE reverse charge, O not subject to VAT. Required with `e_invoice` when tax_rate is 0. */
  tax_category?: 'S' | 'Z' | 'E' | 'AE' | 'O';
  /** Required with `e_invoice` for tax_category E, AE and O. */
  tax_exemption_reason?: string;
  /** With `e_invoice`, either this or `due` is required. */
  payment_terms?: string;
  /** IBAN to pay into (checksum verified). Used only with `e_invoice`. */
  iban?: string;
}

export interface UsageResult {
  tier: 'free' | 'indie' | 'pro';
  limit: number;
  used: number;
  remaining: number;
  period: string;
  resets_at: string;
}

export interface SplitPart {
  /** The 1-based page spec this part covers, e.g. "3-5". */
  pages: string;
  page_count: number;
  /** The part's PDF bytes. */
  pdf: Uint8Array;
}

export interface SplitResult {
  count: number;
  parts: SplitPart[];
}

export interface UnlockResult {
  pdf: Uint8Array;
  /** The API's x-pdfops-note header: "not-encrypted" when the input had no encryption (it is returned re-saved). */
  note?: string;
}

export interface MetadataResult {
  page_count: number;
  /** MediaBox width/height in points and the page's rotation. At most 2,000 entries. */
  pages: { width: number; height: number; rotation: number }[];
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  /** ISO 8601, null when absent. */
  creation_date: string | null;
  /** ISO 8601, null when absent. */
  modification_date: string | null;
  /** True when the PDF had to be decrypted to read it (includes owner-locked files with an empty user password). */
  encrypted: boolean;
  has_form: boolean;
  /** AcroForm fields found, never more than 2,000. */
  form_field_count: number;
  /** True when the count stopped at the cap, so the real number may be higher. */
  form_field_count_capped: boolean;
}

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right'
  | 'top-left';

export type ProtectPermission = 'print' | 'copy' | 'modify' | 'annotate' | 'fill-forms';

interface FieldBox {
  /** Points from the bottom-left of the page as displayed (after /Rotate). */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FieldCommon {
  /** Unique field name, 1-200 chars, no ".". */
  name: string;
  /** 1-based page number. */
  page: number;
  required?: boolean;
  read_only?: boolean;
  /** Default true. */
  border?: boolean;
  /** Paint an opaque white background. Default false. */
  background?: boolean;
}

/** A form field for addFields(). For `radio`, the box of each option is used, not the group's. */
export type AddFieldSpec =
  | (FieldCommon &
      FieldBox & {
        type: 'text';
        multiline?: boolean;
        max_length?: number;
        default?: string;
        font_size?: number | 'auto';
      })
  | (FieldCommon & FieldBox & { type: 'checkbox'; checked?: boolean })
  | (FieldCommon & {
      type: 'radio';
      options: (FieldBox & { value: string })[];
      default?: string;
    })
  | (FieldCommon &
      FieldBox & { type: 'dropdown'; options: string[]; default?: string; font_size?: number | 'auto' })
  | (FieldCommon & FieldBox & { type: 'signature' });

export interface AddFieldsResult {
  pdf: Uint8Array;
  /** The API's x-pdfops-warning header: starts with "xfa-layer-dropped" when the input was hybrid AcroForm/XFA. */
  warning?: string;
}

export interface AttachFile {
  /** The file's bytes. */
  data: PdfInput;
  /** Name inside the PDF: 1-255 chars, no "/" or backslash. */
  name: string;
  /** Default: the Blob's type, else "application/octet-stream". */
  mimeType?: string;
  description?: string;
  /** PDF/A-3 AFRelationship. Default "Unspecified". */
  relationship?: 'Alternative' | 'Data' | 'Source' | 'Supplement' | 'Unspecified';
}

export interface AttachResult {
  pdf: Uint8Array;
  /** The API's x-pdfops-attachment-keys header, parsed: the lookup key of each added file, in request order (names cut to 40 characters). */
  attachmentKeys: { name: string; key: string }[];
}

export type EditFont =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Courier';

/** Position of a stamp: points from the bottom-left of the page as displayed. */
interface EditAt {
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
}

export type EditItem =
  | (EditAt & {
      type: 'text';
      /** 1-2000 chars, WinAnsi only. */
      text: string;
      /** 4-200 pt, default 12. */
      size?: number;
      /** Hex #rgb or #rrggbb, default #000000. */
      color?: string;
      font?: EditFont;
      /** 0.05-1, default 1. */
      opacity?: number;
      /** Degrees counter-clockwise, default 0. */
      rotation?: number;
      /** Wrap words to this width (points). */
      maxWidth?: number;
      /** Multiple of size, 0.5-5, default 1.2. */
      lineHeight?: number;
    })
  | (EditAt & {
      type: 'image';
      /** A key of the `images` option of edit(). PNG or JPEG, up to 2 MB each, at most 10 distinct. */
      image: string;
      /** Points; only one given keeps the aspect ratio. */
      width?: number;
      height?: number;
      opacity?: number;
    })
  | (EditAt & {
      type: 'barcode';
      format:
        | 'qrcode'
        | 'datamatrix'
        | 'pdf417'
        | 'azteccode'
        | 'code128'
        | 'code39'
        | 'ean13'
        | 'ean8'
        | 'upca'
        | 'itf14'
        | 'interleaved2of5'
        | 'gs1-128';
      /** 1-3000 chars; the format's own rules apply. */
      value: string;
      width?: number;
      height?: number;
      color?: string;
      background?: string;
      /** Print the human-readable value (linear codes). */
      includeText?: boolean;
      /** qrcode only, default "M". */
      errorCorrection?: 'L' | 'M' | 'Q' | 'H';
      opacity?: number;
    });

export interface ExtractedLine {
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  width: number;
  fontSize: number;
}

export interface ExtractedTable {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: string[][];
  /** Only with tablesFormat "csv": the table as RFC 4180 CSV, CRLF line ends. */
  csv?: string;
}

export interface ExtractTextResult {
  pageCount: number;
  pages: {
    page: number;
    width: number;
    height: number;
    text: string;
    lines: ExtractedLine[];
    tables: ExtractedTable[];
  }[];
  /** Selected pages with no text layer (scans). OCR is not supported. */
  pagesWithoutText: number[];
  /** The read stopped at the page or output cap; continue with `pages: "<last returned page + 1>-"`. */
  truncated: boolean;
}

export interface ExtractTextPlainResult {
  /** Pages separated by a form feed. */
  text: string;
  /** The API's X-PDFops-Truncated header. */
  truncated: boolean;
}

export interface ExtractXlsxResult {
  /** One .xlsx workbook, one sheet per table. */
  xlsx: Uint8Array;
  /** The API's X-PDFops-Truncated header. */
  truncated: boolean;
  /** The API's X-PDFops-Truncated-By header split into caps: pages, output, sheets, columns, rows. */
  truncatedBy: string[];
  /** The API's X-PDFops-Cells-Truncated header: a cell over 32,767 characters was cut. */
  cellsTruncated: boolean;
}

export interface FindTextHit {
  page: number;
  /** The matched text. */
  text: string;
  /** The line it is on (cut around the match when line_truncated). */
  line: string;
  line_truncated?: true;
  /** The edit() frame: points from the bottom-left, y on the baseline, height the font size. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FindTextResult {
  /** Hits returned. */
  count: number;
  truncated: boolean;
  hits: FindTextHit[];
  pagesWithoutText: number[];
  pagesScanned: number;
  /** First page not fully searched; null when the scan finished. Repeat with `pages: "<nextPage>-"` to continue. */
  nextPage: number | null;
  pagesSkipped?: { page: number; reason: string }[];
  linesSkipped?: number;
}

export interface HtmlToPdfRequest {
  /** Up to the API's size cap in UTF-8. */
  html: string;
  /** Default "letter". */
  page_size?: 'a4' | 'letter';
  landscape?: boolean;
  /** Points, 0-144, one value or per side. Default 36. */
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** Default true. */
  print_background?: boolean;
  /** 0.1-2, default 1. */
  scale?: number;
}

export interface HtmlToPdfResult {
  pdf: Uint8Array;
  /** The API's x-pdfops-pages header. */
  pages?: number;
  /** The API's x-pdfops-blocked-requests header: external requests the renderer refused. */
  blockedRequests?: number;
}

export interface TextToPdfRequest {
  content: string;
  /** Default "markdown". */
  format?: 'markdown' | 'text' | 'csv';
  /** Default "letter". */
  page_size?: 'a4' | 'letter';
  /** Points, 18-144, default 54. */
  margin?: number;
  /** Points, 6-36, default 11. */
  font_size?: number;
  /** PDF metadata title, up to 200 chars. */
  title?: string;
  /** "Page n of N" footer. Default false. */
  page_numbers?: boolean;
  /** Text format only. Default false. */
  monospace?: boolean;
}

/** Structured API error — `code` is the API's stable `error` slug. */
export class PdfOpsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    details: string,
    /** The parsed JSON error body when there was one, for fields beyond `error`/`details` (e.g. `missing`, `nextPage`). */
    public readonly body?: Record<string, unknown>,
  ) {
    super(`${code}: ${details}`);
    this.name = 'PdfOpsError';
  }
}

const toBlob = (input: PdfInput, type = 'application/pdf'): Blob => {
  if (input instanceof Blob) return input;
  // Copy into a fresh ArrayBuffer-backed view — accepts SharedArrayBuffer
  // views and offset subarrays alike.
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type });
};

const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export class PdfOps {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clientTag: string;
  private readonly clientVersion?: string;
  private readonly clientHost?: string;

  constructor(options: PdfOpsOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://pdfops.dev').replace(/\/$/, '');
    // Wrapped, not stored bare: Workers and browsers throw "Illegal invocation" when the
    // global fetch is called as a method of another object.
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.clientTag = options.clientTag ?? 'sdk';
    this.clientVersion =
      options.clientVersion ?? (options.clientTag ? undefined : SDK_VERSION);
    this.clientHost = options.clientHost;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    h['X-Pdfops-Client'] = this.clientTag;
    if (this.clientVersion) h['X-Pdfops-Client-Version'] = this.clientVersion;
    if (this.clientHost) h['X-Pdfops-Client-Host'] = this.clientHost;
    return h;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    // redirect: 'manual' so a 3xx can never forward the API key and body to another origin;
    // it surfaces below as PdfOpsError http_3xx. Not 'error': Cloudflare Workers rejects that value.
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, redirect: 'manual' });
    if (!res.ok) {
      let code = `http_${res.status}`;
      let details = res.statusText;
      let errBody: Record<string, unknown> | undefined;
      try {
        const body = (await res.json()) as unknown;
        if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
          const o = body as Record<string, unknown>;
          if (typeof o.error === 'string' && o.error) code = o.error;
          if (typeof o.details === 'string' && o.details) details = o.details;
          errBody = o;
        }
      } catch {
        // non-JSON error body — keep the status fallback
      }
      throw new PdfOpsError(res.status, code, details, errBody);
    }
    return res;
  }

  /**
   * Fill AcroForm fields in a PDF. Returns the filled PDF bytes.
   * Field names must exist in the PDF — use inspect() to discover them.
   * Checkbox values are the strings "true" | "false"; choice fields
   * take one of their options.
   * Pass { flatten: true } to bake values into page content and drop
   * the AcroForm so fields are no longer interactive.
   * Pass { password } to open a user-password PDF (owner-locked files with
   * an empty user password need none).
   */
  async fillForm(
    pdf: PdfInput,
    fields: Record<string, string>,
    opts?: { flatten?: boolean; password?: string },
  ): Promise<Uint8Array> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    fd.append('fields', JSON.stringify(fields));
    if (opts?.flatten) fd.append('flatten', 'true');
    if (opts?.password !== undefined) fd.append('password', opts.password);
    const res = await this.request('/api/fill-form', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Merge two or more PDFs, in order. Returns the combined PDF bytes.
   * Pass { password } to open user-password inputs; it applies to every input.
   */
  async merge(pdfs: PdfInput[], opts?: { password?: string }): Promise<Uint8Array> {
    if (pdfs.length < 2) {
      throw new PdfOpsError(400, 'too_few_pdfs', 'merge needs at least 2 PDFs');
    }
    const fd = new FormData();
    pdfs.forEach((p, i) => fd.append('pdf', toBlob(p), `part-${i}.pdf`));
    if (opts?.password !== undefined) fd.append('password', opts.password);
    const res = await this.request('/api/merge', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * List a PDF's AcroForm fields (names, types, options, current
   * values) plus a paste-ready fillTemplate for fillForm(). A PDF with
   * no form returns count 0 — not an error. Pass { password } to open a
   * user-password PDF.
   */
  async inspect(pdf: PdfInput, opts?: { password?: string }): Promise<InspectResult> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    if (opts?.password !== undefined) fd.append('password', opts.password);
    const res = await this.request('/api/inspect', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return (await res.json()) as InspectResult;
  }

  /**
   * Generate a complete invoice PDF from structured data — no template
   * needed. Deterministic: the same request produces byte-identical
   * bytes (safe to re-render idempotently from webhooks/crons).
   * Anonymous/free-tier output carries a small pdfops.dev footer line;
   * paid tiers render clean.
   */
  async invoice(request: InvoiceRequest): Promise<Uint8Array> {
    const res = await this.request('/api/invoice', {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * POST a PDF plus text fields to a PDF-returning endpoint. Fields that
   * are undefined are omitted (a missing field means "default"; an empty
   * string does not).
   */
  private async pdfOp(
    path: string,
    pdf: PdfInput,
    fields: Record<string, string | number | undefined>,
  ): Promise<Uint8Array> {
    const res = await this.formRequest(path, pdf, fields);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async formRequest(
    path: string,
    pdf: PdfInput,
    fields: Record<string, string | number | undefined>,
  ): Promise<Response> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) fd.append(k, String(v));
    }
    return this.request(path, { method: 'POST', headers: this.headers(), body: fd });
  }

  /**
   * Keep only the listed pages, in the order given (so it also reorders
   * and duplicates). `pages` is a 1-based spec such as "1-3,5,8-".
   * Errors: invalid_pages (a page out of range), encrypted_pdf.
   */
  extractPages(pdf: PdfInput, pages: string, opts?: { password?: string }): Promise<Uint8Array> {
    return this.pdfOp('/api/extract-pages', pdf, { pages, password: opts?.password });
  }

  /**
   * Remove the listed pages and keep the rest in order. `pages` is a
   * 1-based spec such as "2,4-6,9-".
   * Errors: invalid_pages, no_pages_left (every page deleted).
   */
  deletePages(pdf: PdfInput, pages: string, opts?: { password?: string }): Promise<Uint8Array> {
    return this.pdfOp('/api/delete-pages', pdf, { pages, password: opts?.password });
  }

  /**
   * Rotate pages clockwise by 90, 180, 270 or -90 degrees, added to each
   * page's existing rotation. Omit `pages` to rotate every page.
   * Errors: invalid_degrees, invalid_pages.
   */
  rotate(
    pdf: PdfInput,
    degrees: 90 | 180 | 270 | -90,
    opts?: { pages?: string; password?: string },
  ): Promise<Uint8Array> {
    return this.pdfOp('/api/rotate', pdf, {
      degrees,
      pages: opts?.pages,
      password: opts?.password,
    });
  }

  /**
   * Split one PDF into several, by explicit `ranges` ("1-2,3-5" gives two
   * parts) or fixed-size chunks (`every`). Give exactly one of the two.
   * Errors: invalid_split, invalid_every, invalid_pages, too_many_parts,
   * output_too_large.
   */
  async split(
    pdf: PdfInput,
    opts: ({ ranges: string } | { every: number }) & { password?: string },
  ): Promise<SplitResult> {
    const o = opts as { ranges?: string; every?: number; password?: string };
    const res = await this.formRequest('/api/split', pdf, {
      ranges: o.ranges,
      every: o.every,
      password: o.password,
    });
    const body = (await res.json()) as {
      count: number;
      parts: { pages: string; page_count: number; pdf: string }[];
    };
    return {
      count: body.count,
      parts: body.parts.map((p) => ({
        pages: p.pages,
        page_count: p.page_count,
        pdf: fromBase64(p.pdf),
      })),
    };
  }

  /**
   * Stamp a diagonal text watermark (default: centered, 45 degrees, grey
   * #808080, 15% opacity, 48 pt). Standard Helvetica only.
   * Errors: missing_text, text_too_long, unsupported_characters,
   * invalid_parameter, invalid_pages.
   */
  watermark(
    pdf: PdfInput,
    text: string,
    opts?: {
      opacity?: number;
      size?: number;
      color?: string;
      rotation?: number;
      position?: 'center' | 'top' | 'bottom';
      pages?: string;
      password?: string;
    },
  ): Promise<Uint8Array> {
    return this.pdfOp('/api/watermark', pdf, {
      text,
      opacity: opts?.opacity,
      size: opts?.size,
      color: opts?.color,
      rotation: opts?.rotation,
      position: opts?.position,
      pages: opts?.pages,
      password: opts?.password,
    });
  }

  /**
   * Print page numbers from a template with {n} and {total} (default
   * "{n} / {total}", bottom-center, 10 pt). Page i shows start+i-1.
   * Errors: unsupported_characters, invalid_pages.
   */
  pageNumbers(
    pdf: PdfInput,
    opts?: {
      format?: string;
      position?: PageNumberPosition;
      size?: number;
      start?: number;
      margin?: number;
      pages?: string;
      password?: string;
    },
  ): Promise<Uint8Array> {
    return this.pdfOp('/api/page-numbers', pdf, {
      format: opts?.format,
      position: opts?.position,
      size: opts?.size,
      start: opts?.start,
      margin: opts?.margin,
      pages: opts?.pages,
      password: opts?.password,
    });
  }

  /**
   * Save a PDF without encryption so print/copy/modify restrictions are
   * gone. Owner-locked files with an empty user password need no
   * password; it does not crack unknown passwords (encrypted_pdf).
   * Returns the bytes plus `note` ("not-encrypted") when the input had no
   * encryption and was only re-saved.
   */
  async unlock(pdf: PdfInput, password?: string): Promise<UnlockResult> {
    const res = await this.formRequest('/api/unlock', pdf, { password });
    const note = res.headers.get('x-pdfops-note') ?? undefined;
    return { pdf: new Uint8Array(await res.arrayBuffer()), ...(note ? { note } : {}) };
  }

  /**
   * Encrypt a PDF. Give at least one of userPassword (needed to open the
   * result) and ownerPassword (lifts restrictions), each 1-32 Latin-1
   * chars. `permissions` lists what stays ALLOWED (print, copy, modify,
   * annotate, fill-forms); omit for the default, [] allows none.
   * `password` opens an encrypted input.
   * Errors: missing_password, invalid_password, invalid_permissions.
   */
  protect(
    pdf: PdfInput,
    opts: {
      userPassword?: string;
      ownerPassword?: string;
      permissions?: ProtectPermission[];
      password?: string;
    },
  ): Promise<Uint8Array> {
    return this.pdfOp('/api/protect', pdf, {
      user_password: opts.userPassword,
      owner_password: opts.ownerPassword,
      permissions: opts.permissions?.join(','),
      password: opts.password,
    });
  }

  /**
   * Read a PDF's page count, per-page size and rotation, document info
   * (title, author, dates, ...), encryption flag and form field count.
   */
  async metadata(pdf: PdfInput, opts?: { password?: string }): Promise<MetadataResult> {
    const res = await this.formRequest('/api/metadata', pdf, { password: opts?.password });
    return (await res.json()) as MetadataResult;
  }

  /**
   * Write document info fields into a PDF; give at least one. An empty
   * string sets an empty value. The output is saved unencrypted.
   */
  setMetadata(
    pdf: PdfInput,
    opts: {
      title?: string;
      author?: string;
      subject?: string;
      creator?: string;
      keywords?: string[];
      password?: string;
    },
  ): Promise<Uint8Array> {
    return this.pdfOp('/api/set-metadata', pdf, {
      title: opts.title,
      author: opts.author,
      subject: opts.subject,
      creator: opts.creator,
      keywords: opts.keywords?.join(','),
      password: opts.password,
    });
  }

  /**
   * Create AcroForm fields (text, checkbox, radio, dropdown, signature) at
   * positions on a PDF, up to 200 per call. x/y are points from the
   * bottom-left of the page as displayed, the same frame as edit().
   * Returns the bytes plus `warning` when the input was hybrid AcroForm/XFA.
   * Errors: invalid_fields, too_many_fields, duplicate_field, invalid_pages,
   * unsupported_characters.
   */
  async addFields(
    pdf: PdfInput,
    fields: AddFieldSpec[],
    opts?: { password?: string },
  ): Promise<AddFieldsResult> {
    const res = await this.formRequest('/api/add-fields', pdf, {
      fields: JSON.stringify(fields),
      password: opts?.password,
    });
    const warning = res.headers.get('x-pdfops-warning') ?? undefined;
    return { pdf: new Uint8Array(await res.arrayBuffer()), ...(warning ? { warning } : {}) };
  }

  /**
   * Embed files in a PDF (for example the XML of an e-invoice), in the
   * order given. Returns the bytes plus `attachmentKeys`, the lookup key of
   * each added file.
   * Errors: missing_files, too_many_files, files_too_large, invalid_name,
   * invalid_mime_type, invalid_relationship, duplicate_name,
   * too_many_attachments.
   */
  async attach(
    pdf: PdfInput,
    files: AttachFile[],
    opts?: { password?: string },
  ): Promise<AttachResult> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    for (const f of files) {
      fd.append('file', toBlob(f.data, f.mimeType ?? 'application/octet-stream'), f.name);
    }
    fd.append(
      'options',
      JSON.stringify(
        files.map((f) => ({
          name: f.name,
          mime_type: f.mimeType,
          description: f.description,
          relationship: f.relationship,
        })),
      ),
    );
    if (opts?.password !== undefined) fd.append('password', opts.password);
    const res = await this.request('/api/attach', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    // Response headers are untrusted: a bad value gives [], never a throw after a charged call.
    let attachmentKeys: { name: string; key: string }[] = [];
    try {
      const parsed: unknown = JSON.parse(res.headers.get('x-pdfops-attachment-keys') ?? '[]');
      // All or nothing: dropping one bad entry would shift the rest against the files sent.
      if (
        Array.isArray(parsed) &&
        parsed.length === files.length &&
        parsed.every((e) => e !== null && typeof e === 'object' && typeof e.name === 'string' && typeof e.key === 'string')
      ) {
        attachmentKeys = parsed.map((e) => ({ name: e.name, key: e.key }));
      }
    } catch {
      attachmentKeys = [];
    }
    return { pdf: new Uint8Array(await res.arrayBuffer()), attachmentKeys };
  }

  /**
   * Stamp text, images and barcodes (QR, Code 128, EAN, ...) onto pages, up
   * to 100 items. x/y are points from the bottom-left of the page as
   * displayed. An `image` item names a key of `opts.images`, whose value is
   * the PNG or JPEG bytes. A key is 1-64 characters of A-Z a-z 0-9 _ . -
   * and not "pdf", "items" or "password"; anything else throws before sending.
   * Errors: invalid_items, too_many_items, unsupported_characters,
   * invalid_pages, invalid_image.
   */
  async edit(
    pdf: PdfInput,
    items: EditItem[],
    opts?: { images?: Record<string, PdfInput>; password?: string },
  ): Promise<Uint8Array> {
    const images = Object.entries(opts?.images ?? {});
    for (const [name] of images) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || ['pdf', 'password', 'items'].includes(name)) {
        throw new Error(`edit: invalid image key "${name.slice(0, 40)}": use 1-64 of A-Z a-z 0-9 _ . - and not pdf, password or items`);
      }
    }
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    fd.append('items', JSON.stringify(items));
    for (const [name, data] of images) {
      fd.append(name, toBlob(data, 'application/octet-stream'), name);
    }
    if (opts?.password !== undefined) fd.append('password', opts.password);
    const res = await this.request('/api/edit', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Read the text layer of a born-digital PDF (no OCR): per-page text in
   * reading order, every line with its position, and tables found from the
   * layout. `tablesFormat: 'csv'` adds a `csv` string to each table.
   * `truncated` is true when the read stopped at a cap; continue with
   * `pages: "<last returned page + 1>-"`.
   * Errors: invalid_pages, encrypted_pdf, too_many_pages.
   */
  async extractText(
    pdf: PdfInput,
    opts?: { pages?: string; tablesFormat?: 'json' | 'csv'; password?: string },
  ): Promise<ExtractTextResult> {
    if ((opts?.tablesFormat as string | undefined) === 'xlsx') {
      throw new Error('extractText cannot return a workbook; use extractTablesXlsx() for tablesFormat "xlsx"');
    }
    const res = await this.formRequest('/api/extract-text', pdf, {
      pages: opts?.pages,
      tables_format: opts?.tablesFormat,
      password: opts?.password,
    });
    return (await res.json()) as ExtractTextResult;
  }

  /**
   * extractText() as plain text: pages separated by a form feed. `truncated`
   * is the API's X-PDFops-Truncated header.
   */
  async extractTextPlain(
    pdf: PdfInput,
    opts?: { pages?: string; password?: string },
  ): Promise<ExtractTextPlainResult> {
    const res = await this.formRequest('/api/extract-text', pdf, {
      format: 'text',
      pages: opts?.pages,
      password: opts?.password,
    });
    return { text: await res.text(), truncated: res.headers.get('x-pdfops-truncated') === 'true' };
  }

  /**
   * The tables of a born-digital PDF as one .xlsx workbook (one sheet per
   * table, every cell text). Also returns which caps cut the read short.
   * Errors: no_tables when none were found; if the read stopped early,
   * `PdfOpsError.body` carries `truncated` and `nextPage`.
   */
  async extractTablesXlsx(
    pdf: PdfInput,
    opts?: { pages?: string; password?: string },
  ): Promise<ExtractXlsxResult> {
    const res = await this.formRequest('/api/extract-text', pdf, {
      tables_format: 'xlsx',
      pages: opts?.pages,
      password: opts?.password,
    });
    return {
      xlsx: new Uint8Array(await res.arrayBuffer()),
      truncated: res.headers.get('x-pdfops-truncated') === 'true',
      truncatedBy: (res.headers.get('x-pdfops-truncated-by') ?? '').split(',').filter(Boolean),
      cellsTruncated: res.headers.get('x-pdfops-cells-truncated') === 'true',
    };
  }

  /**
   * Find text (or a regular expression from a linear-time subset) in a
   * born-digital PDF; each hit has its page and a box in the edit() frame.
   * Matching is within one line. When `nextPage` is not null the scan
   * stopped early: repeat with `pages: "<nextPage>-"`.
   * Errors: missing_query, query_too_long, invalid_regex, invalid_parameter.
   */
  async findText(
    pdf: PdfInput,
    query: string,
    opts?: {
      regex?: boolean;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      pages?: string;
      /** 1-1000, default 100. */
      maxHits?: number;
      password?: string;
    },
  ): Promise<FindTextResult> {
    const res = await this.formRequest('/api/find-text', pdf, {
      query,
      regex: opts?.regex?.toString(),
      case_sensitive: opts?.caseSensitive?.toString(),
      whole_word: opts?.wholeWord?.toString(),
      pages: opts?.pages,
      max_hits: opts?.maxHits,
      password: opts?.password,
    });
    return (await res.json()) as FindTextResult;
  }

  /**
   * Render an HTML document to PDF in headless Chromium. Returns the bytes
   * plus `pages` and `blockedRequests` from the response headers.
   * Errors: missing_html, html_too_large, invalid_page_size,
   * invalid_parameter, too_many_pages, render_timeout, renderer_busy and
   * renderer_unavailable (503, retry shortly).
   */
  async htmlToPdf(request: HtmlToPdfRequest): Promise<HtmlToPdfResult> {
    const res = await this.request('/api/html-to-pdf', {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const pages = res.headers.get('x-pdfops-pages');
    const blocked = res.headers.get('x-pdfops-blocked-requests');
    return {
      pdf: new Uint8Array(await res.arrayBuffer()),
      ...(pages && /^\d+$/.test(pages) ? { pages: Number(pages) } : {}),
      ...(blocked && /^\d+$/.test(blocked) ? { blockedRequests: Number(blocked) } : {}),
    };
  }

  /**
   * One PDF page per JPG or PNG, in the order given. `pageSize` "fit"
   * (default) makes each page the image's size; "a4" and "letter" scale the
   * image to fit inside `margin` points (default 36; 0 for "fit").
   * Errors: unsupported_image_format, invalid_image, image_too_large,
   * too_many_images, invalid_parameter.
   */
  async imageToPdf(
    images: PdfInput[],
    opts?: {
      pageSize?: 'fit' | 'a4' | 'letter';
      orientation?: 'auto' | 'portrait' | 'landscape';
      margin?: number;
    },
  ): Promise<Uint8Array> {
    const fd = new FormData();
    images.forEach((img, i) => fd.append('pdf', toBlob(img, 'application/octet-stream'), `image-${i}`));
    if (opts?.pageSize !== undefined) fd.append('page_size', opts.pageSize);
    if (opts?.orientation !== undefined) fd.append('orientation', opts.orientation);
    if (opts?.margin !== undefined) fd.append('margin', String(opts.margin));
    const res = await this.request('/api/image-to-pdf', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Lay out Markdown, plain text or CSV as a PDF (built-in fonts, no
   * Chromium). Deterministic: the same request returns identical bytes.
   * Output is never branded. Standard Helvetica characters only.
   * Errors: missing_content, content_too_large, invalid_format,
   * unsupported_characters, invalid_csv, too_many_pages, invalid_parameter.
   */
  async textToPdf(request: TextToPdfRequest): Promise<Uint8Array> {
    const res = await this.request('/api/text-to-pdf', {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Current quota state for the configured API key. */
  async usage(): Promise<UsageResult> {
    if (!this.apiKey) {
      throw new PdfOpsError(401, 'missing_api_key', 'usage() requires apiKey');
    }
    const res = await this.request('/api/usage', {
      method: 'GET',
      headers: this.headers(),
    });
    return (await res.json()) as UsageResult;
  }

  /**
   * Request a free API key (250 req/mo) for an email address. The key
   * is EMAILED, never returned here. Re-signup rotates the key.
   */
  async signup(email: string): Promise<void> {
    await this.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  }
}

export default PdfOps;
