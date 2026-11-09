// pdfops — typed client for the PDFops API (https://pdfops.dev).
//
// Zero dependencies. Uses only WHATWG fetch / FormData / Blob, so the
// same build runs in Cloudflare Workers, Vercel Edge, Deno, Bun,
// Node 18+, and browsers. Errors carry the API's structured
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
export const SDK_VERSION = '0.6.0';

/** Binary PDF input: any of the common runtime shapes. */
export type PdfInput = Blob | ArrayBuffer | Uint8Array;

export interface InspectedField {
  name: string;
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
}

export interface InvoiceItem {
  description: string;
  /** Default 1. */
  quantity?: number;
  unit_price: number;
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

/** Structured API error — `code` is the API's stable `error` slug. */
export class PdfOpsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    details: string,
  ) {
    super(`${code}: ${details}`);
    this.name = 'PdfOpsError';
  }
}

const toBlob = (input: PdfInput): Blob => {
  if (input instanceof Blob) return input;
  // Copy into a fresh ArrayBuffer-backed view — accepts SharedArrayBuffer
  // views and offset subarrays alike.
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
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
    this.fetchImpl = options.fetch ?? fetch;
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
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      let code = `http_${res.status}`;
      let details = res.statusText;
      try {
        const body = (await res.json()) as { error?: string; details?: string };
        if (body.error) code = body.error;
        if (body.details) details = body.details;
      } catch {
        // non-JSON error body — keep the status fallback
      }
      throw new PdfOpsError(res.status, code, details);
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
