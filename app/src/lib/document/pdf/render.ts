/**
 * Drawing a page of the document so the reader can see where they are putting
 * the signature.
 *
 * The renderer is PDF.js, and it is loaded on demand rather than bundled into
 * the first download. It is by far the largest thing this app touches, and
 * somebody who only ever wants a signature PNG should not pay for it — the
 * import below is what keeps it out of the initial chunk, so it must stay
 * dynamic even though a static one would read more plainly.
 *
 * PDF.js is only ever asked to *display*. Nothing it produces is written back
 * into the document: the file that gets saved is the one the writer library
 * assembled from the original bytes, and the raster here never touches it.
 */

type PdfJs = typeof import('pdfjs-dist');

let loading: Promise<PdfJs> | null = null;

/**
 * Load PDF.js once, worker and all.
 *
 * The worker URL is resolved through the bundler, so it is served from this
 * origin like everything else. PDF.js's own default is a CDN, which would be
 * both a third-party request and a dependency on being online — neither is
 * acceptable here, so it is always set explicitly.
 */
function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return loading;
}

export interface RenderedPage {
  readonly canvas: HTMLCanvasElement;
  /** Size in CSS pixels, which is what the placement overlay is measured in. */
  readonly width: number;
  readonly height: number;
}

/**
 * Render one page to a canvas, `width` CSS pixels across.
 *
 * `bytes` is copied before it is handed over because PDF.js takes ownership of
 * the buffer it is given and detaches it — passing the same array the writer
 * library is holding would empty it out from underneath, and the document
 * would fail to save with nothing obvious to blame.
 */
export async function renderPage(
  bytes: Uint8Array,
  pageNumber: number,
  width: number,
): Promise<RenderedPage> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;

  try {
    const page = await doc.getPage(pageNumber);

    // getViewport already accounts for /Rotate, so the scale here is against
    // the page as displayed rather than as stored.
    const unscaled = page.getViewport({ scale: 1 });
    const scale = width / unscaled.width;
    const viewport = page.getViewport({ scale });

    // Draw at the device's real resolution, then let CSS size it back down, so
    // the preview is sharp on a high-density screen instead of soft.
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser did not provide a 2D canvas to draw the page on.');
    context.scale(ratio, ratio);

    await page.render({ canvasContext: context, viewport, canvas }).promise;

    return { canvas, width: viewport.width, height: viewport.height };
  } finally {
    // Tear the whole task down, not just the document: the worker it started
    // stays alive otherwise, and a reader flipping through pages would leave
    // one behind on every page.
    await task.destroy();
  }
}
