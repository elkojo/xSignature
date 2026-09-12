import { describe, expect, it } from 'vitest';

import { fileNameFor } from './download';

describe('fileNameFor', () => {
  it('uses the typed name', () => {
    expect(fileNameFor('Ada Lovelace', 'svg')).toBe('ada-lovelace-signature.svg');
  });

  it('folds accents rather than dropping the letters', () => {
    // "Jiří Novák" must not become "ji-nov".
    expect(fileNameFor('Jiří Novák', 'png')).toBe('jiri-novak-signature.png');
  });

  it('falls back to a plain name when nothing survives', () => {
    expect(fileNameFor('###', 'svg')).toBe('signature.svg');
    expect(fileNameFor('', 'svg')).toBe('signature.svg');
  });

  it('leaves no path separators', () => {
    const name = fileNameFor('../../etc/passwd', 'png');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });

  it('does not run away with a very long name', () => {
    expect(fileNameFor('a'.repeat(500), 'svg').length).toBeLessThan(90);
  });
});
