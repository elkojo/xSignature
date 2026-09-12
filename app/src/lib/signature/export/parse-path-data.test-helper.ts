import type { PathCommand } from '../path';

/**
 * Read an SVG `d` string back into commands.
 *
 * Tests only. The app never parses path data — it writes it — but checking that
 * what was written is what was meant needs a reader, and one that is not the
 * writer run backwards. Absolute commands only, which is all toPathData emits.
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
