/**
 * Putting a real font inside a PDF, so a document can say what it says.
 *
 * PDF's fourteen built-in fonts need no font file, which is why the text and
 * Markdown converters used them — and they are **WinAnsi**, one byte a
 * character. Handed "Uzavřená" they write "Uzav?ená". Silently. That is fine
 * for English and ruinous for the languages this app is mostly used in, and it
 * corrupts the document rather than a label.
 *
 * The fix is to embed a font. Doing that normally means fontkit, which is
 * 383 kB gzipped — two and a half times every font file this would need — and
 * which duplicates work opentype.js is already here to do. So the font
 * dictionaries are written directly, the way the signature dictionaries in
 * `certificate/sign` are.
 *
 * The shape is the one PDF defines for a TrueType font with more than 256
 * characters:
 *
 *     Type0, /Identity-H  ── text is glyph ids, two bytes each
 *       └ CIDFontType2    ── widths, and which glyph each id means
 *           └ FontFile2   ── the .ttf itself
 *       └ ToUnicode       ── glyph id back to the character it draws
 *
 * The last of those is what makes the text selectable, searchable and
 * copy-pastable. Leaving it out yields a document that looks perfect and from
 * which nothing can be copied, so it is not optional and it is tested by
 * reading the text back out with a different library.
 */
import {
  beginText,
  endText,
  moveText,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFString,
  rgb,
  setFillingColor,
  setFontAndSize,
  showText,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from '@cantoo/pdf-lib';
import type { Font } from 'opentype.js';

/** A font embedded in one document, ready to draw with. */
export interface EmbeddedFont {
  /** The name it is registered under in a page's resources. */
  readonly name: string;
  readonly ref: PDFRef;
  /** Text as glyph ids, hex, for a `Tj` operator. */
  encode(text: string): string;
  /** What that text will measure, in points, at `size`. */
  widthOfTextAtSize(text: string, size: number): number;
  /** Every glyph used so far, so the widths written out cover them. */
  readonly used: Set<number>;
}

/** PDF expresses glyph metrics in thousandths of the em, whatever the font uses. */
const PDF_EM = 1000;

/**
 * Embed `font` into `doc`.
 *
 * `bytes` must be the same file `font` was parsed from: one is what the reader
 * will rasterize, the other is what decides which glyph goes where, and a
 * mismatch between them is a document that draws the wrong letters.
 */
export function embedType0(
  doc: PDFDocument,
  font: Font,
  bytes: Uint8Array,
  name: string,
): EmbeddedFont {
  const used = new Set<number>();
  const perEm = font.unitsPerEm || 1000;
  const toPdf = (value: number) => Math.round((value * PDF_EM) / perEm);

  const glyphFor = (character: string): number => {
    const index = font.charToGlyphIndex(character);
    // 0 is .notdef, which is what a font offers for a character it lacks. It is
    // still recorded: the caller has already been told, by `unsupportedCharacters`,
    // and writing the box the font actually has beats writing nothing.
    used.add(index);
    return index;
  };

  const embedded: EmbeddedFont = {
    name,
    // Filled in below; declared here so `encode` can be defined before the
    // dictionaries that depend on what it records.
    ref: undefined as unknown as PDFRef,
    used,

    encode(text) {
      let out = '';
      for (const character of text) {
        out += glyphFor(character).toString(16).padStart(4, '0');
      }
      return out;
    },

    widthOfTextAtSize(text, size) {
      let total = 0;
      for (const character of text) {
        const glyph = font.glyphs.get(glyphFor(character));
        total += ((glyph?.advanceWidth ?? perEm / 2) * size) / perEm;
      }
      return total;
    },
  };

  const context = doc.context;
  const file = context.flateStream(bytes, { Length1: bytes.length });
  const fileRef = context.register(file);

  const head = font.tables.head ?? {};
  const os2 = font.tables.os2 ?? {};
  const post = font.tables.post ?? {};

  const descriptor = context.obj({
    Type: 'FontDescriptor',
    FontName: PDFName.of(name),
    // 32 is "nonsymbolic": ordinary text in a standard character set.
    Flags: 32 + (post.italicAngle ? 64 : 0),
    FontBBox: [toPdf(head.xMin ?? 0), toPdf(head.yMin ?? 0), toPdf(head.xMax ?? perEm), toPdf(head.yMax ?? perEm)],
    ItalicAngle: post.italicAngle ?? 0,
    Ascent: toPdf(os2.sTypoAscender ?? font.ascender),
    Descent: toPdf(os2.sTypoDescender ?? font.descender),
    CapHeight: toPdf(os2.sCapHeight ?? font.ascender),
    // Not in any table; PDF requires it and readers use it only as a hint.
    StemV: 80,
    FontFile2: fileRef,
  });

  const descendant = context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: PDFName.of(name),
    // Real PDF strings, not names: a reader rejects the whole font otherwise,
    // with "Invalid CIDSystemInfo dictionary in Type 0 descendant font".
    CIDSystemInfo: context.obj({
      Registry: PDFString.of('Adobe'),
      Ordering: PDFString.of('Identity'),
      Supplement: 0,
    }),
    FontDescriptor: context.register(descriptor),
    // Glyph ids are the character ids, which is what Identity-H means.
    CIDToGIDMap: PDFName.of('Identity'),
    DW: PDF_EM,
    W: context.obj([]),
  });
  const descendantRef = context.register(descendant);

  const toUnicodeRef = context.register(context.flateStream(new Uint8Array()));

  const type0 = context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: PDFName.of(name),
    Encoding: PDFName.of('Identity-H'),
    DescendantFonts: context.obj([descendantRef]),
    ToUnicode: toUnicodeRef,
  });

  (embedded as { ref: PDFRef }).ref = context.register(type0);

  // The widths and the character map can only be written once every glyph the
  // document uses is known, which is after it has been laid out. `finish` is
  // called by the converter when the last line has been drawn.
  finishers.set(embedded, () => {
    const dict = context.lookup(descendantRef) as PDFDict;
    dict.set(PDFName.of('W'), context.obj(widthsArray(font, used, toPdf)));

    const stream = context.flateStream(toUnicodeCMap(font, used, name));
    context.assign(toUnicodeRef, stream);
  });

  return embedded;
}

/** Deferred work, keyed by the font it belongs to. */
const finishers = new WeakMap<EmbeddedFont, () => void>();

/**
 * Write out the widths and the character map.
 *
 * Must be called once the document is fully laid out and before it is saved:
 * both depend on knowing every glyph that was used.
 */
export function finishFont(font: EmbeddedFont): void {
  finishers.get(font)?.();
}

/**
 * `W` in the form `[ id [w] id [w] … ]`.
 *
 * One entry a glyph rather than the range form. Ranges are smaller in a font
 * used heavily and this is not that: a document uses a few dozen distinct
 * glyphs, and the simple form is the one that cannot be got subtly wrong.
 */
function widthsArray(
  font: Font,
  used: Set<number>,
  toPdf: (n: number) => number,
): Array<number | number[]> {
  const out: Array<number | number[]> = [];
  for (const id of [...used].sort((a, b) => a - b)) {
    const glyph = font.glyphs.get(id);
    if (!glyph) continue;
    out.push(id, [toPdf(glyph.advanceWidth ?? 0)]);
  }
  return out;
}

/**
 * The map from glyph id back to the character it draws.
 *
 * Without it a reader can show the document and not tell you what it says:
 * selecting the text copies nothing, and searching finds nothing. It is
 * PostScript, and this is the shape every writer emits.
 */
function toUnicodeCMap(font: Font, used: Set<number>, name: string): Uint8Array {
  const entries: string[] = [];

  for (const id of [...used].sort((a, b) => a - b)) {
    // opentype records the character a glyph came from; without one there is
    // nothing honest to map it to, so it is left out rather than guessed.
    const glyph = font.glyphs.get(id);
    const code = glyph?.unicode;
    if (code === undefined) continue;

    const hex = code > 0xffff
      ? [...String.fromCodePoint(code)].map((u) => u.charCodeAt(0).toString(16).padStart(4, '0')).join('')
      : code.toString(16).padStart(4, '0');
    entries.push(`<${id.toString(16).padStart(4, '0')}> <${hex}>`);
  }

  // `beginbfchar` takes at most 100 entries at a time.
  const chunks: string[] = [];
  for (let at = 0; at < entries.length; at += 100) {
    const slice = entries.slice(at, at + 100);
    chunks.push(`${slice.length} beginbfchar\n${slice.join('\n')}\nendbfchar`);
  }

  return new TextEncoder().encode(
    `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /${name}-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`,
  );
}


/**
 * Register an embedded font on a page and draw a line of text with it.
 *
 * Built from pdf-lib's own operator helpers rather than `PDFOperator.of`. That
 * is not a style preference: operators assembled the other way serialized to an
 * empty content stream, taking the rest of the page's text with them and
 * failing silently — a blank page with no error anywhere.
 */
export function drawEmbeddedText(
  page: PDFPage,
  font: EmbeddedFont,
  text: string,
  options: { x: number; y: number; size: number; color?: { r: number; g: number; b: number } },
): void {
  if (!text) return;

  page.node.setFontDictionary(PDFName.of(font.name), font.ref);

  const ink = options.color;
  page.pushOperators(
    beginText(),
    ...(ink ? [setFillingColor(rgb(ink.r, ink.g, ink.b))] : []),
    setFontAndSize(font.name, options.size),
    moveText(options.x, options.y),
    showText(PDFHexString.of(font.encode(text))),
    endText(),
  );
}
