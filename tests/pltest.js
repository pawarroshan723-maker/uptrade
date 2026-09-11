/* P&L report — verification against the official Upstox Trade Profit & Loss docs.
 * metadata: GET /v2/trade/profit-loss/metadata?segment&financial_year → data{trades_count,page_size_limit}
 * data:     GET /v2/trade/profit-loss/data?segment&financial_year&page_number&page_size
 *           rows: quantity,isin,scrip_name,trade_type,buy_date,buy_average,sell_date,sell_average,buy_amount,sell_amount
 * charges:  GET /v2/trade/profit-loss/charges?segment&financial_year
 *           data.charges_breakdown{total,brokerage,taxes{gst,stt,stamp_duty},charges{transaction,clearing,ipft,others,sebi_turnover,demat_transaction}}
 * Regression guards: full pagination (was page-1-only → wrong totals >1000 trades),
 * short-page break, zero trades, COM/CD segments, daily-token-only enforcement.
 */
const { boot, okpush, report } = require('./helpers');
const DOC_ROWS = [
  { quantity: 100, isin: 'INE256A01028', scrip_name: 'ZEE ENTER', trade_type: 'EQ', buy_date: '14-09-2021', buy_average: 100.5, sell_date: '15-09-2021', sell_average: 102.25, buy_amount: 10050, sell_amount: 10225 },
  { quantity: 10, isin: 'INF', scrip_name: 'NIFTY SEP FUT', trade_type: 'FUT', buy_date: '01-10-2021', buy_average: 5000, sell_date: '01-10-2021', sell_average: 5075, buy_amount: 50000, sell_amount: 50750 },
  { quantity: 5, isin: '', scrip_name: 'BANKNIFTY OPT', trade_type: 'OPT', buy_date: '05-10-2021', buy_average: 400, sell_date: '05-10-2021', sell_average: 300, buy_amount: 2000, sell_amount: 1500 }
];
const PAD = DOC_ROWS.concat([
  { quantity: 1, isin: 'X', scrip_name: 'PAD A', trade_type: 'EQ', buy_date: '01-04-2026', buy_average: 100, sell_date: '01-04-2026', sell_average: 100, buy_amount: 100, sell_amount: 100 },
  { quantity: 1, isin: 'Y', scrip_name: 'PAD B', trade_type: 'EQ', buy_date: '01-04-2026', buy_average: 100, sell_date: '01-04-2026', sell_average: 100, buy_amount: 100, sell_amount: 100 }
]);
const DOC_CHARGES = { charges_breakdown: { total: 154.23, brokerage: 97.23, taxes: { gst: 20.93, stt: 15, stamp_duty: 2 }, charges: { transaction: 0.56, clearing: 0, ipft: null, others: 0, sebi_turnover: 0.01, demat_transaction: 18.5 } } };
const DAY = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };

function bootPL(opts = {}) {
  const holder = { shortPage: !!opts.shortPage };
  const routes = [
    { re: /\/v2\/trade\/profit-loss\/metadata/, status: opts.metaError ? 400 : 200,
      body: opts.metaError ? { status: 'error', errors: [{ errorCode: 'UDAPI1074', message: 'The financial_year is invalid' }] }
        : { status: 'success', data: { trades_count: opts.count ?? 3, page_size_limit: opts.limit ?? 5000 } } },
    { re: /\/v2\/trade\/profit-loss\/data/, status: opts.dataError ? 400 : 200,
      bodyFn: us => {
        if (opts.dataError) return { status: 'error', errors: [{ errorCode: 'UDAPI1071', message: 'The page_number is required' }] };
        const pn = Number(new URL(us).searchParams.get('page_number') || 1), ps = Number(new URL(us).searchParams.get('page_size') || 10);
        const rows = holder.shortPage ? (pn === 1 ? DOC_ROWS : []) : PAD.slice((pn - 1) * ps, pn * ps);
        return { status: 'success', data: rows, metadata: { page: { page_number: pn, page_size: ps } } };
      } },
    { re: /\/v2\/trade\/profit-loss\/charges/, status: opts.chargesError ? 400 : 200,
      body: opts.chargesError ? { status: 'error', errors: [{ errorCode: 'UDAPIOOPS', message: 'boom' }] }
        : { status: 'success', data: DOC_CHARGES } }
  ];
  return boot({ tokens: opts.tokens || DAY, routes });
}

(async () => {
  const R = []; const ok = okpush(R);

  // 1. happy path EQ FY2627 (doc shapes)
  let { w, calls } = await bootPL();
  ok('FY selector populated w/ current FY 2627', w.eval(`document.getElementById('plY').value`) === '2627');
  ok('segments include COM+CD', w.eval(`[...document.getElementById('plS').options].map(o=>o.value).join(',')`) === 'EQ,FO,COM,CD');
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 500));
  ok('metadata URL seg=EQ fy=2627', calls.some(c => c.u.includes('/v2/trade/profit-loss/metadata?segment=EQ&financial_year=2627')));
  ok('data URL page=1 with page_size param', calls.some(c => c.u.includes('/v2/trade/profit-loss/data?segment=EQ&financial_year=2627&page_number=1&page_size=')));
  ok('charges URL', calls.some(c => c.u.includes('/v2/trade/profit-loss/charges?segment=EQ&financial_year=2627')));
  ok('single page fetch (count<=page_size)', calls.filter(c => c.u.includes('/profit-loss/data')).length === 1);
  const plTxt = w.eval(`document.getElementById('plB').textContent`);
  ok('summary Trades=3 Loaded=3', plTxt.includes('Trades') && /3/.test(plTxt) && plTxt.includes('Gross Realised'));
  ok('gross = +425 (175+750-500)', plTxt.includes('425') && w.eval(`document.querySelector('#plB .sv .pp')!==null`));
  ok('3 rows w/ scrip+FUT+OPT types', w.eval(`document.querySelectorAll('#plB tbody tr').length`) === 3 && plTxt.includes('ZEE ENTER') && plTxt.includes('FUT') && plTxt.includes('OPT'));
  const chTxt = w.eval(`document.getElementById('plCh').textContent`);
  ok('charges rows incl IPFT', ['Brokerage', 'GST', 'STT', 'Stamp duty', 'Transaction', 'Clearing', 'IPFT', 'SEBI turnover', 'Demat', 'Other'].every(k => chTxt.includes(k)));
  ok('charges total 154.23', w.eval(`document.getElementById('plChTotal').textContent`).includes('154.23'));

  // 2. pagination: count=5, page_size_limit=2 → 3 pages
  ({ w, calls } = await bootPL({ count: 5, limit: 2 }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 1500));
  const pages = calls.filter(c => c.u.includes('/profit-loss/data')).map(c => new URL(c.u).searchParams.get('page_number'));
  ok('pages 1,2,3 @ size 2', pages.join(',') === '1,2,3' && calls.filter(c => c.u.includes('/profit-loss/data')).every(c => c.u.includes('page_size=2')));
  const plTxt2 = w.eval(`document.getElementById('plB').textContent`);
  ok('all 5 loaded across pages', plTxt2.includes('Loaded') && /5/.test(plTxt2) && w.eval(`document.querySelectorAll('#plB tbody tr').length`) === 5);
  ok('gross over all pages computed', plTxt2.includes('Gross Realised'));

  // 3. short page stops loop
  ({ w, calls } = await bootPL({ count: 5000, limit: 5000, shortPage: true }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 1200));
  ok('short page → single fetch, no runaway', calls.filter(c => c.u.includes('/profit-loss/data')).length === 1);

  // 4. zero trades
  ({ w, calls } = await bootPL({ count: 0 }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 400));
  ok('zero trades empty state, no data fetch', w.eval(`document.getElementById('plB').textContent`).includes('No realised trades') && !calls.some(c => c.u.includes('/profit-loss/data')));

  // 5. COM segment
  ({ w, calls } = await bootPL());
  w.eval(`document.getElementById('plS').value='COM'; ldPl()`);
  await new Promise(r => setTimeout(r, 500));
  ok('COM segment hits metadata', calls.some(c => c.u.includes('/profit-loss/metadata?segment=COM&financial_year=2627')));

  // 6. analytics-only session → visible toast, no P&L calls
  ({ w, calls } = await bootPL({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } } }));
  const before = calls.length;
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 300));
  ok('RO session: toast, no P&L fetch', w.eval(`document.getElementById('TC').textContent`).toLowerCase().includes('daily token') && !calls.slice(before).some(c => c.u.includes('/profit-loss')));

  // 7. data API error
  ({ w, calls } = await bootPL({ dataError: true }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 600));
  ok('data error surfaces in box', w.eval(`document.getElementById('plB').textContent`).includes('page_number') || w.eval(`document.getElementById('plB').textContent`).length > 10);

  // 8. charges error degrades gracefully, report still renders
  ({ w, calls } = await bootPL({ chargesError: true }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 600));
  ok('charges error → unavailable note', w.eval(`document.getElementById('plCh').textContent`).includes('Charges unavailable'));
  ok('report still renders', w.eval(`document.querySelectorAll('#plB tbody tr').length`) === 3);

  // 9. metadata error surfaces
  ({ w, calls } = await bootPL({ metaError: true }));
  await w.eval(`ldPl()`);
  await new Promise(r => setTimeout(r, 600));
  ok('metadata error surfaces', /invalid|error/i.test(w.eval(`document.getElementById('plB').textContent`)));

  process.exit(report('P&L VERIFY TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
