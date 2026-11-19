import { describe, expect, it } from 'vitest';
import { looksLikeOfx, parseOfx } from './ofx';
import { importKeys } from './dedupe';

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260401</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS>
<CURDEF>USD
<BANKACCTFROM><BANKID>061000104<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260331
<STMTTRN><TRNTYPE>DIRECTDEP<DTPOSTED>20260303120000[-5:EST]<TRNAMT>1043.00<FITID>2026030301<NAME>SSA TREAS 310<MEMO>XXSOC SEC</STMTTRN>
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20260301<TRNAMT>-850.00<FITID>2026030102<CHECKNUM>1043<NAME>RIVERSIDE APTS &amp; HOMES</STMTTRN>
<STMTTRN><TRNTYPE>POS<DTPOSTED>20260305<TRNAMT>-54,20<FITID>2026030503<NAME>PUBLIX #1432</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1638.80<DTASOF>20260331</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
    <CURDEF>USD</CURDEF>
    <CCACCTFROM><ACCTID>4111XXXXXXXX1111</ACCTID></CCACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20260301</DTSTART><DTEND>20260331</DTEND>
      <STMTTRN>
        <TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260310</DTPOSTED><TRNAMT>-23.99</TRNAMT>
        <FITID>abc-1</FITID><PAYEE><NAME>CVS PHARMACY</NAME></PAYEE>
      </STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>-23.99</BALAMT><DTASOF>20260331</DTASOF></LEDGERBAL>
  </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

describe('parseOfx', () => {
  it('parses OFX 1.x SGML', () => {
    const [st] = parseOfx(SGML);
    expect(st).toMatchObject({
      accountId: '000123456789',
      accountType: 'CHECKING',
      bankId: '061000104',
      currency: 'USD',
      ledgerBalance: 163880,
      ledgerBalanceDate: '2026-03-31',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    expect(st.transactions).toHaveLength(3);
    expect(st.transactions[0]).toMatchObject({
      fitId: '2026030301',
      date: '2026-03-03',
      amount: 104300,
      name: 'SSA TREAS 310',
      memo: 'XXSOC SEC',
      type: 'DIRECTDEP',
    });
    expect(st.transactions[1]).toMatchObject({
      checkNumber: '1043',
      name: 'RIVERSIDE APTS & HOMES',
      amount: -85000,
    });
    expect(st.transactions[2].amount).toBe(-5420);
  });

  it('parses OFX 2.x XML credit card statements', () => {
    const [st] = parseOfx(XML);
    expect(st.accountType).toBe('CREDITCARD');
    expect(st.transactions[0]).toMatchObject({
      name: 'CVS PHARMACY',
      amount: -2399,
      fitId: 'abc-1',
    });
    expect(st.ledgerBalance).toBe(-2399);
  });

  it('detects OFX and rejects other files', () => {
    expect(looksLikeOfx(SGML)).toBe(true);
    expect(looksLikeOfx('Date,Amount')).toBe(false);
    expect(() => parseOfx('hello')).toThrow(/OFX/);
    expect(() => parseOfx('<OFX></OFX>')).toThrow(/statement/);
  });
});

describe('importKeys', () => {
  it('uses FITIDs and stable occurrence counters', () => {
    const rows = [
      { date: '2026-03-01', amount: -450, description: 'COFFEE #1' },
      { date: '2026-03-01', amount: -450, description: 'COFFEE #2' },
      { date: '2026-03-02', amount: -100, description: 'X', fitId: 'F1' },
    ];
    const keys = importKeys('acc', rows);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe('ofx:acc:F1');
    expect(importKeys('acc', rows)).toEqual(keys);
  });
});
