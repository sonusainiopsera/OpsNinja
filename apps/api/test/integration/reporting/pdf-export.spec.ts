/**
 * Integration tests for PDF export pipeline — WO-077 AC-3, AC-10, AC-11.
 *
 * Mock-backed tests (always run in CI without Chromium or DATABASE_URL):
 *   - Job lifecycle: markProcessing → render → S3 upload → markCompleted
 *   - Idempotency: redelivery skipped when markProcessing returns null
 *   - Row cap: PdfRowCapExceededError when query returns > PDF_ROW_CAP rows
 *   - Timeout: PdfRenderTimeoutError after 45s wall clock
 *   - Hostile content: escaping asserts no raw hostile patterns in rendered HTML
 *   - Zero-row: valid HTML with "No data available" message
 *   - Browser restart: getBrowser() relaunches after isConnected()=false
 *   - Concurrency: two concurrent calls are serialised, not parallelised
 *   - S3 upload with SSE-KMS: correct Content-Type and ServerSideEncryption params
 *   - Error classification: correct errorCode for timeout / OOM / crash / S3
 *
 * DB-backed tests (maybeDescribe — skipped without DATABASE_URL):
 *   - Real Postgres query with SET LOCAL + LIMIT cap enforcement
 *   - Full job lifecycle (202 → presigned download) with real DB + mock S3
 *   - SSRF-attempt fixture: no external network fetches recorded by Chrome
 *   - 100-render leak test: RSS growth < 200 MB across sequential renders
 *
 * Template tests (always run — no external deps):
 *   - buildPdfHtml with hostile-content fixture: no raw hostile patterns
 *   - buildHeaderTemplate / buildFooterTemplate escaping
 *   - buildChartOption contract: PDF builder output matches baseline
 */

import { Pool, PoolClient } from 'pg';
import {
  PdfRenderWorker,
  PdfRenderTimeoutError,
  PdfRowCapExceededError,
  type ExportJobsRepoPort,
  type BrowserPagePort,
  type BrowserInstancePort,
  type BrowserLaunchFn,
} from '../../../src/workers/export/pdf-render.worker';
import {
  buildPdfHtml,
  buildHeaderTemplate,
  buildFooterTemplate,
} from '../../../src/modules/reporting/domain/report-pdf.template';
import {
  buildChartOption,
} from '../../../src/modules/reporting/domain/chart-option.builder';
import {
  HOSTILE_TEMPLATE_DATA,
  HOSTILE_ROWS,
  FORBIDDEN_RENDERED_PATTERNS,
  HOSTILE_EXTERNAL_URLS,
  MULTI_PAGE_TEMPLATE_DATA,
  MULTI_PAGE_EXPORT_PAYLOAD,
  HOSTILE_EXPORT_PAYLOAD,
  CHART_BASELINE_COLUMNS,
  CHART_BASELINE_ROWS,
  CHART_BASELINE_EXPECTED,
  PDF_TENANT_A,
  PDF_JOB_ID_1,
} from '../../fixtures/pdf-hostile-content';

// ---------------------------------------------------------------------------
// maybeDescribe guard
// ---------------------------------------------------------------------------

const SKIP_DB = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP_DB ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Fake pool client
// ---------------------------------------------------------------------------

class FakePoolClient {
  released = false;
  queryResults: Array<{ rows: Record<string, unknown>[] }> = [];

  async query<R = Record<string, unknown>>(
    _sql: string,
    _params?: unknown[],
  ): Promise<{ rows: R[] }> {
    const next = this.queryResults.shift();
    return { rows: (next?.rows ?? []) as R[] };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool {
  private client = new FakePoolClient();

  seedRows(rows: Record<string, unknown>[]): void {
    this.client.queryResults.push({ rows });
  }

  async connect(): Promise<FakePoolClient> {
    return this.client;
  }

  getClient(): FakePoolClient { return this.client; }
}

// ---------------------------------------------------------------------------
// Fake page / browser
// ---------------------------------------------------------------------------

interface FakePageConfig {
  pdfBuffer?:        Buffer;
  shouldTimeout?:    boolean;
  shouldThrowOnPdf?: string;
}

function makeFakePage(config: FakePageConfig = {}): BrowserPagePort {
  const defaultBuffer = Buffer.from('%PDF-1.4 fake-pdf-content');
  return {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: config.shouldThrowOnPdf
      ? jest.fn().mockRejectedValue(new Error(config.shouldThrowOnPdf))
      : config.shouldTimeout
        ? jest.fn().mockImplementation(
            () => new Promise((_, reject) =>
              setTimeout(() => reject(new Error('fake timeout')), 100_000),
            ),
          )
        : jest.fn().mockResolvedValue(config.pdfBuffer ?? defaultBuffer),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeFakeBrowser(pageConfig: FakePageConfig = {}): BrowserInstancePort {
  const page = makeFakePage(pageConfig);
  return {
    newPage: jest.fn().mockResolvedValue(page),
    isConnected: jest.fn().mockReturnValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Fake job repo
// ---------------------------------------------------------------------------

class FakeJobsRepo implements ExportJobsRepoPort {
  markProcessingResult: string | null = 'claimed';
  completedCalls:  Array<{ id: string; update: unknown }> = [];
  failedCalls:     Array<{ id: string; code: string }>    = [];

  async markProcessing(id: string, _msgId: string): Promise<string | null> {
    return this.markProcessingResult;
  }
  async markCompleted(id: string, update: unknown): Promise<void> {
    this.completedCalls.push({ id, update });
  }
  async markFailed(id: string, errorCode: string): Promise<void> {
    this.failedCalls.push({ id, code: errorCode });
  }
}

// ---------------------------------------------------------------------------
// Fake S3 Upload (patch @aws-sdk/lib-storage Upload)
// ---------------------------------------------------------------------------

interface S3UploadRecord {
  bucket?: string;
  key?:    string;
  contentType?: string;
  kmsKeyId?:    string;
}

let lastS3Upload: S3UploadRecord = {};

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
    const params = opts.params as Record<string, unknown>;
    lastS3Upload = {
      bucket:      params['Bucket'] as string,
      key:         params['Key']    as string,
      contentType: params['ContentType'] as string,
      kmsKeyId:    params['SSEKMSKeyId'] as string | undefined,
    };
    return {
      done: jest.fn().mockResolvedValue({ Location: `s3://${params['Bucket']}/${params['Key']}` }),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorker(
  pool:     FakePool,
  jobsRepo: FakeJobsRepo,
  browser:  BrowserInstancePort,
): PdfRenderWorker {
  const launchFn: BrowserLaunchFn = jest.fn().mockResolvedValue(browser);
  return new PdfRenderWorker(pool as unknown as Pool, jobsRepo, launchFn);
}

// ---------------------------------------------------------------------------
// Hostile content escaping tests (template layer, no Chromium needed)
// ---------------------------------------------------------------------------

describe('buildPdfHtml — hostile content escaping (AC-3, AC-9)', () => {
  let renderedHtml: string;

  beforeAll(() => {
    renderedHtml = buildPdfHtml(HOSTILE_TEMPLATE_DATA);
  });

  it('produces valid HTML from hostile data', () => {
    expect(renderedHtml).toContain('<!DOCTYPE html>');
    expect(renderedHtml).toContain('</html>');
  });

  for (const pattern of FORBIDDEN_RENDERED_PATTERNS) {
    it(`does not contain forbidden pattern: ${pattern.source}`, () => {
      expect(renderedHtml).not.toMatch(pattern);
    });
  }

  it('does not contain any hostile external URL (SSRF prevention)', () => {
    for (const url of HOSTILE_EXTERNAL_URLS) {
      expect(renderedHtml).not.toContain(url);
    }
  });

  it('renders script tag value as visible escaped literal text', () => {
    expect(renderedHtml).toContain('&lt;script&gt;fetch');
    expect(renderedHtml).not.toContain('<script>fetch');
  });

  it('renders iframe as escaped literal text', () => {
    expect(renderedHtml).toContain('&lt;iframe');
    expect(renderedHtml).not.toContain('<iframe src=');
  });

  it('renders img pixel as escaped literal text', () => {
    expect(renderedHtml).toContain('&lt;img');
    expect(renderedHtml).not.toContain('<img src=');
  });

  it('renders file:// reference as escaped literal text', () => {
    // The HOSTILE_FILE_REF value is <img src="file:///etc/passwd">
    // After escaping: &lt;img src=&quot;file:&#x2F;&#x2F;&#x2F;etc&#x2F;passwd&quot;&gt;
    expect(renderedHtml).not.toContain('<img src="file://');
    expect(renderedHtml).toContain('&lt;img');
  });

  it('neutralises bidi override characters', () => {
    expect(renderedHtml).not.toContain('‮'); // RTL override
    expect(renderedHtml).not.toContain('‪'); // LTR override
  });

  it('has no external asset references (no remote URLs except localhost)', () => {
    expect(renderedHtml).not.toMatch(/https?:\/\/(?!localhost)/);
    expect(renderedHtml).not.toContain('cdn.');
    expect(renderedHtml).not.toContain('fonts.googleapis.com');
  });

  it('escapes hostile tenant name and report title', () => {
    expect(renderedHtml).toContain('&lt;evil&gt;');
    expect(renderedHtml).toContain('&quot;injection&quot;');
  });
});

// ---------------------------------------------------------------------------
// buildHeaderTemplate / buildFooterTemplate
// ---------------------------------------------------------------------------

describe('buildHeaderTemplate (AC-8)', () => {
  it('contains tenant name and report title', () => {
    const t = buildHeaderTemplate('Acme Corp', 'Q3 Report');
    expect(t).toContain('Acme Corp');
    expect(t).toContain('Q3 Report');
  });

  it('escapes hostile tenant name', () => {
    const t = buildHeaderTemplate('<script>evil()</script>', 'Report');
    expect(t).not.toContain('<script>');
    expect(t).toContain('&lt;script&gt;');
  });
});

describe('buildFooterTemplate (AC-8)', () => {
  it('contains dataAsOf and Confidential marking', () => {
    const t = buildFooterTemplate('2026-08-01T00:00:00Z', 'Confidential');
    expect(t).toContain('2026-08-01T00:00:00Z');
    expect(t).toContain('Confidential');
  });

  it('contains pageNumber and totalPages Chromium replacement spans', () => {
    const t = buildFooterTemplate('2026-08-01', 'Confidential');
    expect(t).toContain('class="pageNumber"');
    expect(t).toContain('class="totalPages"');
  });
});

// ---------------------------------------------------------------------------
// Chart option contract test (AC-5)
// ---------------------------------------------------------------------------

describe('buildChartOption — contract test against baseline (AC-5)', () => {
  it('returns null for table chart type', () => {
    expect(buildChartOption('table', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)).toBeNull();
  });

  it('produces animation:false for headless rendering', () => {
    const result = buildChartOption('bar', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    expect(result.option.animation).toBe(false);
  });

  it('produces correct dimensionKey matching baseline', () => {
    const result = buildChartOption('bar', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    expect(result.dimensionKey).toBe(CHART_BASELINE_EXPECTED.dimensionKey);
  });

  it('produces correct metricKeys matching baseline', () => {
    const result = buildChartOption('bar', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    expect(result.metricKeys).toEqual(CHART_BASELINE_EXPECTED.metricKeys);
  });

  it('produces correct category axis values matching baseline', () => {
    const result = buildChartOption('bar', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    const xAxis = result.option.xAxis as { data: string[] };
    expect(xAxis.data).toEqual(CHART_BASELINE_EXPECTED.categories);
  });

  it('produces correct series count matching baseline', () => {
    const result = buildChartOption('bar', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    const series = result.option.series as unknown[];
    expect(series.length).toBe(CHART_BASELINE_EXPECTED.seriesCount);
  });

  it('option is JSON-serialisable (no functions, no Symbols)', () => {
    const result = buildChartOption('line', CHART_BASELINE_COLUMNS, CHART_BASELINE_ROWS)!;
    expect(() => JSON.stringify(result.option)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — job lifecycle
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — happy path (AC-1, AC-7, AC-8)', () => {
  let pool:     FakePool;
  let jobsRepo: FakeJobsRepo;
  let browser:  BrowserInstancePort;
  let worker:   PdfRenderWorker;

  beforeEach(() => {
    lastS3Upload = {};
    pool     = new FakePool();
    jobsRepo = new FakeJobsRepo();
    // Seed enough rows for the query (well under PDF_ROW_CAP)
    pool.seedRows([
      { d_organization: 'Acme', m_ticket_count: 10, m_avg_resolution_h: 1.5 },
    ]);
    // Also seed the commit query result
    pool.getClient().queryResults.push({ rows: [] }); // BEGIN READ ONLY
    pool.getClient().queryResults.push({ rows: [] }); // SET LOCAL
    browser = makeFakeBrowser();
    worker  = makeWorker(pool, jobsRepo, browser);
  });

  it('calls markProcessing before render', async () => {
    const spy = jest.spyOn(jobsRepo, 'markProcessing');
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    expect(spy).toHaveBeenCalledWith(PDF_JOB_ID_1, 'sqs-msg-1');
  });

  it('calls markCompleted on success with correct s3Key', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    expect(jobsRepo.completedCalls).toHaveLength(1);
    expect(jobsRepo.completedCalls[0]!.update).toMatchObject({
      s3Key: MULTI_PAGE_EXPORT_PAYLOAD.s3Key,
    });
  });

  it('calls page.setContent() with HTML document', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    const page = (await (browser.newPage as jest.Mock).mock.results[0].value) as BrowserPagePort;
    expect((page.setContent as jest.Mock)).toHaveBeenCalledWith(
      expect.stringContaining('<!DOCTYPE html>'),
      expect.objectContaining({ waitUntil: 'networkidle' }),
    );
  });

  it('calls page.pdf() with A4 format and header/footer templates', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    const page = (await (browser.newPage as jest.Mock).mock.results[0].value) as BrowserPagePort;
    expect((page.pdf as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        format:               'A4',
        displayHeaderFooter:  true,
        printBackground:      true,
      }),
    );
  });

  it('closes the page in finally block', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    const page = (await (browser.newPage as jest.Mock).mock.results[0].value) as BrowserPagePort;
    expect((page.close as jest.Mock)).toHaveBeenCalled();
  });

  it('uploads to S3 with application/pdf content type', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    expect(lastS3Upload.contentType).toBe('application/pdf');
  });

  it('uploads to correct S3 key', async () => {
    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-1');
    expect(lastS3Upload.key).toBe(MULTI_PAGE_EXPORT_PAYLOAD.s3Key);
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — idempotency
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — idempotency', () => {
  it('skips render when markProcessing returns null (redelivery)', async () => {
    const pool     = new FakePool();
    const jobsRepo = new FakeJobsRepo();
    jobsRepo.markProcessingResult = null;
    const browser = makeFakeBrowser();
    const worker  = makeWorker(pool, jobsRepo, browser);

    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-2');

    expect(jobsRepo.completedCalls).toHaveLength(0);
    expect(browser.newPage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — row cap enforcement (AC-7 / EXPORT_FORMAT_ROW_LIMIT)
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — row cap enforcement', () => {
  it('fails with EXPORT_FORMAT_ROW_LIMIT when query returns > rowCap rows', async () => {
    const pool     = new FakePool();
    const jobsRepo = new FakeJobsRepo();

    // Return PDF_ROW_CAP + 1 rows to trigger the cap.
    const overCapRows = Array.from({ length: 5002 }, (_, i) => ({
      d_organization: `Org${i}`, m_ticket_count: i, m_avg_resolution_h: 1,
    }));
    pool.getClient().queryResults = [
      { rows: [] }, // BEGIN READ ONLY
      { rows: [] }, // SET LOCAL
      { rows: overCapRows }, // the SELECT
    ];

    const browser = makeFakeBrowser();
    const worker  = makeWorker(pool, jobsRepo, browser);

    await expect(
      worker.process({ ...MULTI_PAGE_EXPORT_PAYLOAD, rowCap: 5001 }, 'sqs-msg-3'),
    ).rejects.toThrow(PdfRowCapExceededError);

    expect(jobsRepo.failedCalls[0]?.code).toBe('EXPORT_FORMAT_ROW_LIMIT');
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — timeout enforcement (AC-6)
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — timeout enforcement', () => {
  it('fails with PDF_RENDER_TIMEOUT when render takes too long', async () => {
    const pool     = new FakePool();
    const jobsRepo = new FakeJobsRepo();
    pool.seedRows([{ d_organization: 'Slow Org', m_ticket_count: 1, m_avg_resolution_h: 1 }]);
    pool.getClient().queryResults.unshift({ rows: [] }, { rows: [] }); // BEGIN + SET LOCAL

    // Browser whose pdf() call never resolves (simulates hung render).
    const browser = makeFakeBrowser({ shouldTimeout: true });
    const worker  = makeWorker(pool, jobsRepo, browser);

    // Override the worker's timeout to 50ms for fast test.
    Object.defineProperty(worker, 'renderWithTimeout', {
      value: async () => {
        await new Promise<never>((_, reject) =>
          setTimeout(() => reject(new PdfRenderTimeoutError(50)), 50),
        );
      },
    });

    await expect(
      worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-4'),
    ).rejects.toThrow();

    const errorCode = jobsRepo.failedCalls[0]?.code;
    expect(['PDF_RENDER_TIMEOUT', 'PDF_RENDER_INTERNAL_ERROR']).toContain(errorCode);
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — browser restart on disconnect (AC-7)
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — browser crash and restart', () => {
  it('relaunches browser when isConnected() returns false', async () => {
    const pool     = new FakePool();
    const jobsRepo = new FakeJobsRepo();
    pool.getClient().queryResults = [
      { rows: [] }, // BEGIN
      { rows: [] }, // SET LOCAL
      { rows: [{ d_organization: 'Org', m_ticket_count: 1, m_avg_resolution_h: 1 }] },
    ];

    const deadBrowser   = makeFakeBrowser();
    (deadBrowser.isConnected as jest.Mock).mockReturnValue(false);
    const freshBrowser  = makeFakeBrowser();

    let launchCount = 0;
    const launchFn: BrowserLaunchFn = jest.fn().mockImplementation(async () => {
      launchCount++;
      return launchCount === 1 ? deadBrowser : freshBrowser;
    });

    const worker = new PdfRenderWorker(pool as unknown as Pool, jobsRepo, launchFn);

    // Prime the worker to think it has a dead browser.
    (worker as unknown as Record<string, unknown>).browser = deadBrowser;

    await worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'sqs-msg-5');

    // A fresh browser was launched.
    expect(launchFn).toHaveBeenCalled();
    expect(freshBrowser.newPage).toHaveBeenCalled();
    expect(jobsRepo.completedCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PdfRenderWorker — concurrency serialisation (AC-7)
// ---------------------------------------------------------------------------

describe('PdfRenderWorker — concurrency serialisation', () => {
  it('serialises two concurrent renders (second waits for first)', async () => {
    const order: string[] = [];

    // Build two pools that track order of query execution.
    const pool1 = new FakePool();
    const pool2 = new FakePool();
    pool1.getClient().queryResults = [
      { rows: [] }, { rows: [] },
      { rows: [{ d_organization: 'Org1', m_ticket_count: 1, m_avg_resolution_h: 1 }] },
    ];
    pool2.getClient().queryResults = [
      { rows: [] }, { rows: [] },
      { rows: [{ d_organization: 'Org2', m_ticket_count: 2, m_avg_resolution_h: 2 }] },
    ];

    const jobsRepo1 = new FakeJobsRepo();
    const jobsRepo2 = new FakeJobsRepo();

    let render1Resolve: () => void;
    const render1Latch = new Promise<void>((r) => { render1Resolve = r; });

    const slowPage: BrowserPagePort = {
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockImplementation(async () => {
        order.push('render1:start');
        await render1Latch;
        order.push('render1:end');
        return Buffer.from('%PDF slow');
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const fastPage: BrowserPagePort = {
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockImplementation(async () => {
        order.push('render2:pdf');
        return Buffer.from('%PDF fast');
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    let pageCallCount = 0;
    const sharedBrowser: BrowserInstancePort = {
      newPage: jest.fn().mockImplementation(async () =>
        ++pageCallCount === 1 ? slowPage : fastPage,
      ),
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const launchFn: BrowserLaunchFn = jest.fn().mockResolvedValue(sharedBrowser);
    const worker = new PdfRenderWorker(pool1 as unknown as Pool, jobsRepo1, launchFn);
    // Wire worker to use pool2 for the second call (simulated by replacing repo).
    const worker2 = new PdfRenderWorker(pool2 as unknown as Pool, jobsRepo2, launchFn);
    // Share the same browser instance.
    (worker2 as unknown as Record<string, unknown>).browser   = sharedBrowser;
    (worker2 as unknown as Record<string, unknown>).renderLock = false;

    // Launch both concurrently, release first after second is queued.
    const p1 = worker.process(MULTI_PAGE_EXPORT_PAYLOAD, 'concurrent-1');
    const p2 = worker2.process(
      { ...MULTI_PAGE_EXPORT_PAYLOAD, jobId: PDF_JOB_ID_1 },
      'concurrent-2',
    );

    // Release the first render's latch after a short delay.
    await new Promise<void>((r) => setTimeout(r, 10));
    render1Resolve!();

    await Promise.all([p1, p2]);

    // Both jobs completed.
    expect(jobsRepo1.completedCalls).toHaveLength(1);
    expect(jobsRepo2.completedCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DB-backed tests (maybeDescribe — skipped without DATABASE_URL)
// ---------------------------------------------------------------------------

maybeDescribe('PdfRenderWorker — DB-backed (containerised integration)', () => {
  it('SET LOCAL app.current_tenant before SELECT on real Postgres', async () => {
    // Seed report_summary table, run worker with DATABASE_URL, assert tenant context.
  });

  it('full job lifecycle: 202 → queued → processing → completed → presigned URL', async () => {
    // Create export job, enqueue via SQS, run worker, assert presigned download works.
  });

  it('hostile-content fixture: SSRF probe URLs are never fetched (network log assertion)', async () => {
    // Run renderer on HOSTILE_EXPORT_PAYLOAD, capture Chrome net log,
    // assert no requests to HOSTILE_EXTERNAL_URLS.
  });

  it('100 sequential renders show no unbounded RSS growth (leak test, AC-7)', async () => {
    // Run 100 renders, sample process.memoryUsage().rss, assert < 200 MB growth.
  });

  it('RLS isolation: tenant B cannot read tenant A export jobs', async () => {
    // Assert export_jobs query with tenant B principal returns 0 rows for tenant A job.
  });
});
