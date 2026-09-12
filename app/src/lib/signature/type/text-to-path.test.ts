import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';

import { toPathData } from '../path';
import { textToPath } from './text-to-path';

/**
 * Read the bundled face straight off disk. The app fetches it instead, but the
 * bytes are the same bytes and the parse is the same parse — and a test that
 * needs no server stays offline and deterministic, which is the house rule.
 */
const load = (file: string) =>
  parse(readFileSync(fileURLToPath(new URL(`../fonts/${file}`, import.meta.url))).buffer);

const font = load('DancingScript-Regular.ttf');

describe('textToPath', () => {
  it('produces nothing for empty text', () => {
    expect(textToPath(font, '', { fontSize: 100 })).toEqual([]);
  });

  it('produces outlines, not a single moveto', () => {
    const commands = textToPath(font, 'Ada', { fontSize: 100 });
    expect(commands.length).toBeGreaterThan(20);
    expect(commands[0]?.type).toBe('M');
  });

  it('emits only commands the export pipeline understands', () => {
    const commands = textToPath(font, 'Ada Lovelace', { fontSize: 100 });
    const kinds = new Set(commands.map((c) => c.type));
    expect([...kinds].every((k) => ['M', 'L', 'C', 'Q', 'Z'].includes(k))).toBe(true);
  });

  it('closes every contour it opens', () => {
    // Glyph outlines are filled regions. An unclosed contour would fill in a
    // way that depends on the renderer's guess, which is how a PNG and an SVG
    // of the same signature drift apart.
    const commands = textToPath(font, 'Ada Lovelace', { fontSize: 100 });
    const opens = commands.filter((c) => c.type === 'M').length;
    const closes = commands.filter((c) => c.type === 'Z').length;
    expect(closes).toBe(opens);
  });

  it('has no non-finite coordinates', () => {
    const commands = textToPath(font, 'Ada Lovelace', { fontSize: 100 });
    for (const c of commands) {
      for (const [key, value] of Object.entries(c)) {
        if (key === 'type') continue;
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('sets the text at a real em size rather than scaling it afterwards', () => {
    // Same outlines, laid out twice. If size were a transform applied to a
    // finished rendering, the command count could not be relied on to match;
    // here the glyphs are re-laid at the new size and the geometry scales.
    const small = textToPath(font, 'Ada Lovelace', { fontSize: 50 });
    const large = textToPath(font, 'Ada Lovelace', { fontSize: 100 });

    expect(large.length).toBe(small.length);

    const xOf = (c: (typeof small)[number]) => ('x' in c ? c.x : null);
    const scaled = small.map(xOf).filter((x): x is number => x !== null);
    const actual = large.map(xOf).filter((x): x is number => x !== null);
    for (const [i, x] of scaled.entries()) {
      expect(actual[i]).toBeCloseTo(x * 2, 6);
    }
  });

  it('starts the first glyph at the origin, on the baseline', () => {
    // Everything downstream trims to the real bounding box, so the only
    // contract here is that nothing has been pre-positioned.
    const commands = textToPath(font, 'A', { fontSize: 100 });
    const xs = commands.flatMap((c) => ('x' in c ? [c.x] : []));
    expect(Math.min(...xs)).toBeLessThan(20);
  });

  it('serializes without NaN', () => {
    // Not a hypothetical. opentype.js 2.0.0's own `Path.toPathData` emits NaN
    // for whole coordinates — 30 of them in this string — which is why this app
    // serializes paths itself rather than asking the library to. An SVG with
    // NaN in a `d` attribute renders as nothing at all.
    const ours = toPathData(textToPath(font, 'Ada Lovelace', { fontSize: 100 }));
    expect(ours).not.toContain('NaN');
    expect(font.getPath('Ada Lovelace', 0, 0, 100).toPathData(2)).toContain('NaN');
  });

  it('leaves no command that draws nothing', () => {
    // opentype emits an `L` to the point the pen is already on once per contour
    // and at many on-curve points besides — about a quarter of the stream.
    const commands = textToPath(font, 'Ada Lovelace', { fontSize: 100 });

    let x = 0;
    let y = 0;
    for (const c of commands) {
      if (c.type === 'Z') continue;
      if (c.type !== 'M') expect([c.x, c.y]).not.toEqual([x, y]);
      x = c.x;
      y = c.y;
    }
  });
});

describe('fonts the library cannot shape', () => {
  const greatVibes = load('GreatVibes-Regular.ttf');

  it('confirms the library still throws on this font', () => {
    // The reason the fallback exists, pinned so we find out if it is ever
    // fixed upstream and the fallback can go.
    expect(() => greatVibes.getPath('Ada Lovelace', 0, 0, 100)).toThrow(
      /lookupType: 6 - substFormat: 2 is not yet supported/,
    );
  });

  it('lays the text out anyway', () => {
    const commands = textToPath(greatVibes, 'Ada Lovelace', { fontSize: 100 });
    expect(commands.length).toBeGreaterThan(100);
    expect(commands[0]?.type).toBe('M');
  });

  it('never throws, whatever the face and whatever the text', () => {
    // textToPath is called from a reactive expression. An exception there does
    // not surface as an error message — it stops the interface updating, which
    // is how this was found: a frozen preview and a console nobody was reading.
    const faces = [
      'DancingScript-Regular.ttf',
      'Caveat-Regular.ttf',
      'GreatVibes-Regular.ttf',
      'Allura-Regular.ttf',
      'Parisienne-Regular.ttf',
      'Sacramento-Regular.ttf',
      'MrDeHaviland-Regular.ttf',
    ];
    const samples = ['Ada Lovelace', 'Jiří Novák', '日本語', '😀', "O'Brien-Smith", 'ffi', '   '];

    for (const file of faces) {
      const face = load(file);
      for (const text of samples) {
        expect(() => textToPath(face, text, { fontSize: 120 })).not.toThrow();
      }
    }
  });

  it('advances the pen, rather than stacking every glyph at the origin', () => {
    // The fallback places glyphs itself. Getting the advance wrong would pile
    // the whole name into one blot, which still "works" and is still useless.
    const one = textToPath(greatVibes, 'A', { fontSize: 100 });
    const many = textToPath(greatVibes, 'AAAA', { fontSize: 100 });

    const rightmost = (cs: typeof one) => Math.max(...cs.flatMap((c) => ('x' in c ? [c.x] : [])));
    expect(rightmost(many)).toBeGreaterThan(rightmost(one) * 2);
  });
});
