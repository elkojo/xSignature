<script lang="ts">
  /**
   * Signing a document: take a file in, put a signature on it, give a PDF back.
   *
   * The screen holds no geometry. Where the signature lands is a rectangle in
   * fractions of the displayed page, and turning that into marks on the page is
   * `lib/document/place` and `lib/document/stamp` — including the awkward part,
   * which is that a page may be stored rotated and cropped and the reader is
   * dragging a box on neither of those.
   *
   * The preview is drawn by PDF.js and the file is written by the PDF writer,
   * and the two never meet: nothing rasterized for the screen goes into the
   * saved document. What is saved is the original bytes with a path drawn on
   * top, so the text in the document stays text.
   */
  import { openPdf, UnreadablePdf, type OpenPdf } from '../lib/document/pdf/inspect';
  import { renderPage } from '../lib/document/pdf/render';
  import { fitInside, displayedSize } from '../lib/document/place/placement';
  import { applyStamp } from '../lib/document/stamp/stamp';
  import { accept, HEAD_BYTES, type Accepted } from '../lib/document/accept';
  import { markdownToPdf } from '../lib/document/convert/markdown-to-pdf';
  import { textToPdf } from '../lib/document/convert/text-to-pdf';
  import {
    AUTHORITIES,
    authorityById,
    checkAuthorityUrl,
    DEFAULT_AUTHORITY_ID,
  } from '../lib/document/timestamp/authorities';
  import { applyDocTimeStamp, type Outgoing } from '../lib/document/timestamp/apply';
  import type { Timestamp } from '../lib/document/timestamp/response';
  import { applyImageStamp } from '../lib/document/stamp/stamp';
  import {
    looksLikeJpeg,
    looksLikePng,
    readSignatureImage,
    readSignatureSvg,
    UnreadableSignature,
    type Signature,
  } from '../lib/document/signature/read';
  import {
    describeDpi,
    pixelsNeededFor,
    resolutionFor,
  } from '../lib/document/signature/resolution';
  import { downloadBlob } from '../lib/signature/download';
  import { toPathData } from '../lib/signature/path';
  import { PDFDocument } from '@cantoo/pdf-lib';
  import { checkLinks, orderChain, readCertificates, type ChainLink } from '../lib/document/certificate/read/chain';
  import { checkSignatures, type CheckedSignature } from '../lib/document/verify/verify';
  import {
    detectKeyFile,
    readKeyFile,
    UnreadableKeyFile,
    validityAt,
    type DetectedKeyFile,
    type Identity,
  } from '../lib/document/certificate/read/read';
  import {
    applyCertificateSignature,
    fromAuthority,
    SignatureTooLarge,
    type SignedPdf,
    type TimestampSource,
  } from '../lib/document/certificate/sign/apply';
  import { buildAppearance, fitBlock } from '../lib/document/certificate/appearance/block';
  import { loadAppearanceFont } from '../lib/document/certificate/appearance/font';
  import { blockHeightFor, detailLines } from '../lib/document/certificate/appearance/layout';
  import { widgetRect } from '../lib/document/place/placement';
  import { unsupportedCharacters } from '../lib/signature/type/coverage';
  import type { Font } from 'opentype.js';

  /** How wide the page preview is drawn, in CSS pixels. */
  const PREVIEW_WIDTH = 520;

  // ---- step 1: the document -------------------------------------------------

  let fileName = $state('');
  let verdict = $state<Accepted | null>(null);
  let bytes = $state<Uint8Array<ArrayBuffer> | null>(null);
  let opened = $state<OpenPdf | null>(null);
  let openError = $state('');
  /** True when what is being stamped was made here rather than dropped in. */
  let converted = $state(false);
  /** Size of the file as dropped, which is the one the reader recognises. */
  let sourceSize = $state(0);
  let over = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function take(file: File | undefined) {
    if (!file) return;
    reset();
    fileName = file.name;

    const all = new Uint8Array(await file.arrayBuffer());
    sourceSize = all.length;
    verdict = accept(file.name, all.subarray(0, HEAD_BYTES));

    if (verdict.route === 'text') {
      // Laid out here rather than fetched for: plain text has no structure to
      // preserve, so this costs nothing and happens immediately.
      try {
        const source = new TextDecoder().decode(all);
        const isMarkdown = /\.(md|markdown)$/i.test(file.name);
        bytes = isMarkdown
          ? await markdownToPdf(source, { title: file.name })
          : await textToPdf(source, { title: file.name });
        converted = true;
      } catch {
        openError = 'This file could not be laid out as a PDF.';
        return;
      }
    } else if (verdict.route === 'stamp') {
      bytes = all;
    } else {
      return;
    }

    try {
      opened = await openPdf(bytes!);
      page = 0;
      // Located by `openPdf`, judged here: whether they still hold decides what
      // the reader is told, and it is the one thing worth knowing before adding
      // a name to a document somebody else has already signed.
      existing = opened.existing.length > 0 ? await checkSignatures(bytes!) : [];
    } catch (cause) {
      openError =
        cause instanceof UnreadablePdf
          ? cause.message
          : 'This document could not be opened, and the reason was not one the app recognises.';
    }
  }

  function reset() {
    existing = [];
    verdict = null;
    converted = false;
    bytes = null;
    opened = null;
    openError = '';
    preview = null;
    saved = false;
  }

  function startOver() {
    reset();
    fileName = '';
    if (fileInput) fileInput.value = '';
  }

  /**
   * Signatures the document already carried, checked.
   *
   * A document that is already signed can still be signed again — that is what
   * counter-signing is, and it is how a contract gets a second party's name on
   * it. What it cannot survive is being *rewritten*, which is what putting ink
   * on the page would do: the writer reassembles the file, and the earlier
   * signature dictionaries do not survive that. So when there is something
   * here, the only thing offered is an appended signature.
   */
  let existing = $state<CheckedSignature[]>([]);

  /** True when this document already carries a signature or a timestamp. */
  let alreadySigned = $derived(existing.length > 0);

  /** A first signer may forbid any later change. Then there is nothing to do. */
  let sealed = $derived(existing.some((e) => e.permits === 1));

  /** Counter-signing a document that has already been tampered with. */
  let brokenBefore = $derived(existing.filter((e) => e.verdict === 'altered' || e.verdict === 'broken'));

  // ---- step 2: the signature ------------------------------------------------

  /**
   * The signature is made on the other screen and brought here.
   *
   * There was a second, cut-down signature builder on this screen once, which
   * could type a name and nothing else. Taking it out removed the duplication
   * and gained drawn signatures at the same time: whatever the signature screen
   * can make — typed, drawn, any face, any ink — can be pasted here, because
   * what travels is the finished file rather than the controls that made it.
   */
  let signature = $state<Signature | null>(null);
  let signatureName = $state('');
  let signatureError = $state('');
  let signatureInput = $state<HTMLInputElement | null>(null);
  let signatureOver = $state(false);

  /** The ink's own box, whichever flavour arrived. */
  let box = $derived(
    signature
      ? { width: signature.width, height: signature.height }
      : null,
  );

  let pathData = $derived(
    signature?.kind === 'vector' ? toPathData(signature.commands) : '',
  );

  /** Take a signature from a file, a drop or a paste. */
  async function takeSignature(file: File | Blob, name = ''): Promise<void> {
    signatureError = '';
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      if (looksLikePng(bytes)) {
        signature = readSignatureImage(bytes, 'image/png');
      } else if (looksLikeJpeg(bytes)) {
        signature = readSignatureImage(bytes, 'image/jpeg');
      } else {
        signature = readSignatureSvg(new TextDecoder().decode(bytes));
      }
      signatureName = name || (file instanceof File ? file.name : 'pasted signature');
    } catch (cause) {
      signature = null;
      signatureName = '';
      signatureError =
        cause instanceof UnreadableSignature
          ? cause.message
          : 'That could not be read as a signature. A PNG or an SVG from the signature screen will work.';
    }
  }

  /**
   * Take whatever the clipboard is offering.
   *
   * An image flavour is preferred when there is one, because a paste carrying
   * both is usually a picture with a filename attached as text. Failing that,
   * text is tried as SVG markup — which is how a signature copied from the
   * other screen arrives, since browsers disagree about carrying SVG as an
   * image.
   */
  async function onPaste(event: ClipboardEvent): Promise<void> {
    const items = [...(event.clipboardData?.items ?? [])];

    const image = items.find((item) => item.type === 'image/png' || item.type === 'image/jpeg');
    if (image) {
      const file = image.getAsFile();
      if (file) {
        event.preventDefault();
        await takeSignature(file, 'pasted image');
        return;
      }
    }

    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (text?.startsWith('<svg') || text?.startsWith('<?xml')) {
      event.preventDefault();
      await takeSignature(new Blob([text]), 'pasted SVG');
    }
  }

  /**
   * A URL for showing the picture, made once per file and given back when it is
   * replaced. Without the revoke every pasted signature leaks its bytes for as
   * long as the page is open.
   */
  let rasterUrl = $state('');
  $effect(() => {
    if (signature?.kind !== 'raster') {
      rasterUrl = '';
      return;
    }
    const url = URL.createObjectURL(new Blob([signature.bytes], { type: signature.type }));
    rasterUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  function clearSignature() {
    signature = null;
    signatureName = '';
    signatureError = '';
    if (signatureInput) signatureInput.value = '';
  }

  // ---- step 3: placing it ---------------------------------------------------

  let page = $state(0);
  let preview = $state<HTMLCanvasElement | null>(null);
  let previewHost = $state<HTMLElement | null>(null);
  let rendering = $state(false);

  /** Top-left corner of the signature, in fractions of the displayed page. */
  let at = $state({ x: 0.55, y: 0.78 });
  /** How much of the page's width the signature spans. */
  let span = $state(0.32);

  let geometry = $derived(opened?.pages[page] ?? null);

  /**
   * The signature's box in fractions of the page.
   *
   * The height follows from the width and the ink's own proportions, so the
   * rectangle handed to the stamp is exactly the one drawn here — no fitting
   * happens twice, and the preview cannot drift from the result.
   */
  let rect = $derived.by(() => {
    if (!box || !geometry) return null;
    const view = displayedSize(geometry);
    const width = span * view.width;

    // What is being placed is either the ink or the whole block, and they are
    // different shapes. The block's height is derived rather than dragged, so
    // that what the preview draws is the size the page gets.
    const height = placingBlock
      ? blockHeightFor({
          width,
          signature: box,
          lines: blockLines.length,
          hasLogo: logoSize !== null,
        })
      : (box.height / box.width) * width;

    return { x: at.x, y: at.y, width: span, height: height / view.height };
  });

  // Keep the signature on the sheet when it is resized near an edge.
  $effect(() => {
    if (!rect) return;
    const x = Math.min(at.x, 1 - rect.width);
    const y = Math.min(at.y, 1 - rect.height);
    if (x !== at.x || y !== at.y) at = { x: Math.max(0, x), y: Math.max(0, y) };
  });

  $effect(() => {
    const source = bytes;
    const which = page;
    if (!source || !opened) return;

    let current = true;
    rendering = true;
    void renderPage(source, which + 1, PREVIEW_WIDTH)
      .then((rendered) => {
        if (current) preview = rendered;
      })
      .catch(() => {
        if (current) openError = 'This PDF opened, but its pages could not be drawn on screen.';
      })
      .finally(() => {
        if (current) rendering = false;
      });
    return () => {
      current = false;
    };
  });

  // Swapping the canvas element in by hand: it is made by the renderer rather
  // than by this template, because PDF.js needs to own the drawing surface.
  $effect(() => {
    const host = previewHost;
    const canvas = preview;
    if (!host || !canvas) return;
    host.replaceChildren(canvas);
  });

  /**
   * How big the page is *on screen*, which is not how big it was drawn.
   *
   * The canvas is rendered at a fixed width for sharpness and then sized by
   * CSS, so on a narrow window it is displayed smaller than it was drawn. Every
   * position here is a fraction of the page, and turning a fraction into pixels
   * has to use the size the reader is actually looking at — measuring against
   * the drawn width instead put the signature in one place on screen and
   * another on the page, which is the one thing this app is built not to do.
   *
   * Observed rather than measured once, so it stays right when the window is
   * resized or the phone is turned.
   */
  let shown = $state<{ width: number; height: number } | null>(null);

  $effect(() => {
    const canvas = preview;
    if (!canvas) {
      shown = null;
      return;
    }

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width > 0) shown = { width: box.width, height: box.height };
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function onPointerDown(event: PointerEvent) {
    if (!rect || !shown) return;
    const surface = event.currentTarget as HTMLElement;
    surface.setPointerCapture(event.pointerId);

    // Where in the signature the pointer took hold, so it does not jump.
    const grabX = event.clientX;
    const grabY = event.clientY;
    const from = { ...at };

    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - grabX) / shown!.width;
      const dy = (moved.clientY - grabY) / shown!.height;
      at = {
        x: Math.min(Math.max(from.x + dx, 0), 1 - rect!.width),
        y: Math.min(Math.max(from.y + dy, 0), 1 - rect!.height),
      };
    };

    const up = () => {
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
    };

    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
  }

  /** Nudge with the arrow keys, for placement finer than a drag allows. */
  function onOverlayKey(event: KeyboardEvent) {
    if (!rect) return;
    const step = event.shiftKey ? 0.05 : 0.004;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = by[event.key];
    if (!delta) return;

    event.preventDefault();
    at = {
      x: Math.min(Math.max(at.x + delta[0], 0), 1 - rect.width),
      y: Math.min(Math.max(at.y + delta[1], 0), 1 - rect.height),
    };
  }

  // ---- step 4: the certificate ----------------------------------------------

  /**
   * Off by default, like the timestamp, and for a related reason.
   *
   * Everything up to here puts a picture on a page, which proves nothing and
   * says so. This step makes a different and much larger claim — that a named
   * key signed these exact bytes — and a claim that size is one somebody has to
   * ask for.
   */
  let wantCertificate = $state(false);

  let keyName = $state('');
  let keyBytes = $state<Uint8Array | null>(null);
  let keyKind = $state<DetectedKeyFile | null>(null);
  let keyPassword = $state('');
  let keyError = $state('');
  let opening = $state(false);
  let identities = $state<Identity[] | null>(null);
  let chosen = $state(0);
  let keyInput = $state<HTMLInputElement | null>(null);

  let identity = $derived(identities?.[chosen] ?? null);

  /** What a reader would see in a signature's properties panel. */
  let signerName = $state('');
  let signerReason = $state('');
  let signerLocation = $state('');
  /** Visible puts a block on the page; invisible signs and shows nothing. */
  let visibleBlock = $state(true);

  /**
   * Issuer certificates, when the key file did not bring its own.
   *
   * A signature is meant to carry the certificates a reader needs to trace it
   * back — and plenty of key files hold only the signer's. Supplying them here
   * is not this app vouching for anybody: they are included in the signature,
   * and the judgement stays with whatever opens the document, which is where a
   * maintained list of authorities and a working revocation check actually
   * exist.
   */
  let issuerName = $state('');
  let issuerError = $state('');
  let issuerInput = $state<HTMLInputElement | null>(null);
  let supplied = $state<Awaited<ReturnType<typeof readKeyFile>>[number]['chain']>([]);
  let links = $state<ChainLink[]>([]);

  /** The chain that will actually be embedded: the file's own, or what was added. */
  let chain = $derived(identity ? (identity.chain.length > 0 ? identity.chain : supplied) : []);

  async function takeIssuers(file: File | undefined) {
    if (!file || !identity) return;
    issuerError = '';
    const found = readCertificates(new Uint8Array(await file.arrayBuffer()));

    if (found.length === 0) {
      issuerError =
        'No certificate could be read from that file. A .pem bundle, a .crt or a .p7b from your ' +
        'certificate authority will work.';
      return;
    }

    const ordered = orderChain(identity.certificate, found);
    if (ordered.length === 0) {
      issuerError =
        'None of the certificates in that file signed yours, so they do not continue this chain. ' +
        'It may be for a different certificate.';
      return;
    }

    supplied = ordered;
    issuerName = file.name;
    links = await checkLinks(identity.certificate, ordered);
  }

  function clearIssuers() {
    supplied = [];
    links = [];
    issuerName = '';
    issuerError = '';
    if (issuerInput) issuerInput.value = '';
  }

  // A different key means a different chain; keeping the old one would embed
  // certificates that have nothing to do with the new signer.
  $effect(() => {
    void identity;
    clearIssuers();
  });

  let logoBytes = $state<Uint8Array<ArrayBuffer> | null>(null);
  let logoType = $state('');
  let logoName = $state('');
  let logoSize = $state<{ width: number; height: number } | null>(null);
  let logoError = $state('');
  let logoInput = $state<HTMLInputElement | null>(null);
  let logoUrl = $state('');

  /** The face the block is set in, fetched once the step is opened. */
  let blockFont = $state<Font | null>(null);
  let fontError = $state('');

  $effect(() => {
    if (!wantCertificate || blockFont) return;
    void loadAppearanceFont()
      .then((font) => (blockFont = font))
      .catch(() => (fontError = 'The face the signature block is set in could not be loaded.'));
  });

  /** A picture URL for the logo, given back when it is replaced. */
  $effect(() => {
    if (!logoBytes) {
      logoUrl = '';
      return;
    }
    const url = URL.createObjectURL(new Blob([logoBytes], { type: logoType }));
    logoUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  /** Take the key file, and say what it is before asking for a password. */
  async function takeKeyFile(file: File | undefined) {
    if (!file) return;
    clearKey();
    keyName = file.name;
    keyBytes = new Uint8Array(await file.arrayBuffer());
    keyKind = detectKeyFile(file.name, keyBytes);
    if (keyKind.reason) keyError = keyKind.reason;
  }

  function clearKey() {
    keyBytes = null;
    keyKind = null;
    keyError = '';
    identities = null;
    chosen = 0;
    keyPassword = '';
    signerName = '';
  }

  function forgetKey() {
    clearKey();
    keyName = '';
    if (keyInput) keyInput.value = '';
  }

  async function openKey() {
    if (!keyBytes || !keyKind) return;
    opening = true;
    keyError = '';
    try {
      identities = await readKeyFile(keyName, keyBytes, keyPassword, keyKind);
      chosen = 0;
      // Offered, not imposed: the certificate's own name is the obvious
      // starting point, and the reader may say something else.
      signerName = identities[0]?.subject ?? '';
    } catch (cause) {
      identities = null;
      keyError =
        cause instanceof UnreadableKeyFile
          ? cause.message
          : 'That key file could not be opened, and the reason was not one the app recognises.';
    } finally {
      opening = false;
      // The password is not kept a moment longer than it takes to open the
      // file. What survives is a key the browser owns and will not hand back.
      keyPassword = '';
    }
  }

  async function takeLogo(file: File | undefined) {
    if (!file) return;
    logoError = '';
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (!looksLikePng(bytes) && !looksLikeJpeg(bytes)) {
      logoError = 'A logo has to be a PNG or a JPEG. An SVG cannot be embedded in a PDF as a picture.';
      return;
    }
    try {
      const read = readSignatureImage(bytes, looksLikePng(bytes) ? 'image/png' : 'image/jpeg');
      logoBytes = bytes;
      logoType = read.type;
      logoSize = { width: read.width, height: read.height };
      logoName = file.name;
    } catch {
      logoError = 'That picture could not be read.';
    }
  }

  function clearLogo() {
    logoBytes = null;
    logoSize = null;
    logoName = '';
    logoError = '';
    if (logoInput) logoInput.value = '';
  }

  /** The lines the block will show, which decide how tall it is. */
  let blockLines = $derived(
    detailLines({
      name: signerName,
      reason: signerReason,
      location: signerLocation,
      date: new Date(),
    }),
  );

  /** Characters the block's face cannot draw, so they are said rather than shown. */
  let blockUnsupported = $derived(
    blockFont ? unsupportedCharacters(blockFont, blockLines.join(' ')) : [],
  );

  /** True when what gets placed is the block rather than the signature alone. */
  let placingBlock = $derived(wantCertificate && visibleBlock && identity !== null);

  /**
   * Whether the file may only be appended to, never rewritten.
   *
   * True for a visible certificate signature, whose ink lives in the block —
   * and true for any document that already carries a signature, whatever else
   * is being done to it.
   */
  let appendOnly = $derived(placingBlock || alreadySigned);

  // ---- the timestamp --------------------------------------------------------

  /**
   * Off, and it stays off until it is asked for.
   *
   * Every other thing this app does runs without a network. This one cannot: a
   * timestamp is somebody else's assertion about when a file existed, so
   * somebody else has to see a digest of it. That is a real departure from the
   * promise the rest of the app makes, so it is never the default and it is
   * never quiet.
   */
  let wantTimestamp = $state(false);
  let authorityId = $state(DEFAULT_AUTHORITY_ID);
  let useCustom = $state(false);
  let customUrl = $state('');
  let customError = $state('');
  let stamped = $state<Timestamp | null>(null);
  let sent = $state<Outgoing | null>(null);
  let timestampError = $state('');

  let authority = $derived(authorityById(authorityId) ?? AUTHORITIES[0]);

  /** The address the request will actually go to, or null if it is not valid. */
  let endpoint = $derived.by(() => {
    if (!useCustom) return authority.url;
    const checked = checkAuthorityUrl(customUrl);
    return 'url' in checked ? checked.url : null;
  });

  // ---- saving ---------------------------------------------------------------

  let saving = $state(false);
  let saved = $state(false);
  let saveError = $state('');

  /**
   * Put the certificate signature on, building the visible block if asked.
   *
   * The block has to exist in the document *before* it is signed — it is part
   * of what the signature covers, which is the whole difference between a
   * signature and a picture that happens to sit near one. So it is written as
   * an incremental update, the file is committed, and only then signed.
   */
  async function signWithCertificate(
    input: Uint8Array,
    timestamp?: TimestampSource,
  ): Promise<SignedPdf> {
    // The file's own chain when it has one, otherwise whatever was added here.
    const material = { ...identity!, chain };
    const details = {
      name: signerName || undefined,
      reason: signerReason || undefined,
      location: signerLocation || undefined,
    };

    if (!placingBlock) {
      return applyCertificateSignature(input, material, { ...details, page, timestamp });
    }

    const doc = await PDFDocument.load(input, {
      updateMetadata: false,
      forIncrementalUpdate: true,
    });

    const logo = logoBytes
      ? logoType === 'image/png'
        ? await doc.embedPng(logoBytes)
        : await doc.embedJpg(logoBytes)
      : undefined;

    const ink =
      signature!.kind === 'vector'
        ? ({
            kind: 'vector',
            commands: signature!.commands,
            width: signature!.width,
            height: signature!.height,
            color: signature!.color,
          } as const)
        : ({
            kind: 'raster',
            image:
              signature!.type === 'image/png'
                ? await doc.embedPng(signature!.bytes)
                : await doc.embedJpg(signature!.bytes),
            width: signature!.width,
            height: signature!.height,
          } as const);

    const view = displayedSize(geometry!);
    const appearance = buildAppearance(doc, {
      width: rect!.width * view.width,
      height: rect!.height * view.height,
      signature: ink,
      logo,
      details: { ...details, date: new Date() },
      font: blockFont!,
      fontSize: BLOCK_FONT_SIZE,
      rotation: geometry!.rotation,
    });

    const withBlock = await doc.commit({ useObjectStreams: false });
    return applyCertificateSignature(withBlock, material, {
      ...details,
      page,
      rect: widgetRect(geometry!, rect!),
      appearance,
      timestamp,
    });
  }

  async function save() {
    if (!bytes || !rect || !box || !signature) return;
    if (wantTimestamp && !endpoint) {
      customError = 'Enter a valid https address, or choose one of the authorities above.';
      return;
    }
    saving = true;
    saveError = '';
    timestampError = '';
    stamped = null;
    sent = null;
    customError = '';
    try {
      // Re-open from the original bytes so that saving twice does not stamp a
      // document that was already stamped.
      const fresh = await openPdf(bytes);

      if (appendOnly) {
        // Nothing is drawn on the page. For a visible certificate signature
        // that is because the ink belongs inside the block, where it is part
        // of what the signature covers. For an already-signed document it is
        // because drawing anything would mean rewriting the file, and the
        // signatures already on it would not survive that.
      } else if (signature!.kind === 'vector') {
        applyStamp(fresh.doc, fresh.pages[page], {
          page,
          rect,
          commands: signature!.commands,
          width: signature!.width,
          height: signature!.height,
          color: signature!.color,
        });
      } else {
        const image =
          signature!.type === 'image/png'
            ? await fresh.doc.embedPng(signature!.bytes)
            : await fresh.doc.embedJpg(signature!.bytes);
        applyImageStamp(fresh.doc, fresh.pages[page], {
          page,
          rect,
          image,
          width: signature!.width,
          height: signature!.height,
        });
      }

      // A visible certificate signature carries the picture itself, so the
      // page is left alone above and the block is built instead. An invisible
      // one, or no certificate at all, means the picture goes on the page.
      // `save()` reassembles the file. On a document that already carries
      // signatures that is not a modification but a demolition — they are gone
      // from the result entirely — so it is never reached in that case.
      let out = appendOnly ? bytes : await fresh.doc.save();

      if (wantCertificate && identity) {
        // With a certificate, a timestamp belongs *inside* the signature rather
        // than appended after it: the authority stamps the signature value, so
        // what is dated is the act of signing. It is also the same single
        // request, filed differently — not a second one.
        const source = wantTimestamp ? fromAuthority(endpoint!, (o) => (sent = o)) : undefined;

        try {
          const result = await signWithCertificate(out, source);
          out = result.bytes;
          stamped = result.timestamp;
        } catch (cause) {
          // The signature is the part worth keeping. If the authority cannot be
          // reached, sign again without it and say so, rather than losing the
          // signature over the optional half of it.
          if (!source) throw cause;
          timestampError =
            cause instanceof Error
              ? cause.message
              : 'The timestamp could not be fetched, and the reason was not one the app recognises.';
          sent = null;
          out = (await signWithCertificate(out)).bytes;
        }

        downloadBlob(new Blob([out], { type: 'application/pdf' }), signedName());
        saved = true;
        return;
      }

      if (!wantTimestamp) {
        downloadBlob(new Blob([out], { type: 'application/pdf' }), signedName());
        saved = true;
        return;
      }

      // If the authority cannot be reached, the document is still perfectly
      // good — it simply has no timestamp on it. Saying so and offering it is
      // better than failing the whole save for the optional half of it.
      try {
        const result = await applyDocTimeStamp(out, endpoint!, {
          onOutgoing: (outgoing) => (sent = outgoing),
        });
        stamped = result.timestamp;
        downloadBlob(new Blob([result.bytes], { type: 'application/pdf' }), signedName());
        saved = true;
      } catch (cause) {
        timestampError =
          cause instanceof Error
            ? cause.message
            : 'The timestamp could not be fetched, and the reason was not one the app recognises.';
        downloadBlob(new Blob([out], { type: 'application/pdf' }), signedName());
        saved = true;
      }
    } catch (cause) {
      saveError =
        cause instanceof SignatureTooLarge
          ? cause.message
          : cause instanceof UnreadableKeyFile
            ? cause.message
            : 'The signed PDF could not be written. The document may be damaged.';
    } finally {
      saving = false;
    }
  }

  /** Written out plainly, because a wall of hex is not a disclosure. */
  function groupHex(hex: string): string {
    return (hex.match(/.{1,8}/g) ?? []).join(' ');
  }

  function signedName(): string {
    const base = fileName.replace(/\.pdf$/i, '');
    return `${base || 'document'}-signed.pdf`;
  }

  let ready = $derived(
    Boolean(
      opened &&
        rect &&
        signature &&
        // Nothing can be added to a document whose first signer forbade it.
        !sealed &&
        // A certificate that was asked for but not opened is not a reason to
        // write an unsigned file quietly.
        (!wantCertificate || (identity && (!visibleBlock || blockFont))) &&
        // On an already-signed document a certificate is the only thing this
        // app can add. Without one there is nothing to save that would not
        // destroy what is there.
        (!alreadySigned || (wantCertificate && identity)),
    ),
  );

  /**
   * How the placed picture works out in dots per inch.
   *
   * Only meaningful for a raster: outlines have no resolution to run out of.
   * Measured against the width it is actually placed at, so the answer changes
   * as the size slider moves rather than being a property of the file alone.
   */
  let placedResolution = $derived.by(() => {
    if (!signature || signature.kind !== 'raster' || !rect || !geometry) return null;
    const view = displayedSize(geometry);
    return resolutionFor(signature.width, rect.width * view.width);
  });

  let neededPixels = $derived.by(() => {
    if (!rect || !geometry) return 0;
    return pixelsNeededFor(rect.width * displayedSize(geometry).width);
  });

  /** Where to draw the overlay, in the pixels the page is shown at. */
  let overlay = $derived.by(() => {
    if (!rect || !shown) return null;
    const dragged = {
      x: rect.x * shown.width,
      y: rect.y * shown.height,
      width: rect.width * shown.width,
      height: rect.height * shown.height,
    };

    // A block is exactly its rectangle — its own height was computed from its
    // width, so there is nothing left to fit. Loose ink keeps its proportions
    // inside the box instead.
    return placingBlock
      ? { ...dragged, scale: 1 }
      : fitInside(dragged, box?.width ?? 1, box?.height ?? 1);
  });

  /**
   * The block's insides at preview size.
   *
   * Computed by the same function that lays out the real thing, at the pixel
   * size it is shown, so the preview is the result rather than a drawing of it.
   */
  let blockPreview = $derived.by(() => {
    if (!placingBlock || !overlay || !box || !geometry || !blockFont) return null;

    // The block is laid out in points on the page and shown in pixels on
    // screen. One ratio carries sizes across, so the preview's proportions are
    // the page's — and the layout itself is the same function the page uses,
    // which is what keeps the two from drifting apart.
    const onPage = span * displayedSize(geometry).width;
    const toScreen = onPage > 0 ? overlay.width / onPage : 1;

    const fitted = fitBlock({
      width: overlay.width / toScreen,
      height: overlay.height / toScreen,
      signature: box,
      logo: logoSize ?? undefined,
      lines: blockLines,
      font: blockFont,
      fontSize: BLOCK_FONT_SIZE,
    });

    // Back into screen pixels, once, at the end.
    const scale = (value: number) => value * toScreen;
    return {
      signature: scaleBox(fitted.layout.signature, scale),
      logo: fitted.layout.logo ? scaleBox(fitted.layout.logo, scale) : null,
      baselines: fitted.layout.baselines.map((b) => ({ x: scale(b.x), y: scale(b.y) })),
      fontSize: scale(fitted.fontSize),
      fits: fitted.fits,
    };
  });

  const scaleBox = (box: { x: number; y: number; width: number; height: number }, by: (n: number) => number) => ({
    x: by(box.x),
    y: by(box.y),
    width: by(box.width),
    height: by(box.height),
  });

  /** In points, the size the block's details are set at on the page. */
  const BLOCK_FONT_SIZE = 7;


  function readableSize(value: number): string {
    if (value < 1024) return `${value} bytes`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} kB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<!--
  Paste is caught on the window rather than on the drop zone, because a reader
  who has just copied a signature will press Ctrl+V wherever they happen to be
  looking, not after clicking a particular box first.
-->
<svelte:window onpaste={(event) => void onPaste(event)} />

<section class="product-view">
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>Put a signature on a document</h1>
        <p>
          Open a PDF, place your signature on it and save the result. The file is read in this
          browser and never sent anywhere.
        </p>
      </div>
      <span class="secure-note">Processed in this browser</span>
    </div>

    <div class="flow-shell">
      <div class="flow-main">
        <div class="flow-panel">
          <h2 class="panel-title">1 · Choose a document</h2>
          <p class="panel-copy">
            A PDF can be stamped straight away. Plain text and Markdown are laid out here in a
            moment, on this device. Nothing else is read: a word processor's own Save As or Print
            to PDF will do a better job of its formatting than anything this page could.
          </p>

          {#if verdict}
            <div class="picked">
              <div class="picked-name">{fileName}</div>
              <div class="picked-facts">
                {verdict.format} · {readableSize(sourceSize)}{#if opened} · {opened.pages
                    .length} page{opened.pages.length === 1 ? '' : 's'}{/if}{#if converted} · laid
                  out here as a PDF{/if}
              </div>
            </div>

            {#if openError}
              <div class="notice bad"><strong>Cannot use this file.</strong> {openError}</div>
            {:else if verdict.route === 'text'}
              <div class="notice ok">
                <strong>Laid out as a PDF.</strong>
                Set here, on this device, in faces that came with the app — nothing was sent
                anywhere. They are embedded in the PDF, so it reads the same wherever it is
                opened, including the accents PDF's own built-in fonts cannot spell. It is a
                plain setting of the document rather than typesetting — check it reads the way
                you want before signing it.
              </div>
            {:else if verdict.route === 'reject'}
              <div class="notice bad"><strong>Cannot read this one.</strong> {verdict.reason}</div>
            {/if}

            <div class="action-group">
              <button class="button secondary small" type="button" onclick={startOver}>
                Choose a different file
              </button>
            </div>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <label
              class="dropzone"
              class:over
              ondragover={(event) => {
                event.preventDefault();
                over = true;
              }}
              ondragleave={() => (over = false)}
              ondrop={(event) => {
                event.preventDefault();
                over = false;
                void take(event.dataTransfer?.files?.[0]);
              }}
            >
              <div>
                <div class="file-icon" aria-hidden="true">PDF</div>
                <strong>Drop a document here</strong>
                <div class="drop-hint">or click to choose one — PDF, plain text or Markdown</div>
              </div>
              <input
                bind:this={fileInput}
                type="file"
                accept=".pdf,.txt,.text,.log,.md,.markdown"
                onchange={(event) => void take(event.currentTarget.files?.[0])}
              />
            </label>
          {/if}
        </div>

        {#if opened}
          <div class="flow-panel">
            <h2 class="panel-title">2 · Bring in a signature</h2>
            <p class="panel-copy">
              Paste one with <kbd>Ctrl</kbd>+<kbd>V</kbd>, drop the file here, or choose it. Make
              one on the <a href="#/signature">signature screen</a> first and copy or save it from
              there — typed or drawn, either works.
            </p>

            {#if signature}
              <div class="picked">
                <div class="picked-name">{signatureName}</div>
                <div class="picked-facts">
                  {#if signature.kind === 'vector'}
                    SVG · outlines · sharp at any size
                  {:else}
                    {signature.type === 'image/png' ? 'PNG' : 'JPEG'} · {signature.width}×{signature.height}
                    {#if placedResolution} · about {describeDpi(placedResolution.dpi)} as placed{/if}
                  {/if}
                </div>
              </div>

              <div class="signature-preview" class:checks={signature.kind === 'raster'}>
                {#if signature.kind === 'vector'}
                  <svg viewBox="0 0 {signature.width} {signature.height}" aria-label="The signature">
                    <path d={pathData} fill={signature.color} />
                  </svg>
                {:else}
                  <img src={rasterUrl} alt="The signature" />
                {/if}
              </div>

              {#if signature.kind === 'raster' && !signature.hasAlpha}
                <!--
                  The one failure that looks fine on screen and wrong on paper:
                  a JPEG has no transparency, so it lands as a solid rectangle
                  over whatever the document says underneath it.
                -->
                <div class="notice bad">
                  <strong>This picture has no transparent background.</strong>
                  It will cover the document with a solid rectangle wherever it is placed. Use a PNG
                  from the signature screen, which keeps its background transparent.
                </div>
              {:else if placedResolution?.sharpness === 'soft'}
                <div class="notice warn">
                  <strong>Small for the size it is placed at.</strong>
                  About {describeDpi(placedResolution.dpi)} where it sits now, which will look soft
                  in print. Make it smaller on the page, or copy it again at 4× from the signature
                  screen — around {neededPixels.toLocaleString()} pixels wide would print cleanly
                  here.
                </div>
              {/if}

              <div class="action-group">
                <button class="button secondary small" type="button" onclick={clearSignature}>
                  Use a different signature
                </button>
              </div>
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <label
                class="dropzone compact"
                class:over={signatureOver}
                ondragover={(event) => {
                  event.preventDefault();
                  signatureOver = true;
                }}
                ondragleave={() => (signatureOver = false)}
                ondrop={(event) => {
                  event.preventDefault();
                  signatureOver = false;
                  const file = event.dataTransfer?.files?.[0];
                  if (file) void takeSignature(file);
                }}
              >
                <div>
                  <strong>Paste, drop or choose a signature</strong>
                  <div class="drop-hint">PNG or SVG — from the signature screen or anywhere else</div>
                </div>
                <input
                  bind:this={signatureInput}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                  onchange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void takeSignature(file);
                  }}
                />
              </label>
            {/if}

            {#if signatureError}
              <div class="notice bad"><strong>Cannot use that one.</strong> {signatureError}</div>
            {/if}
          </div>

          <div class="flow-panel">
            <h2 class="panel-title">3 · Place it, and save</h2>
            <p class="panel-copy">
              {#if placingBlock}
                Drag the signature block to where it goes. Arrow keys nudge it; hold shift to move
                further. The block is what lands on the page — your signature sits inside it.
              {:else if alreadySigned}
                This document is already signed, so nothing is drawn on the page. Choose a
                certificate below; a visible signature puts your name in a block of its own.
              {:else}
                Drag the signature to where it goes. Arrow keys nudge it; hold shift to move
                further.
              {/if}
            </p>

            {#if opened.pages.length > 1}
              <div class="field">
                <label for="document-page">Page</label>
                <select
                  id="document-page"
                  class="input"
                  bind:value={page}
                >
                  {#each opened.pages as _, index}
                    <option value={index}>Page {index + 1} of {opened.pages.length}</option>
                  {/each}
                </select>
              </div>
            {/if}

            <div class="field">
              <label for="document-span">Size</label>
              <input
                id="document-span"
                class="slider"
                type="range"
                min="0.08"
                max="0.8"
                step="0.01"
                bind:value={span}
              />
            </div>

            <div class="sheet">
              {#if rendering && !preview}
                <p class="panel-copy">Drawing the page…</p>
              {/if}
              <div class="sheet-stage" bind:this={previewHost}></div>

              {#if overlay && signature}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="overlay"
                  class:block={blockPreview !== null}
                  role="button"
                  tabindex="0"
                  aria-label={blockPreview
                    ? 'Signature block position — drag, or use the arrow keys'
                    : 'Signature position — drag, or use the arrow keys'}
                  style="left: {overlay.x}px; top: {overlay.y}px; width: {overlay.width}px; height: {overlay.height}px"
                  onpointerdown={onPointerDown}
                  onkeydown={onOverlayKey}
                >
                  {#if blockPreview}
                    <!--
                      The block, drawn from the same layout the page gets. What
                      is dragged here is the whole thing, because that is what
                      lands: the signature is inside the block, not beside it.
                    -->
                    <div
                      class="block-ink"
                      style="left: {blockPreview.signature.x}px; top: {blockPreview.signature.y}px; width: {blockPreview.signature.width}px; height: {blockPreview.signature.height}px"
                    >
                      {#if signature.kind === 'vector'}
                        <svg viewBox="0 0 {signature.width} {signature.height}" aria-hidden="true">
                          <path d={pathData} fill={signature.color} />
                        </svg>
                      {:else}
                        <img src={rasterUrl} alt="" />
                      {/if}
                    </div>

                    {#if blockPreview.logo && logoUrl}
                      <div
                        class="block-ink"
                        style="left: {blockPreview.logo.x}px; top: {blockPreview.logo.y}px; width: {blockPreview.logo.width}px; height: {blockPreview.logo.height}px"
                      >
                        <img src={logoUrl} alt="" />
                      </div>
                    {/if}

                    {#each blockLines as line, index}
                      {#if blockPreview.baselines[index]}
                        <span
                          class="block-line"
                          style="left: {blockPreview.baselines[index].x}px; top: {blockPreview
                            .baselines[index].y}px; font-size: {blockPreview.fontSize}px"
                        >
                          {line}
                        </span>
                      {/if}
                    {/each}
                  {:else if signature.kind === 'vector'}
                    <!--
                      No transform: toSvg bakes its offset into the path data,
                      so what came back is already in the box the viewBox
                      describes — the same space the stamp draws it in.
                    -->
                    <svg viewBox="0 0 {signature.width} {signature.height}" aria-hidden="true">
                      <path d={pathData} fill={signature.color} />
                    </svg>
                  {:else}
                    <img src={rasterUrl} alt="" />
                  {/if}
                </div>
              {/if}
            </div>

            {#if alreadySigned}
              <!--
                Said before anything else on this step: it changes what the
                rest of it means. The ink-on-the-page option is gone, and the
                reason is not a preference.
              -->
              {#if sealed}
                <div class="notice bad">
                  <strong>This document cannot be signed again.</strong>
                  Whoever signed it first certified it and allowed no later changes. Adding a
                  signature would produce a file that readers reject, so it is not offered. They
                  would have to sign it again themselves, permitting signatures.
                </div>
              {:else}
                <div class="notice">
                  <strong>
                    This document is already signed{existing.length > 1
                      ? `, by ${existing.length} parties`
                      : ''}.
                  </strong>
                  <span class="outgoing-list">
                    {#each existing as e}
                      <span>
                        {e.verdict === 'intact' ? '✓' : '✗'}
                        <strong>{e.signedBy ?? 'unnamed signer'}</strong>
                        {e.kind === 'timestamp' ? '— a timestamp' : ''}
                        {e.verdict === 'intact' ? '' : ` — ${e.verdict}`}
                      </span>
                    {/each}
                  </span>
                  Your signature is added after theirs, leaving every byte they signed untouched,
                  so their signatures keep holding. Nothing can be drawn on the page — doing that
                  means rewriting the file, and what is already on it would not survive. So a
                  certificate is the only thing that can be added here.
                </div>
              {/if}

              {#if brokenBefore.length > 0}
                <div class="notice bad">
                  <strong>
                    {brokenBefore.length === 1
                      ? 'The signature already on this document does not hold.'
                      : 'Signatures already on this document do not hold.'}
                  </strong>
                  It was changed after it was signed. Signing it now would put your name on a
                  document that has already been tampered with, and yours would be the only one
                  that verifies. Check where it came from before adding anything.
                </div>
              {/if}
            {/if}

            {#if !signature}
              <div class="notice">Bring in a signature above and it will appear on the page.</div>
            {/if}

            <div class="field timestamp-field">
              <label class="check">
                <input type="checkbox" bind:checked={wantCertificate} />
                <span>
                  <strong>Sign with a certificate</strong>
                  <span class="check-note">
                    Signs the finished bytes with a key you supply — the one thing here that
                    proves anything: that whoever held that key signed this file, and that it has
                    not changed since.
                  </span>
                </span>
              </label>
            </div>

            {#if wantCertificate}
              <!--
                The chooser goes once the key is open. What replaced it says the
                same things — which file, what format — and "Use a different key
                file" below is the way back, so leaving the input here as well
                put two controls for one job on the screen at once.
              -->
              {#if !identities}
                <div class="field">
                  <span class="field-label">Key file</span>
                  <input
                    bind:this={keyInput}
                    class="input"
                    type="file"
                    accept=".p12,.pfx,.pem,.key,application/x-pkcs12"
                    onchange={(event) => void takeKeyFile(event.currentTarget.files?.[0])}
                  />
                  <p class="field-note">
                    A <code>.p12</code>, <code>.pfx</code> or <code>.pem</code> with your
                    certificate and key. Read here, never sent; the password opens it and is then
                    forgotten.
                  </p>
                </div>
              {/if}

              {#if keyKind && !keyKind.reason && !identities}
                <div class="facts">
                  <div><span>File</span><strong>{keyName}</strong></div>
                  <div><span>Format</span><strong>{keyKind.format}</strong></div>
                </div>
              {/if}

              {#if keyKind && !keyKind.reason && !identities}
                <div class="field">
                  <label for="key-password">Password</label>
                  <input
                    id="key-password"
                    class="input"
                    type="password"
                    autocomplete="off"
                    bind:value={keyPassword}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') void openKey();
                    }}
                  />
                  <p class="field-note">Leave it empty if the file has no password.</p>
                </div>

                <div class="action-group">
                  <button
                    class="button dark small"
                    type="button"
                    disabled={opening}
                    onclick={() => void openKey()}
                  >
                    {opening ? 'Opening…' : 'Open the key file'}
                  </button>
                </div>
              {/if}

              {#if keyError}
                <div class="notice bad">{keyError}</div>
              {/if}

              {#if identities && identities.length > 0}
                {#if identities.length > 1}
                  <div class="field">
                    <span class="field-label">Which certificate</span>
                    <div class="authority-list">
                      {#each identities as option, index}
                        <button
                          type="button"
                          class="face-option"
                          class:selected={chosen === index}
                          onclick={() => {
                            chosen = index;
                            signerName = option.subject;
                          }}
                        >
                          <strong>{option.subject}</strong>
                          <span>Issued by {option.issuer}</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}

                {#if identity}
                  <div class="facts">
                    <div><span>Key file</span><strong>{keyName}</strong></div>
                    <!--
                      Kept after the chooser goes: "older encryption" is how a
                      reader learns the fallback was fetched to open it.
                    -->
                    <div><span>Format</span><strong>{keyKind?.format}</strong></div>
                    <div><span>Certificate</span><strong>{identity.subject}</strong></div>
                    <div><span>Issued by</span><strong>{identity.issuer}</strong></div>
                    <div>
                      <span>Valid</span>
                      <strong>
                        {identity.validFrom.toISOString().slice(0, 10)} to {identity.validTo
                          .toISOString()
                          .slice(0, 10)}
                      </strong>
                    </div>
                  </div>

                  {#if validityAt(identity, new Date()) !== 'valid'}
                    <div class="notice warn">
                      <strong>
                        This certificate is {validityAt(identity, new Date()) === 'expired'
                          ? 'past its expiry date'
                          : 'not valid yet'}.
                      </strong>
                      It still makes a sound signature — the mathematics do not expire — but a
                      reader will say so, and whether that matters is between you and whoever
                      receives it.
                    </div>
                  {/if}

                  {#if identity.chain.length > 0}
                    <div class="notice ok">
                      It carries {identity.chain.length} issuer certificate{identity.chain
                        .length === 1
                        ? ''
                        : 's'} as well as your own. They go into the signature, so a recipient can
                      trace it back rather than take the name on trust.
                    </div>
                  {:else if supplied.length === 0}
                    <div class="notice">
                      <strong>This file holds no issuer certificates.</strong>
                      A signature should carry the certificates above it, so a recipient can trace
                      it back. Without them, a reader that does not already hold
                      <strong>{identity.issuer}</strong> shows your name and no way to check it.
                      Add them below, or re-export the key file with its full certification path —
                      your authority publishes both.
                    </div>
                  {/if}

                  {#if identity.chain.length === 0}
                    <div class="field">
                      <span class="field-label">Issuer certificates</span>
                      <input
                        bind:this={issuerInput}
                        class="input"
                        type="file"
                        accept=".pem,.crt,.cer,.p7b,.p7c,application/x-pkcs7-certificates"
                        onchange={(event) => void takeIssuers(event.currentTarget.files?.[0])}
                      />
                      <p class="field-note">
                        A <code>.pem</code> bundle, a <code>.crt</code> or a <code>.p7b</code>.
                        Public certificates, not secrets — read here and embedded in the
                        signature. Nothing is sent.
                      </p>
                    </div>

                    {#if issuerError}
                      <div class="notice bad">{issuerError}</div>
                    {/if}

                    {#if supplied.length > 0}
                      <div class="notice ok">
                        <strong>{issuerName} continues this chain.</strong>
                        <span class="outgoing-list">
                          {#each links as link}
                            <span>
                              {link.holds ? '✓' : '✗'}
                              <strong>{link.subject}</strong> signed by
                              <strong>{link.issuer}</strong>
                              {link.holds ? '' : ' — but that signature does not hold'}
                            </span>
                          {/each}
                        </span>
                        Each was checked against the next, which is arithmetic and all that is
                        checked. Whether {links[links.length - 1]?.issuer ??
                          'the authority at the top'} deserves belief is the reader's PDF
                        software's judgement, against a list this app does not have.
                      </div>
                    {/if}
                  {/if}

                  <div class="action-group">
                    <button class="button small" type="button" onclick={forgetKey}>
                      Use a different key file
                    </button>
                  </div>

                  <div class="field">
                    <span class="field-label">Appearance</span>
                    <div class="authority-list">
                      <button
                        type="button"
                        class="face-option"
                        class:selected={visibleBlock}
                        onclick={() => (visibleBlock = true)}
                      >
                        <strong>Visible</strong>
                        <span>A block on the page: your signature, and what you fill in below</span>
                      </button>
                      <button
                        type="button"
                        class="face-option"
                        class:selected={!visibleBlock}
                        onclick={() => (visibleBlock = false)}
                      >
                        <strong>Invisible</strong>
                        <span>Nothing drawn. The same signature, over the same bytes</span>
                      </button>
                    </div>
                  </div>

                  <div class="field">
                    <label for="signer-name">Name</label>
                    <input id="signer-name" class="input" type="text" bind:value={signerName} />
                  </div>
                  <div class="field">
                    <label for="signer-reason">Reason</label>
                    <input
                      id="signer-reason"
                      class="input"
                      type="text"
                      placeholder="Why you are signing, if it matters"
                      bind:value={signerReason}
                    />
                  </div>
                  <div class="field">
                    <label for="signer-location">Location</label>
                    <input
                      id="signer-location"
                      class="input"
                      type="text"
                      placeholder="Where you are, if it matters"
                      bind:value={signerLocation}
                    />
                  </div>
                  <p class="field-note">
                    All voluntary; an empty one is left out, not written blank. They go into the
                    signature, so nobody else can change them — and nothing checks they are
                    true.
                  </p>

                  {#if visibleBlock}
                    <div class="field">
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={logoBytes !== null}
                          onchange={(event) => {
                            if (!event.currentTarget.checked) clearLogo();
                            else logoInput?.click();
                          }}
                        />
                        <span>
                          <strong>Show a logo</strong>
                          <span class="check-note">
                            A picture of your own, under the signature. {logoName || 'PNG or JPEG.'}
                          </span>
                        </span>
                      </label>
                      <input
                        bind:this={logoInput}
                        class="input"
                        type="file"
                        accept="image/png,image/jpeg"
                        hidden
                        onchange={(event) => void takeLogo(event.currentTarget.files?.[0])}
                      />
                    </div>

                    {#if logoError}
                      <div class="notice bad">{logoError}</div>
                    {/if}

                    {#if fontError}
                      <div class="notice bad">{fontError}</div>
                    {/if}

                    {#if blockPreview && !blockPreview.fits}
                      <div class="notice warn">
                        <strong>More text here than the block can hold.</strong>
                        It is as small as it can usefully be and still does not fit. Widen the
                        block with the size slider or shorten the reason — otherwise what is drawn
                        is cut off, and a signed document is the wrong place for a sentence that
                        stops halfway.
                      </div>
                    {/if}

                    {#if blockUnsupported.length > 0}
                      <div class="notice warn">
                        <strong>Some characters cannot be drawn in the block.</strong>
                        The face covers Latin and its accents, not
                        <code>{blockUnsupported.join(' ')}</code> — those come out as empty boxes.
                        Change the text or turn the block off; the signature is unaffected and the
                        words still go into it as they are.
                      </div>
                    {/if}
                  {/if}
                {/if}
              {/if}
            {/if}

            <div class="field timestamp-field">
              <label class="check">
                <input type="checkbox" bind:checked={wantTimestamp} />
                <span>
                  <strong>Add a timestamp</strong>
                  <span class="check-note">
                    {#if wantCertificate && identity}
                      Has an authority date your signature, so the time it was made does not rest
                      on your own computer's clock. It goes inside the signature rather than
                      beside it.
                    {:else}
                      Records that this exact file existed at a particular time. It records nothing
                      about who made it.
                    {/if}
                  </span>
                </span>
              </label>
            </div>

            {#if wantTimestamp}
              <!--
                The one place in this app where something leaves the device. It
                is stated before it happens, in full, rather than explained
                afterwards in a changelog.
              -->
              <div class="notice warn">
                <strong>This sends one request off your device.</strong>
                It is the only one the app makes, and a timestamp cannot work without
                it: somebody independent has to see the file's fingerprint and sign it,
                or the time means nothing.
                <span class="outgoing-list">
                  <span>
                    <strong>What goes:</strong>
                    32 bytes — the SHA-256 of
                    {wantCertificate && identity ? 'your signature' : 'the finished PDF'}
                  </span>
                  <span><strong>What does not:</strong> the document, your name, the signature</span>
                  <span
                    ><strong>Where:</strong>
                    <code>{endpoint ?? 'nowhere — the address below is not valid'}</code></span
                  >
                </span>
                A digest cannot be turned back into the file it came from, so the authority
                learns that something existed, not what.
              </div>

              <div class="field">
                <span class="field-label">Authority</span>
                <div class="authority-list">
                  {#each AUTHORITIES as option}
                    <button
                      type="button"
                      class="face-option"
                      class:selected={!useCustom && authorityId === option.id}
                      onclick={() => {
                        useCustom = false;
                        authorityId = option.id;
                      }}
                    >
                      <strong>{option.name}</strong>
                      <span>{option.note}</span>
                    </button>
                  {/each}
                  <button
                    type="button"
                    class="face-option"
                    class:selected={useCustom}
                    onclick={() => (useCustom = true)}
                  >
                    <strong>Another one</strong>
                    <span>Your own authority, if it allows requests from a browser</span>
                  </button>
                </div>
              </div>

              {#if useCustom}
                <div class="field">
                  <label for="tsa-url">Timestamp authority address</label>
                  <input
                    id="tsa-url"
                    class="input"
                    type="url"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://tsa.example.org/tsr"
                    bind:value={customUrl}
                  />
                  <p class="field-note">
                    Most authorities refuse requests that come from a web page, and there is
                    nothing this app can do about that from inside a browser. If one does not
                    work, that is usually why.
                  </p>
                </div>
              {:else if !authority.adobeTrusted}
                <div class="notice">
                  Acrobat will not recognise {authority.signedBy}'s certificate and will say the
                  timestamp is of unknown origin. The token is still a real timestamp and any tool
                  with {authority.signedBy}'s published certificate can check it.
                </div>
              {/if}

              {#if customError}
                <div class="notice bad">{customError}</div>
              {/if}
            {/if}

            {#if saveError}
              <div class="notice bad">{saveError}</div>
            {:else if saved}
              {#if timestampError}
                <div class="notice bad">
                  <strong>Saved, without a timestamp.</strong>
                  {timestampError}
                  {#if wantCertificate && identity}
                    The document was signed anyway — the signature is the part that matters, and
                    it is unaffected. Only the independent time is missing.
                  {:else}
                    The PDF was written anyway, with the signature on it.
                  {/if}
                </div>
              {:else if stamped && wantCertificate && identity}
                <div class="notice ok">
                  <strong>Saved, signed and timestamped.</strong>
                  The signature covers every byte of the file, and
                  {authority.signedBy} states that the signature existed at
                  <strong>{stamped.time.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</strong>.
                  The time no longer rests on this computer's clock.
                  {#if sent}
                    <span class="outgoing-list">
                      <span><strong>Sent:</strong> <code>{groupHex(sent.digestHex)}</code></span>
                      <span><strong>To:</strong> <code>{sent.url}</code></span>
                    </span>
                  {/if}
                </div>
              {:else if saved && wantCertificate && identity}
                <div class="notice ok">
                  <strong>Saved, and signed.</strong>
                  The signature covers every byte of the file. The time on it is this computer's
                  clock, asserted by you and checked by nobody — a timestamp is what makes that
                  claim somebody else's.
                </div>
              {:else if stamped}
                <div class="notice ok">
                  <strong>Saved, and timestamped.</strong>
                  {authority.signedBy} states that this exact file existed at
                  <strong>{stamped.time.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</strong>.
                  It states nothing about who made it, and neither does the file.
                  {#if sent}
                    <span class="outgoing-list">
                      <span><strong>Sent:</strong> <code>{groupHex(sent.digestHex)}</code></span>
                      <span><strong>To:</strong> <code>{sent.url}</code></span>
                    </span>
                  {/if}
                </div>
              {:else}
                <div class="notice ok">
                  <strong>Saved.</strong>
                  The original document is untouched — what was written is a copy with the signature
                  drawn on it.
                </div>
              {/if}
            {/if}

            <div class="action-group">
              <button
                class="button dark small"
                type="button"
                disabled={!ready || saving}
                onclick={() => void save()}
              >
                {saving
                  ? 'Writing…'
                  : wantCertificate && wantTimestamp
                    ? 'Sign, timestamp and save'
                    : wantCertificate
                      ? 'Sign with the certificate and save'
                      : wantTimestamp
                        ? 'Save, and timestamp'
                        : 'Save signed PDF'}
              </button>
            </div>
          </div>
        {/if}

        <!--
          The same limit as on the other screen, and it has to be said harder
          here: a signature sitting on a contract looks far more like a signed
          contract than a loose PNG ever does.
        -->
        {#if wantCertificate && identity}
          <div class="notice">
            <strong>What this signature proves, and what it does not.</strong>
            It proves that whoever held the key in that file signed these exact bytes, and that
            nothing has changed since. That is an advanced electronic signature, and it is a real
            claim.
            <br /><br />
            It is <strong>not</strong> a qualified electronic signature, and nothing here can make
            it one: a qualified signature needs the key to live in certified hardware that only you
            can use, and a key file a browser can read is one that can be copied. This app also
            does not check whose certificate that is — it signs with the key it is given. Whether
            {identity.subject} is who they say they are is for the reader's PDF software to judge,
            against a list of trusted authorities this app does not ship.
            <br /><br />
            The picture in the block proves nothing on its own, as below. What makes the document
            worth something is the signature around it.
          </div>
        {/if}

        <div class="notice warn">
          <strong>A signature image is not an electronic signature.</strong>
          Putting a picture of your name on a document proves nothing about who put
          it there — anyone who has the image can do the same to any file. Use this for
          letterheads, forms and returning paperwork, not as evidence that you agreed to
          something.
          {#if !wantCertificate}
            If you need a document to prove who signed it, that is what signing with a
            certificate above does.
          {/if}
          <br /><br />
          <strong>A timestamp does not change that.</strong>
          It establishes one fact and no others: that this file existed at a particular time.
          It says nothing about who wrote it, who signed it, or whether anyone agreed to
          anything — and a timestamped document with a picture of your name on it is still
          a document with a picture of your name on it.
        </div>
      </div>

      <aside class="side-card">
        <h3>What you get</h3>
        <p>A copy of your document with the signature drawn onto it.</p>
        <div class="side-list">
          <div>The text of the document stays text — it is not flattened to an image</div>
          <div>
            Optionally a real signature, made with your own certificate, covering every byte of
            the finished file
          </div>
          <div>
            An SVG signature goes on as paths, sharp at any size; a PNG goes on as a picture, and
            the app says whether it is big enough for where you put it
          </div>
          <div>Read and written in this browser: no server, no account, no analytics</div>
          <div>A PDF that already carries a digital signature is refused, not broken</div>
          <div>Optionally a timestamp, which sends a 32-byte digest and nothing else</div>
          <div>Your key file and its password are read here and never leave the device</div>
        </div>
      </aside>
    </div>
  </div>
</section>
