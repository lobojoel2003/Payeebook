import { addDays, formatDate, todayISO } from '../core/dates';

/** A small bank export in the shape most US banks use, for trying the importer. */
export function sampleCsv(today = todayISO()): string {
  const d = (n: number) => formatDate(addDays(today, -n), 'us');
  return [
    'Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    `${d(1)},"POS PURCHASE CUB FOODS #1832 SAINT PAUL MN",-62.18,DEBIT_CARD,,`,
    `${d(2)},"WALGREENS #04512 SAINT PAUL MN",-14.99,DEBIT_CARD,,`,
    `${d(4)},"XCEL ENERGY PAYMENT PPD ID: 4410",-71.40,ACH_DEBIT,,`,
    `${d(6)},"SSA TREAS 310 XXSOC SEC PPD ID: 9031036000",1486.00,ACH_CREDIT,,`,
    `${d(7)},"CHECK 2117",-850.00,CHECK,,2117`,
    `${d(9)},"GREAT CLIPS #0912",-22.00,DEBIT_CARD,,`,
    `${d(11)},"HY-VEE 1440 SAINT PAUL MN",-48.73,DEBIT_CARD,,`,
  ].join('\r\n');
}
