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
   * this SDK inside another tool.
   */
  clientTag?: string;
}

/** Binary PDF input: any of the common runtime shapes. */
export type PdfInput = Blob | ArrayBuffer | Uint8Array;

export interface InspectedField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist' | 'unsupported';
  value?: string;
  checked?: boolean;
  options?: string[];
  readOnly: boolean;
  raw?: string;
}

export interface InspectResult {
  count: number;
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
  /** Shown verbatim; also pins the PDF's metadata dates (determinism). */
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

export class PdfOps {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clientTag?: string;

  constructor(options: PdfOpsOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://pdfops.dev').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.clientTag = options.clientTag;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    if (this.clientTag) h['X-Pdfops-Client'] = this.clientTag;
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
   */
  async fillForm(
    pdf: PdfInput,
    fields: Record<string, string>,
  ): Promise<Uint8Array> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
    fd.append('fields', JSON.stringify(fields));
    const res = await this.request('/api/fill-form', {
      method: 'POST',
      headers: this.headers(),
      body: fd,
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Merge two or more PDFs, in order. Returns the combined PDF bytes. */
  async merge(pdfs: PdfInput[]): Promise<Uint8Array> {
    if (pdfs.length < 2) {
      throw new PdfOpsError(400, 'too_few_pdfs', 'merge needs at least 2 PDFs');
    }
    const fd = new FormData();
    pdfs.forEach((p, i) => fd.append('pdf', toBlob(p), `part-${i}.pdf`));
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
   * no form returns count 0 — not an error.
   */
  async inspect(pdf: PdfInput): Promise<InspectResult> {
    const fd = new FormData();
    fd.append('pdf', toBlob(pdf), 'input.pdf');
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
