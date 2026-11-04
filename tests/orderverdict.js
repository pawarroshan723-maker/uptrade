/* "Order placed · broker 32 ms" but no order anywhere (2026-11-04).
 * Reported: the toast was green, the order book stayed empty — balance ₹0, so
 * the broker rejected the order a moment after acknowledging it.
 *
 * These checks prove:
 *   1. a place reply is only an acknowledgement — the app now reports the REAL
 *      verdict (REJECTED + the broker's reason), never a bare green success
 *   2. a rejected order is pulled into view (Orders → All) instead of hiding in
 *      a tab that looks empty
 *   3. an accepted order says so, with its status
 *   4. an order that never shows up is called out, not claimed as placed
 *   5. the funds pre-flight warns BEFORE sending when the ticket estimate says
 *      the balance cannot cover the margin (and declining places nothing)
 */
const { boot, okpush, report } = require('./helpers');

const okBody = (b, s = 200) => ({ ok: s < 400, status: s, text: () => Promise.resolve(JSON.stringify(b)) });
const PLACE_OK = { status: 'success', data: { order_ids: ['OID-777'] }, metadata: { latency: 32 } };

(async () => {
  const R = []; const ok = okpush(R);
  const { w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 700 });
  const ev = s => { try { return w.eval(s); } catch (e) { return '__THROW__:' + e.message; } };
  const toasts = () => (w.document.getElementById('TC')?.textContent || '').replace(/\s+/g, ' ').trim();
  const clear = () => { w.document.getElementById('TC').innerHTML = ''; };

  const arm = () => ev(`
    $.oSide='BUY';$.marginLast=null;
    $.ddSel.dO1={k:'NSE_EQ|INE002A01018',s:'RELIANCE',n:'Reliance',x:'NSE',lot:1,minimumLot:1,tick:0.05};
    document.getElementById('oI').value='RELIANCE';
    document.getElementById('oQ').value='5';
    document.getElementById('oP').value='2500';
    document.getElementById('oTy').value='MARKET';
    document.getElementById('oPr').value='D';
    document.getElementById('oVl').value='DAY';
    document.getElementById('oAm').value='true';
    $.oTab='open';rnO();`);

  /* ============ 1. acknowledgement + later rejection ============ */
  w.confirm = () => true;
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/place/.test(us)) return Promise.resolve(okBody(PLACE_OK));
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(okBody({ status: 'success', data: [{
      order_id: 'OID-777', instrument_token: 'NSE_EQ|INE002A01018', transaction_type: 'BUY', quantity: 5,
      order_type: 'MARKET', status: 'rejected', status_message: 'Insufficient funds in your account',
      order_timestamp: new Date().toISOString() }] }));
    return Promise.resolve(okBody({ status: 'success', data: [] }));
  };
  arm(); clear();
  ev('plO()');
  await new Promise(r => setTimeout(r, 400));
  ok('place reply is reported as sent, not as a success', /Order sent/i.test(toasts()) && /confirming with the broker/i.test(toasts()));
  await new Promise(r => setTimeout(r, 2600));
  const t1 = toasts();
  ok('a rejected order is reported as REJECTED, with the broker reason',
    /REJECTED by the broker/i.test(t1) && /Insufficient funds/i.test(t1) && /OID-777/.test(t1));
  ok('no green "Order placed" claim survives the rejection', !/Order placed/i.test(t1));
  ok('the rejected row is pulled into view (Orders → All)',
    ev(`$.oTab==='all'`) === true && ev(`!!document.querySelector('#pg-orders .tab[data-tab="all"].on')`) === true);

  /* ============ 2. acknowledgement + real acceptance ============ */
  w.fetch = (u) => {
    const us = String(u);
    if (/order\/place/.test(us)) return Promise.resolve(okBody(PLACE_OK));
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(okBody({ status: 'success', data: [{
      order_id: 'OID-777', instrument_token: 'NSE_EQ|INE002A01018', transaction_type: 'BUY', quantity: 5,
      order_type: 'MARKET', status: 'open', order_timestamp: new Date().toISOString() }] }));
    return Promise.resolve(okBody({ status: 'success', data: [] }));
  };
  arm(); clear();
  ev('plO()');
  await new Promise(r => setTimeout(r, 1600));
  ok('an accepted order says so with its live status', /Order accepted — open/i.test(toasts()));
  ok('acceptance does not switch the orders tab', ev(`$.oTab==='open'`) === true);

  /* ============ 3. acknowledged but never appears ============ */
  w.fetch = (u) => {
    const us = String(u);
    if (/order\/place/.test(us)) return Promise.resolve(okBody(PLACE_OK));
    return Promise.resolve(okBody({ status: 'success', data: [] }));
  };
  arm(); clear();
  ev('plO()');
  await new Promise(r => setTimeout(r, 3600));
  ok('an order that never shows up is called out, not claimed',
    /Order sent but not visible/i.test(toasts()) && !/Order accepted/i.test(toasts()));

  /* ============ 4. funds pre-flight blocks a doomed order ============ */
  let placements = 0, asked = 0;
  w.fetch = (u) => {
    const us = String(u);
    if (/order\/place/.test(us)) { placements++; return Promise.resolve(okBody(PLACE_OK)); }
    return Promise.resolve(okBody({ status: 'success', data: [] }));
  };
  w.confirm = (m) => { if (/Not enough funds/i.test(String(m))) { asked++; return false; } return true; };
  ev(`$.marginLast={inst:'NSE_EQ|INE002A01018',qty:5,side:'BUY',product:'D',orderType:'MARKET',need:12500,avail:0};`);
  clear();
  ev('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('pre-flight warns with the exact shortfall before sending',
    asked === 1 && /Not placed — margin shortfall/i.test(toasts()));
  ok('declining the warning sends nothing at all', placements === 0);

  /* ============ 5. pre-flight is not in the way when funded ============ */
  placements = 0; asked = 0;
  w.confirm = (m) => { if (/Not enough funds/i.test(String(m))) { asked++; return true; } return true; };
  ev(`$.marginLast={inst:'NSE_EQ|INE002A01018',qty:5,side:'BUY',product:'D',orderType:'MARKET',need:12500,avail:50000};`);
  clear();
  ev('plO()');
  await new Promise(r => setTimeout(r, 400));
  ok('a funded ticket is not interrupted by the pre-flight', asked === 0 && placements === 1);

  /* ============ 6. the estimate itself feeds the pre-flight ============ */
  w.fetch = (u) => {
    const us = String(u);
    if (/charges\/margin/.test(us)) return Promise.resolve(okBody({ status: 'success', data: { required_margin: 12000, final_margin: 12500 } }));
    if (/charges\/brokerage/.test(us)) return Promise.resolve(okBody({ status: 'success', data: { charges: { total: 40, brokerage: 20 } } }));
    if (/get-funds-and-margin/.test(us)) return Promise.resolve(okBody({ status: 'success', data: { equity: { available_margin: 0, used_margin: 0, opening_balance: 0 } } }));
    if (/market-quote\/ltp/.test(us)) return Promise.resolve(okBody({ status: 'success', data: { 'NSE_EQ|INE002A01018': { last_price: 2500 } } }));
    return Promise.resolve(okBody({ status: 'success', data: [] }));
  };
  arm();
  ev('estMargin({auto:true})');
  await new Promise(r => setTimeout(r, 1200));
  const last = ev(`JSON.stringify($.marginLast||null)`);
  ok('the ticket estimate is remembered for the pre-flight',
    /"need":12500/.test(last) && /"avail":0/.test(last));

  process.exit(report('ORDER-VERDICT TESTS', R) ? 1 : 0);
})();
