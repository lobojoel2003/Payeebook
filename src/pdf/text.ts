/**
 * The standard PDF fonts only cover the WinAnsi character set. Map common
 * typography to safe equivalents and strip anything else, so a name like
 * "Zoë" works and an emoji never crashes report generation.
 */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = {
  '\u2212': '-',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2015': '-',
  '\u2032': "'",
  '\u2033': '"',
  '\u2190': '<-',
  '\u2192': '->',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2260': '!=',
  '\u2713': 'v',
  '\u2714': 'v',
  '\u2717': 'x',
  '\u00a0': ' ',
  '\u202f': ' ',
  '\u2009': ' ',
  '\t': '    ',
};

export function winAnsi(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    if (REPLACE[ch] !== undefined) {
      out += REPLACE[ch];
      continue;
    }
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      out += ch;
      continue;
    }
    // Try dropping diacritics: "ł" stays unknown, "ő" -> "o".
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((c) => c.charCodeAt(0) < 0x7f) ? base : '?';
  }
  return out;
}
