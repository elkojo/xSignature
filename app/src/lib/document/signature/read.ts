/**
 * Reading a signature that arrived from somewhere else.
 *
 * Pasted, dropped or chosen from disk — and in two flavours, neither of which
 * is the poor relation.
 *
 * An **SVG** made by this app comes back exactly as it left: `toSvg` bakes its
 * offset into the path data rather than using a transform, so the `d` string is
 * already in the coordinate space the viewBox describes, which is the same
 * space the stamp wants. The signature goes onto the page as outlines, not as a
 * picture of outlines.
 *
 * A **PNG** is placed as an image. That is not a lesser answer: a scanned
 * signature has no vector form at all, and `image/png` is the only picture
 * flavour every clipboard agrees on. What it costs is measurable rather than
 * categorical — see `resolution.ts`, which works out whether a particular file
 * is actually big enough for where it is being put, instead of warning about
 * PNGs on principle.
 */
import { parsePathData } from '../../signature/export/parse-path-data';
import type { PathCommand } from '../../signature/path';

export interface VectorSignature {
  readonly kind: 'vector';
  readonly commands: readonly PathCommand[];
  /** The ink's own box, as the viewBox describes it. */
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

export interface RasterSignature {
  readonly kind: 'raster';
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** `image/png` or `image/jpeg`. */
  readonly type: string;
  readonly width: number;
  readonly height: number;
  /** False for JPEG, which paints an opaque rectangle over the page. */
  readonly hasAlpha: boolean;
}

export type Signature = VectorSignature | RasterSignature;

export class UnreadableSignature extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableSignature';
  }
}

/**
 * Read an SVG back into outlines.
 *
 * Deliberately narrow about what it accepts. An SVG can express a great deal
 * that this cannot honour — transforms, groups, gradients, text — and reading
 * one of those approximately would put something on a document that is not what
 * the file says. So anything outside a plain run of untransformed paths is
 * refused with the reason, and the reader is pointed at the PNG, which carries
 * any of it perfectly well.
 */
export function readSignatureSvg(markup: string): VectorSignature {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new UnreadableSignature('That does not look like an SVG file.');
  }

  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg') {
    throw new UnreadableSignature('That does not look like an SVG file.');
  }

  if (svg.querySelector('text, image, use, foreignObject')) {
    throw new UnreadableSignature(
      'This SVG contains text or an embedded image, which cannot be drawn as outlines. Copy it as a PNG instead.',
    );
  }

  const shapes = svg.querySelectorAll('rect, circle, ellipse, line, polyline, polygon');
  if (shapes.length > 0) {
    throw new UnreadableSignature(
      'This SVG is drawn with shapes rather than paths, which this app cannot read. Copy it as a PNG instead.',
    );
  }

  const paths = [...svg.querySelectorAll('path')];
  if (paths.length === 0) {
    throw new UnreadableSignature('This SVG has nothing drawn in it.');
  }

  for (const path of paths) {
    // A transform anywhere above or on a path moves it, and applying them
    // properly is a job for a renderer. Refusing is better than placing a
    // signature somewhere other than where the file puts it.
    for (let node: Element | null = path; node && node !== svg; node = node.parentElement) {
      if (node.getAttribute('transform')) {
        throw new UnreadableSignature(
          'This SVG uses transforms, which this app cannot follow. Copy it as a PNG instead.',
        );
      }
    }
  }

  const data = paths.map((path) => path.getAttribute('d') ?? '').join('');
  if (/[mlqchvsatz]/.test(data)) {
    throw new UnreadableSignature(
      'This SVG uses relative or curved commands this app cannot read. Copy it as a PNG instead.',
    );
  }

  const commands = parsePathData(data);
  if (commands.length === 0) {
    throw new UnreadableSignature('This SVG has nothing drawn in it.');
  }

  const box = viewBoxOf(svg);
  return {
    kind: 'vector',
    commands,
    width: box.width,
    height: box.height,
    color: paths[0].getAttribute('fill') ?? '#000000',
  };
}

/** The ink's own box: the viewBox if there is one, else the declared size. */
function viewBoxOf(svg: Element): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }

  throw new UnreadableSignature('This SVG does not say how big it is.');
}

/**
 * Read a picture's dimensions straight out of its header.
 *
 * Done by hand rather than by loading it into an `Image`, because the numbers
 * are needed before anything is drawn — the resolution warning depends on them,
 * and so does refusing a JPEG for the right reason rather than after the fact.
 */
export function readSignatureImage(bytes: Uint8Array<ArrayBuffer>, type: string): RasterSignature {
  if (type === 'image/png') {
    const size = pngSize(bytes);
    return { kind: 'raster', bytes, type, ...size, hasAlpha: pngHasAlpha(bytes) };
  }

  if (type === 'image/jpeg') {
    const size = jpegSize(bytes);
    // No alpha channel exists in a baseline JPEG, so whatever the signature
    // looks like it arrives as a solid rectangle and covers the page under it.
    return { kind: 'raster', bytes, type, ...size, hasAlpha: false };
  }

  throw new UnreadableSignature(
    'Only PNG and SVG signatures can be placed on a document, and JPEG with a warning.',
  );
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function looksLikePng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** The IHDR chunk is always first, and carries the size in big-endian. */
function pngSize(bytes: Uint8Array<ArrayBuffer>): { width: number; height: number } {
  if (!looksLikePng(bytes) || bytes.length < 24) {
    throw new UnreadableSignature('This PNG could not be read.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Colour types 4 and 6 carry an alpha channel; a tRNS chunk gives one too. */
function pngHasAlpha(bytes: Uint8Array): boolean {
  const colourType = bytes[25];
  if (colourType === 4 || colourType === 6) return true;

  const header = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return header.includes('tRNS');
}

/** Walk the JPEG segments to the frame header, which carries the size. */
function jpegSize(bytes: Uint8Array<ArrayBuffer>): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;

  // The frame header's last byte of interest is at + 8, so the scan may run
  // right up to it: a minimal JPEG ends immediately after that header, and a
  // stricter bound would reject one for being exactly the right size.
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    // SOF0-SOF15, skipping the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    at += 2 + view.getUint16(at + 2);
  }

  throw new UnreadableSignature('This JPEG could not be read.');
}
