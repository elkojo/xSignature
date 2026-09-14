import type { PathCommand } from '../path';

/**
 * Read an SVG `d` string back into commands.
 *
 * Written first for the tests — checking that what was written is what was
 * meant needs a reader, and one that is not the writer run backwards. It earns
 * a second job on the signing screen, where a signature pasted back in as an
 * SVG becomes the same `PathCommand[]` it started as, and is drawn onto the
 * page as outlines rather than as a picture of outlines.
 *
 * Absolute commands only, which is all `toPathData` emits. An SVG from
 * somewhere else may use relative ones; `readSignatureSvg` checks for that and
 * says so rather than letting this quietly misread them.
 */
export function parsePathData(d: string): PathCommand[] {
  const out: PathCommand[] = [];

  for (const [, kind, rest] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    if (kind === 'Z') {
      out.push({ type: 'Z' });
      continue;
    }

    const n = rest
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    switch (kind) {
      case 'M':
        out.push({ type: 'M', x: n[0], y: n[1] });
        break;
      case 'L':
        out.push({ type: 'L', x: n[0], y: n[1] });
        break;
      case 'Q':
        out.push({ type: 'Q', x1: n[0], y1: n[1], x: n[2], y: n[3] });
        break;
      case 'C':
        out.push({ type: 'C', x1: n[0], y1: n[1], x2: n[2], y2: n[3], x: n[4], y: n[5] });
        break;
    }
  }

  return out;
}
