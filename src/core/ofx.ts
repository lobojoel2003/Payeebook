import { parseMoney } from './money';
import { parseDate, type ISODate } from './dates';

/**
 * Tolerant parser for OFX 1.x (SGML, unclosed leaf tags), OFX 2.x (XML) and
 * Quicken QFX files. Only the parts Payeebook needs are extracted.
 */
export interface OfxNode {
  name: string;
  value?: string;
  children: OfxNode[];
}

export interface OfxTransaction {
  fitId: string;
  type: string;
  date: ISODate;
  amount: number;
  name: string;
  memo: string;
  checkNumber: string;
}

export interface OfxStatement {
  accountId: string;
  accountType: string;
  bankId: string;
  currency: string;
  transactions: OfxTransaction[];
  ledgerBalance: number | null;
  ledgerBalanceDate: ISODate | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export function parseOfxTree(text: string): OfxNode {
  const start = text.search(/<OFX>/i);
  if (start < 0) throw new Error('This does not look like an OFX or QFX file (no <OFX> element).');
  const body = text.slice(start);
  const root: OfxNode = { name: '#root', children: [] };
  // Each stack entry remembers its parent so that an element we guessed was an
  // aggregate, but which was never closed, can be turned back into an empty leaf.
  const stack: { node: OfxNode; parent: OfxNode | null }[] = [{ node: root, parent: null }];
  const flatten = (entry: { node: OfxNode; parent: OfxNode | null }) => {
    // An SGML element with no value and no closing tag is an empty leaf
    // (for example <NAME> followed by <TRNAMT>); its "children" are siblings.
    const { node, parent } = entry;
    if (!parent || node.children.length === 0) return;
    const at = parent.children.indexOf(node);
    parent.children.splice(at + 1, 0, ...node.children);
    node.children = [];
    node.value = '';
  };
  const tagRe = /<(\/?)([A-Za-z0-9_.]+)[^>]*?(\/?)>([^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const closing = m[1] === '/';
    const selfClosing = m[3] === '/';
    const name = m[2].toUpperCase();
    const text = m[4].trim();
    if (closing) {
      // Pop up to and including the matching aggregate. Closing tags for
      // leaves (OFX 2.x) have no open aggregate and are ignored.
      const idx = stack.map((e) => e.node.name).lastIndexOf(name);
      if (idx > 0) {
        for (let i = stack.length - 1; i > idx; i--) flatten(stack[i]);
        stack.length = idx;
      }
      continue;
    }
    const parent = stack[stack.length - 1].node;
    const node: OfxNode = { name, children: [] };
    parent.children.push(node);
    if (selfClosing) node.value = '';
    else if (text !== '') node.value = decodeEntities(text);
    else stack.push({ node, parent });
  }
  for (let i = stack.length - 1; i > 0; i--) flatten(stack[i]);
  return root;
}

function find(node: OfxNode, name: string): OfxNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

function findAll(node: OfxNode, name: string, out: OfxNode[] = []): OfxNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

function leaf(node: OfxNode | undefined, name: string): string {
  if (!node) return '';
  const f = node.children.find((c) => c.name === name);
  return f?.value ?? '';
}

function ofxAmount(v: string): number | null {
  // Some banks use a comma as the decimal separator in OFX.
  const cleaned = /^-?\d+,\d{1,2}$/.test(v.trim()) ? v.replace(',', '.') : v;
  return parseMoney(cleaned);
}

export function parseOfx(text: string): OfxStatement[] {
  const root = parseOfxTree(text);
  const statements = [...findAll(root, 'STMTRS'), ...findAll(root, 'CCSTMTRS')];
  if (statements.length === 0)
    throw new Error('No bank or credit card statement was found in this file.');
  return statements.map((st) => {
    const acct = find(st, 'BANKACCTFROM') ?? find(st, 'CCACCTFROM');
    const list = find(st, 'BANKTRANLIST');
    const bal = find(st, 'LEDGERBAL');
    const transactions: OfxTransaction[] = [];
    for (const t of findAll(list ?? st, 'STMTTRN')) {
      const amount = ofxAmount(leaf(t, 'TRNAMT'));
      const date = parseDate(leaf(t, 'DTPOSTED')) ?? parseDate(leaf(t, 'DTUSER'));
      if (amount === null || !date) continue;
      const payee = find(t, 'PAYEE');
      const name = leaf(t, 'NAME') || leaf(payee, 'NAME');
      transactions.push({
        fitId: leaf(t, 'FITID'),
        type: leaf(t, 'TRNTYPE'),
        date,
        amount,
        name: name.replace(/\s+/g, ' ').trim(),
        memo: leaf(t, 'MEMO').replace(/\s+/g, ' ').trim(),
        checkNumber: leaf(t, 'CHECKNUM'),
      });
    }
    return {
      accountId: leaf(acct, 'ACCTID'),
      accountType: leaf(acct, 'ACCTTYPE') || (st.name === 'CCSTMTRS' ? 'CREDITCARD' : ''),
      bankId: leaf(acct, 'BANKID'),
      currency: leaf(st, 'CURDEF') || 'USD',
      transactions,
      ledgerBalance: bal ? ofxAmount(leaf(bal, 'BALAMT')) : null,
      ledgerBalanceDate: bal ? parseDate(leaf(bal, 'DTASOF')) : null,
      startDate: list ? parseDate(leaf(list, 'DTSTART')) : null,
      endDate: list ? parseDate(leaf(list, 'DTEND')) : null,
    };
  });
}

export function looksLikeOfx(text: string): boolean {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 4000));
}
