/* Market-status header chip — doc-exact verification.
 * Official contract (get-market-status + appendices):
 *   GET /v2/market/status/:exchange, exchange values: NSE NFO CDS BSE BFO BCD MCX NSCOM
 *   data.status ∈ NORMAL_OPEN | NORMAL_CLOSE | PRE_OPEN_START | PRE_OPEN_END | CLOSING_START | CLOSING_END
 *   optional data.cas_eligible_status{status,last_updated}
 * Regression: MCX_FO (an instrument segment, not an exchange) used to be
 * requested → UDAPI1089 → chip showed "Mkt CLOSED" during MCX evening session.
 */
const { boot, okpush, report } = require('./helpers');
const D = (exchange, status, extra = {}) => ({ exchange, status, last_updated: 1757577000000, ...extra });
const DAY = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };

(async () => {
  const R = []; const ok = okpush(R);
  const run = async (w) => { await w.eval('ldMarketStatus()');
    return { t: w.eval(`document.getElementById('mStatT').textContent`),
             c: w.eval(`document.getElementById('mStat').className`),
             ti: w.eval(`document.getElementById('mStat').title`) }; };

  // A — THE REPORTED BUG: NSE shut, MCX evening session live
  let { w, calls } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/MCX_FO$/, status: 400, body: { status: 'error', errors: [{ errorCode: 'UDAPI1089', message: 'Invalid exchange' }] } },
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_CLOSE') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_OPEN') } }
  ] });
  let r = await run(w);
  ok('A: request uses /v2/market/status/MCX (not MCX_FO)', calls.some(c => c.u.endsWith('/v2/market/status/MCX')) && !calls.some(c => c.u.includes('/v2/market/status/MCX_FO')));
  ok('A: header shows "MCX live"', r.t === 'MCX live');
  ok('A: chip green', r.c.includes('ok') && !r.c.includes('off'));
  ok('A: tooltip names MCX NORMAL_OPEN', r.ti.includes('MCX: NORMAL_OPEN'));

  // B — both live
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_OPEN') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_OPEN') } }
  ] }));
  ok('B: both open → "Mkt LIVE"', (await run(w)).t === 'Mkt LIVE');

  // C — both closed
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_CLOSE') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_CLOSE') } }
  ] }));
  r = await run(w);
  ok('C: both closed → "Mkt CLOSED" + grey', r.t === 'Mkt CLOSED' && r.c.includes('off'));

  // D — pre-open
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'PRE_OPEN_START') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_CLOSE') } }
  ] }));
  r = await run(w);
  ok('D: pre-open → "Pre-open"', r.t === 'Pre-open' && r.c.includes('ok'));

  // E — CAS sub-status in tooltip
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_OPEN', { cas_eligible_status: { status: 'CTS_CLOSE', last_updated: 1757577000000 } }) } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_OPEN') } }
  ] }));
  r = await run(w);
  ok('E: both live + CAS CTS_CLOSE in tooltip', r.t === 'Mkt LIVE' && r.ti.includes('CAS CTS_CLOSE'));

  // F — MCX status fails (network), NSE open → still "NSE live"
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_OPEN') } },
    { re: /\/v2\/market\/status\/MCX$/, status: 500, body: { status: 'error' } }
  ] }));
  ok('F: MCX fetch rejected → "NSE live"', (await run(w)).t === 'NSE live');

  // G — closing phase counts as live
  ({ w } = await boot({ tokens: DAY, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'CLOSING_START') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_CLOSE') } }
  ] }));
  ok('G: CLOSING_START → "NSE live"', (await run(w)).t === 'NSE live');

  // H — analytics-token-only session still gets the chip (market info is atok-friendly)
  ({ w, calls } = await boot({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } }, routes: [
    { re: /\/v2\/market\/status\/NSE$/, body: { status: 'success', data: D('NSE', 'NORMAL_CLOSE') } },
    { re: /\/v2\/market\/status\/MCX$/, body: { status: 'success', data: D('MCX', 'NORMAL_OPEN') } }
  ] }));
  const before = calls.length;
  r = await run(w);
  ok('H: atok session → MCX live', r.t === 'MCX live' && calls.slice(before).some(c => c.u.endsWith('/v2/market/status/MCX')));

  process.exit(report('MKT-STATUS TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
