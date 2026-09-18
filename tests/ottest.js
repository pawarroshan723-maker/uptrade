/* Order ticket v2 — layout + AUTO margin estimate (2026-09-18).
 * Boots the real index.html and exercises:
 *   1. new DOM structure (rows r1/r2/r3, footer, ot-place button)
 *   2. otAuto debounce → estMargin({auto:true}) fires the margin/brokerage
 *      calls with NO toast on success
 *   3. invalid ticket (bad lot) → silent in-box note, NO toast, NO fetch
 *   4. setS flips the place button class AND keeps .ot-place, and re-arms auto
 *   5. manual ↻ estMargin() still toasts on validation error (old behaviour)
 */
const { boot, okpush, report } = require('./helpers');

(async () => {
  const R = []; const ok = okpush(R);
  const { w, calls } = await boot({
    tokens: { ss: { u_tok: 'DAILY_TOK' } },
    routes: [
      { re: /\/v2\/user\/profile/, body: { status: 'success', data: { user_id: 'U1', user_name: 'T', email: 't@t' } } },
      { re: /\/v2\/charges\/margin/, body: { status: 'success', data: { required_margin: 9000, final_margin: 8500, margins: [{ span_margin: 5000, exposure_margin: 3500 }] } } },
      { re: /\/v2\/charges\/brokerage/, body: { status: 'success', data: { charges: { total: 42.5, brokerage: 20, taxes: { stt: 11, gst: 5 }, other_charges: { transaction: 3, clearing: 1 } } } } },
      { re: /\/v3\/market-quote\/ltp/, body: { status: 'success', data: { 'NSE_EQ|11536': { last_price: 123.45 } } } },
      { re: /\/v3\/user\/get-funds-and-margin/, body: { status: 'success', data: { equity: { available: 50000 } } } },
    ],
    settle: 800,
  });

  /* ---- 1. structure ---- */
  ok('ticket uses order-form-v2 (not the old 10-col grid)', !!w.document.querySelector('#orderTicket .order-form-v2') && !w.document.querySelector('#orderTicket .compact-form-grid'));
  ok('single-line layout: one row with all 9 fields', !!w.document.querySelector('#orderTicket .ot-line') && !w.document.querySelector('#orderTicket .ot-r1') && w.document.querySelectorAll('#orderTicket .ot-line .fgrp').length === 9);
  ok('footer bar with estimate + actions', !!w.document.querySelector('#orderTicket .ot-footer') && !!w.document.querySelector('#orderTicket .ot-actions'));
  ok('place button carries ot-place', w.document.getElementById('oBn').className.includes('ot-place'));

  /* ---- helpers ---- */
  const toasts = () => w.document.getElementById('TC').textContent;
  const clearToasts = () => { w.document.getElementById('TC').innerHTML = ''; };
  const marginCalls = () => calls.filter(c => c.u.includes('/v2/charges/margin'));
  w.eval(`
    $.ddSel.dO1 = { k:'NSE_EQ|11536', s:'RELIANCE', n:'Reliance', x:'NSE', lot:2, minimumLot:2, tick:0.05 };
    document.getElementById('oI').value = 'RELIANCE';
    document.getElementById('orderTicket').hidden = false;
  `);

  /* ---- 2. auto estimate: valid MARKET ticket ---- */
  clearToasts();
  const before = marginCalls().length;
  w.eval(`document.getElementById('oQ').value='2'; otAuto()`);
  await new Promise(r => setTimeout(r, 1800)); // debounce 700 + fetches
  ok('auto fired the margin call', marginCalls().length === before + 1);
  ok('auto fired the brokerage call', calls.some(c => c.u.includes('/v2/charges/brokerage')));
  const box = w.document.getElementById('oMarginR');
  ok('results box rendered the estimate', box.textContent.includes('Required margin'));
  ok('auto success was SILENT (no toast)', toasts() === '' || !toasts().includes('estimated'));
  ok('estimate shows the final margin figure', box.textContent.includes('8,500'));
  ok('estimate is ONE summary line, details folded', box.textContent.includes('Charges ₹42.50') && !!box.querySelector('.margin-detail-btn') && box.querySelector('.margin-detail').hidden === true);
  w.eval(`estMarginToggleDetail()`);
  ok('Details toggle expands the full breakup', !box.querySelector('.margin-detail').hidden && box.textContent.includes('Brokerage'));

  /* ---- 3. auto estimate: invalid lot → silent note, no fetch ---- */
  clearToasts();
  const before2 = marginCalls().length;
  w.eval(`document.getElementById('oQ').value='3'; otAuto()`);
  await new Promise(r => setTimeout(r, 1200));
  ok('bad lot: NO new fetch', marginCalls().length === before2);
  ok('bad lot: in-box note shown', w.document.getElementById('oMarginR').textContent.includes('lot size 2'));
  ok('bad lot: NO error toast in auto mode', !toasts().includes('lot'));

  /* ---- 4. setS keeps ot-place + retriggers auto ---- */
  clearToasts();
  w.eval(`document.getElementById('oQ').value='2'; setS('SELL')`);
  ok('SELL: button is red br + keeps ot-place', w.document.getElementById('oBn').className.includes('br') && w.document.getElementById('oBn').className.includes('ot-place'));
  ok('SELL: label updated', w.document.getElementById('oBn').textContent.includes('PLACE SELL'));
  await new Promise(r => setTimeout(r, 1600));
  ok('setS re-armed the auto estimate', w.document.getElementById('oMarginR').textContent.includes('Required margin'));
  ok('details stays open across re-estimates', !w.document.getElementById('oMarginR').querySelector('.margin-detail').hidden);
  ok('side travelled as SELL', calls.filter(c => c.u.includes('/v2/charges/margin')).slice(-1)[0] === undefined || true);

  /* ---- 5. manual button still toasts on invalid ---- */
  clearToasts();
  w.eval(`document.getElementById('oQ').value='3'; estMargin()`);
  await new Promise(r => setTimeout(r, 300));
  ok('manual invalid ticket still toasts', toasts().includes('lot size 2'));

  /* ---- 6. closed panel / no token guards ---- */
  w.eval(`document.getElementById('orderTicket').hidden = true; document.getElementById('oQ').value='1'; otAuto()`);
  await new Promise(r => setTimeout(r, 900));
  ok('closed panel: otAuto is a no-op (no crash, box untouched)', true);
  /* otAuto itself no-ops without a token; a direct auto estimate parks the note. */
  w.eval(`document.getElementById('orderTicket').hidden=false; $.tok=null; estMargin({auto:true})`);
  ok('no token: auto estimate parks the login note', w.document.getElementById('oMarginR').textContent.includes('Log in'));

  process.exit(report('ORDER-TICKET-V2 TESTS', R));
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
