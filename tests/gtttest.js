/* GTT product fix + order guards (2026-09-18, rev 2).
 * Root cause reproduced here: a BUY GTT on an MCX crude-oil CE used to go
 * out with product 'I' (MIS); Upstox rejects MIS on BUYING options. Even
 * after the NRML fix the broker still answered the PLACE call with the
 * generic UDAPI100500 "Something went wrong… please contact us", because
 * MCX instruments had leaked into the NSE/BSE-only GTT picker
 * (instrumentAllowed never enforced cfg.exchanges) — MCX_FO groups as 'FO'.
 *   1. BUY  option GTT  → product 'D' (NRML)  ← the product fix
 *   2. SELL option GTT  → product 'I' (unchanged)
 *   3. BUY  future GTT  → product 'I' (unchanged)
 *   4. GTT place is confirm()-gated; MCX GTTs get an explicit risk-confirm
 *   5. GTT picker: MCX instruments blocked for dG1, still allowed for dO1
 *   6. 0.25% trigger-distance rule pre-checked against live LTP
 *   7. Generic broker failure → the JUST-REJECTED child order's real
 *      status_message is surfaced, plus the broker error code
 *   8. Regular ticket: BUY option + Intraday product blocked client-side
 *   9. Order history shows the broker's status_message (rejection reason)
 *  10. instrumentIsOption: type master + symbol fallback, no equity false-positives
 * 11. After-market (2026-09-18 evening): segment-aware IST clock, AMO gate on
 *     place (UDAPI100039/100074), MCX evening session stays LIVE, GTT after-hours
 *     note, and the quantity auto-fill is announced + reset on every instrument
 *     change (a 1-LOT MCX fill used to be indistinguishable from the default).
 */
const { boot, okpush, report } = require('./helpers');

(async () => {
  const R = []; const ok = okpush(R);
  /* the GTT place is a POST — the instrument rides in the body, so the route
     switches on this flag instead of the URL */
  const routeState = { failGtt: false };
  const { w } = await boot({
    tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } },
    routes: [
      /* GTT place: success — or the broker's generic UDAPI100500 error when
         routeState.failGtt is armed (the diagnosis scenario) */
      { re: /\/v3\/order\/gtt\/place/, bodyFn: () => routeState.failGtt
        ? { status: 'error', errors: [{ errorCode: 'UDAPI100500', message: 'Something went wrong... please contact us', property_path: null, invalid_value: null }] }
        : { status: 'success', data: { gtt_order_ids: ['GTT-T1'] }, metadata: { latency: 42 } } },
      /* LTP: price depends on the instrument token in the query (%7C-encoded) */
      { re: /\/v3\/market-quote\/ltp/, bodyFn: us => {
        const ltp = us.includes('99999') ? 100 : us.includes('56842') ? 225 : 220;
        return { status: 'success', data: { whatever: { last_price: ltp } } };
      } },
      /* Order book: a JUST-rejected child order for the diagnosis instrument */
      { re: /\/v2\/order\/retrieve-all/, bodyFn: us => ({ status: 'success', data: [
        { instrument_token: 'NSE_FO|99999', status: 'rejected', quantity: 75, price: 150,
          status_message: '58 : Price outside execution range for the contract',
          order_timestamp: new Date().toISOString(), transaction_type: 'BUY', order_type: 'LIMIT' },
      ] }) },
      { re: /\/v2\/order\/history/, body: { status: 'success', data: [
        { status: 'req received', quantity: 100, price: 225.6 },
        { status: 'validation pending', quantity: 100, price: 225.6 },
        { status: 'rejected', quantity: 100, price: 225.6, status_message: '63 : Intraday product is not allowed for buying options' },
      ] } },
    ],
    settle: 800,
  });

  /* capture request bodies by wrapping the app's fetch (delegates to the stub,
     so the shared `calls` log stays intact) */
  const bodies = [];
  const origFetch = w.fetch;
  w.fetch = (u, o) => { bodies.push({ u: String(u), body: o && o.body }); return origFetch(u, o); };
  w.confirm = () => true;
  /* Pin the IST clock: plO() now checks the market session (AMO gate), so the
     suite must not depend on wall-clock time. Local-parsed wall time = IST for
     the app's istClock() (getHours/getDay only). Friday 11:00 → all sessions open. */
  w.istClock = () => new Date('2026-09-18T11:00:00');

  const gttCount = () => bodies.filter(b => b.u.includes('/v3/order/gtt/place')).length;
  const gttBodies = () => bodies.filter(b => b.u.includes('/v3/order/gtt/place'))
    .map(b => (typeof b.body === 'string' ? JSON.parse(b.body) : b.body));
  const setGtt = (sel, side, qty, trig) => w.eval(`
    $.ddSel.dG1=${JSON.stringify(sel)};
    document.getElementById('gI').value=${JSON.stringify(sel.s)};
    document.getElementById('gSd').value=${JSON.stringify(side)};
    document.getElementById('gQt').value=${JSON.stringify(String(qty))};
    document.getElementById('gTr').value=${JSON.stringify(String(trig))};
    document.getElementById('gTt').value='ABOVE';
  `);

  const CRUDE_CE = { k: 'MCX_FO|47861', s: 'CRUDEOIL26OCT10000CE', n: 'CRUDEOIL 26 OCT 10000 CE', type: 'CE', segment: 'MCX_FO', x: 'MCX', lot: 100, minimumLot: 100, tick: 0.1 };
  const CRUDE_FUT = { k: 'MCX_FO|47862', s: 'CRUDEOIL26OCTFUT', n: 'CRUDEOIL 26 OCT FUT', type: 'FUT', segment: 'MCX_FO', x: 'MCX', lot: 100, minimumLot: 100, tick: 0.1 };
  const NIFTY_CE = { k: 'NSE_FO|56842', s: 'NIFTY26OCT25000CE', n: 'NIFTY 26 OCT 25000 CE', type: 'CE', segment: 'NSE_FO', x: 'NSE', lot: 75, minimumLot: 75, tick: 0.05 };

  /* ---- 1. the reported case: BUY crude-oil CE GTT → NRML (MCX risk-confirm accepted) ---- */
  setGtt(CRUDE_CE, 'BUY', 100, 225.6);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  const b1 = gttBodies();
  ok('BUY option GTT placed exactly once', b1.length === 1);
  ok('BUY option GTT product is D (NRML), not I', b1[0] && b1[0].product === 'D');
  ok('GTT body carries instrument/qty/rules intact',
    b1[0] && b1[0].instrument_token === 'MCX_FO|47861' && b1[0].quantity === 100 &&
    b1[0].transaction_type === 'BUY' && b1[0].type === 'SINGLE' &&
    b1[0].rules[0].strategy === 'ENTRY' && b1[0].rules[0].trigger_price === 225.6);

  /* ---- 2. SELL option keeps intraday (margin-selling is allowed) ---- */
  setGtt(CRUDE_CE, 'SELL', 100, 225.6);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('SELL option GTT keeps product I', gttBodies().length === 2 && gttBodies()[1].product === 'I');

  /* ---- 3. BUY future keeps intraday ---- */
  setGtt(CRUDE_FUT, 'BUY', 100, 6250.0);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('BUY future GTT keeps product I', gttBodies().length === 3 && gttBodies()[2].product === 'I');

  /* ---- 4. confirm gates: declined → nothing placed ---- */
  w.confirm = () => false;
  setGtt(CRUDE_CE, 'BUY', 100, 225.6);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('declined MCX risk-confirm → no request', gttCount() === 3);
  w.confirm = () => true;

  /* ---- 5. picker: MCX blocked from dG1, allowed for dO1; NSE/BSE fine in dG1 ---- */
  ok('instrumentAllowed enforces the exchange allow-list (MCX out of GTT picker)',
    w.eval(`instrumentAllowed(${JSON.stringify(CRUDE_CE)},'dG1')===false &&
            instrumentAllowed(${JSON.stringify(CRUDE_CE)},'dO1')===true &&
            instrumentAllowed(${JSON.stringify(NIFTY_CE)},'dG1')===true &&
            instrumentAllowed({k:'BSE_EQ|INE002A01018',s:'YESBANK',x:'BSE',segment:'BSE_EQ',type:'EQ'},'dG1')===true`));

  /* ---- 6. 0.25% trigger-distance pre-check (documented GTT rule) ---- */
  w.document.getElementById('TC').innerHTML = '';
  setGtt(NIFTY_CE, 'BUY', 75, 225.3); /* LTP 225 → min distance 0.5625; 225.3 is 0.3 away */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('trigger within 0.25% of LTP is blocked before the request', gttCount() === 3);
  ok('0.25% block explains LTP and the allowed band',
    w.document.getElementById('TC').textContent.includes('0.25% of LTP ₹225'));
  setGtt(NIFTY_CE, 'BUY', 75, 230); /* 5 away — fine */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('trigger beyond 0.25% goes through', gttCount() === 4);

  /* ---- 7. generic failure → real child rejection reason + error code ---- */
  w.document.getElementById('TC').innerHTML = '';
  routeState.failGtt = true; /* arm the generic UDAPI100500 failure */
  setGtt({ ...NIFTY_CE, k: 'NSE_FO|99999', s: 'BANKNIFTY26OCT60000CE' }, 'BUY', 75, 150); /* LTP 100 → far enough; place errors */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 500));
  const toast = w.document.getElementById('TC').textContent;
  ok('generic failure surfaces the JUST-rejected child order reason',
    toast.includes('Price outside execution range'));
  ok('broker error code is appended (UDAPI100500)', toast.includes('(UDAPI100500)'));
  routeState.failGtt = false; /* disarm */

  /* ---- 8. GTT ticket header hint chip ---- */
  ok('GTT ticket shows the NSE/BSE + NRML hint chip',
    !!w.document.querySelector('#gttTicket .quick-head .qh-fohint') &&
    w.document.querySelector('#gttTicket .quick-head .qh-fohint').textContent.includes('NSE/BSE'));

  /* ---- 9. regular ticket guard: BUY option + Intraday blocked ---- */
  w.document.getElementById('TC').innerHTML = '';
  const before = bodies.filter(b => b.u.includes('/v3/order/place')).length;
  w.eval(`
    $.ddSel.dO1=${JSON.stringify(NIFTY_CE)};
    document.getElementById('oI').value='NIFTY26OCT25000CE';
    document.getElementById('oQ').value='75';
    document.getElementById('oTy').value='LIMIT';
    document.getElementById('oP').value='123.05';
    document.getElementById('oPr').value='I';
    setS('BUY');
    plO();
  `);
  await new Promise(r => setTimeout(r, 300));
  ok('BUY option + Intraday blocked client-side (no place request)',
    bodies.filter(b => b.u.includes('/v3/order/place')).length === before);
  ok('guard toast tells the user to switch product',
    w.document.getElementById('TC').textContent.includes('not allowed for buying options'));
  w.document.getElementById('TC').innerHTML = '';
  w.eval(`document.getElementById('oPr').value='D'; plO();`);
  await new Promise(r => setTimeout(r, 300));
  ok('BUY option + Delivery is NOT blocked (place request sent)',
    bodies.filter(b => b.u.includes('/v3/order/place')).length === before + 1);

  /* ---- 10. order history shows the rejection reason ---- */
  await w.eval(`oHist('260918000172')`);
  await new Promise(r => setTimeout(r, 300));
  const hist = w.document.getElementById('dtBd');
  ok('history lists all three statuses', ['req received', 'validation pending', 'rejected'].every(t => hist.textContent.includes(t)));
  ok('history surfaces the broker rejection reason', hist.textContent.includes('Intraday product is not allowed for buying options'));

  /* ---- 11. instrumentIsOption unit checks ---- */
  ok('instrumentIsOption: type master + symbol fallback + no equity false-positives',
    w.eval(`instrumentIsOption(${JSON.stringify(CRUDE_CE)})===true &&
            instrumentIsOption({s:'CRUDEOIL26OCT10000PE'})===true &&
            instrumentIsOption(${JSON.stringify(CRUDE_FUT)})===false &&
            instrumentIsOption({s:'ACE',type:'EQ'})===false &&
            instrumentIsOption({s:'RELIANCE'})===false`));

  /* ---- 12. MCX quantity = LOTS: ticket defaults, validation, confirm, estimator ---- */
  const confirms = [];
  w.confirm = m => { confirms.push(String(m)); return true; };
  w.eval(`applyInstrumentDefaults('dO1', ${JSON.stringify(CRUDE_CE)})`);
  ok('MCX pick resets ticket qty to 1 LOT (step 1)',
    w.document.getElementById('oQ').value === '1' && String(w.document.getElementById('oQ').step) === '1');
  const placeBefore = bodies.filter(b => b.u.includes('/v3/order/place')).length;
  w.eval(`
    $.ddSel.dO1=${JSON.stringify(CRUDE_CE)};
    document.getElementById('oI').value='CRUDEOIL26OCT10000CE';
    document.getElementById('oQ').value='1';
    document.getElementById('oTy').value='LIMIT';
    document.getElementById('oP').value='584.1';
    document.getElementById('oPr').value='D';
    setS('BUY');
    plO();
  `);
  await new Promise(r => setTimeout(r, 300));
  const lastPlace = bodies.filter(b => b.u.includes('/v3/order/place'))
    .map(b => (typeof b.body === 'string' ? JSON.parse(b.body) : b.body)).pop();
  ok('MCX qty 1 (one lot) passes the old lot-multiple guard and places',
    bodies.filter(b => b.u.includes('/v3/order/place')).length === placeBefore + 1);
  ok('MCX place sends quantity 1 (lots)', lastPlace && lastPlace.quantity === 1 && lastPlace.instrument_token === 'MCX_FO|47861');
  ok('MCX confirm echoes the lots→units conversion',
    confirms.some(m => m.includes('LOTS') && m.includes('= 100 units')));
  w.eval(`document.getElementById('orderTicket').hidden=false; estMargin()`);
  await new Promise(r => setTimeout(r, 500));
  const estBox = w.document.getElementById('oMarginR').textContent;
  ok('MCX qty 1 no longer trips the lot-multiple estimate bail',
    !estBox.includes('multiple of lot size'));

  /* ---- 13. GTT far-trigger guard (option premium ≠ index price) ---- */
  const gttBeforeFar = gttCount();
  w.confirm = () => false; /* decline the far-trigger confirm */
  setGtt(NIFTY_CE, 'BUY', 75, 1000); /* LTP 225 → 1000 is > 3x → far-trigger confirm */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('far-from-LTP trigger requires an explicit confirm (declined → no request)',
    gttCount() === gttBeforeFar);

  /* ---- 14. after-market clock + AMO gate + auto-fill announce ---- */
  const clock = t => { w.istClock = () => new Date(t); };
  const phaseAt = (t, g) => { clock(t); return w.eval(`marketPhase(${JSON.stringify(g)})`); };
  ok('clock: NSE/BSE open Fri 09:15–15:30 only (11:00 open; 18:10/09:14/15:30/Sat closed)',
    phaseAt('2026-09-18T11:00:00', 'EQ') === 'open' &&
    phaseAt('2026-09-18T09:15:00', 'EQ') === 'open' &&
    phaseAt('2026-09-18T18:10:00', 'EQ') === 'closed' &&
    phaseAt('2026-09-18T09:14:00', 'EQ') === 'closed' &&
    phaseAt('2026-09-18T15:30:00', 'EQ') === 'closed' &&
    phaseAt('2026-09-19T11:00:00', 'EQ') === 'closed');
  ok('clock: MCX evening session open 18:10 & 23:29, closed 23:30; CDS 17:00 close',
    phaseAt('2026-09-18T18:10:00', 'COMM') === 'open' &&
    phaseAt('2026-09-18T23:29:00', 'COMM') === 'open' &&
    phaseAt('2026-09-18T23:30:00', 'COMM') === 'closed' &&
    phaseAt('2026-09-18T16:59:00', 'CURR') === 'open' &&
    phaseAt('2026-09-18T17:00:00', 'CURR') === 'closed');

  w.confirm = () => true;
  const placeCnt14 = () => bodies.filter(b => b.u.includes('/v3/order/place')).length;
  const lastPlace14 = () => bodies.filter(b => b.u.includes('/v3/order/place'))
    .map(b => (typeof b.body === 'string' ? JSON.parse(b.body) : b.body)).pop();
  const setTicket = (sel, q, px, amo) => w.eval(`
    $.ddSel.dO1=${JSON.stringify(sel)};
    document.getElementById('oI').value=${JSON.stringify(sel.s)};
    document.getElementById('oQ').value=${JSON.stringify(String(q))};
    document.getElementById('oTy').value='LIMIT';
    document.getElementById('oP').value=${JSON.stringify(String(px))};
    document.getElementById('oPr').value='D';
    document.getElementById('oAm').value=${JSON.stringify(amo)};
    setS('BUY');`);

  /* NSE after close: AMO confirm → declined */
  clock('2026-09-18T18:10:00');
  w.document.getElementById('TC').innerHTML = '';
  const beforeAmo = placeCnt14();
  w.confirm = m => !String(m).includes('Place as AMO?'); /* decline only the AMO offer */
  setTicket(NIFTY_CE, 75, 123.05, 'false');
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('after close: declining AMO sends nothing + explains',
    placeCnt14() === beforeAmo && w.document.getElementById('TC').textContent.includes('Market closed'));
  /* accepted */
  w.confirm = () => true;
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('after close: accepted AMO → is_amo:true sent, select flipped to Yes',
    placeCnt14() === beforeAmo + 1 && lastPlace14().is_amo === true &&
    w.document.getElementById('oAm').value === 'true');

  /* MCX at the same 18:10 → evening session LIVE */
  const msgs141 = [];
  w.confirm = m => { msgs141.push(String(m)); return true; };
  setTicket(CRUDE_CE, 1, 584.1, 'false');
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('MCX 18:10 is LIVE (evening session) — no AMO confirm, is_amo:false',
    placeCnt14() === beforeAmo + 2 && lastPlace14().is_amo === false &&
    !msgs141.some(m => m.includes('Place as AMO?')));

  /* API window: 00:30 IST → blocked with the broker reason */
  clock('2026-09-18T00:30:00');
  w.document.getElementById('TC').innerHTML = '';
  const beforeWin = placeCnt14();
  setTicket(NIFTY_CE, 75, 123.05, 'true');
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('00:30 IST → UDAPI100074 block, no request',
    placeCnt14() === beforeWin && w.document.getElementById('TC').textContent.includes('UDAPI100074'));

  /* market open + AMO Yes → offered live instead */
  clock('2026-09-18T11:00:00');
  w.confirm = m => !String(m).includes('live order instead?'); /* declined → nothing sent */
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  const declinedCnt = placeCnt14();
  w.confirm = () => true;
  await w.eval('plO()');
  await new Promise(r => setTimeout(r, 300));
  ok('market open: AMO Yes → offered live; accepted → is_amo:false + select No',
    declinedCnt === beforeWin && placeCnt14() === declinedCnt + 1 &&
    lastPlace14().is_amo === false && w.document.getElementById('oAm').value === 'false');

  /* GTT after-hours note */
  clock('2026-09-18T18:10:00');
  const gttBefore14 = gttCount();
  const msgs142 = [];
  w.confirm = m => { msgs142.push(String(m)); return false; };
  setGtt(NIFTY_CE, 'BUY', 75, 230); /* 5 from LTP 225 — no far-trigger confirm */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('GTT after hours: confirm says stored-now/armed-in-session (and is declinable)',
    msgs142.some(m => m.includes('after hours: stored now')) && gttCount() === gttBefore14);

  /* quantity auto-fill: announced + reset on every instrument change */
  w.confirm = () => true;
  clock('2026-09-18T11:00:00');
  w.document.getElementById('TC').innerHTML = '';
  w.eval(`applyInstrumentDefaults('dO1', ${JSON.stringify(NIFTY_CE)})`);
  ok('NSE pick → qty 75, announced, label carries the lot',
    w.document.getElementById('oQ').value === '75' &&
    w.document.getElementById('TC').textContent.includes('auto-filled: 75') &&
    w.document.querySelector('#oQ').closest('.fgrp').querySelector('label').textContent === 'Qty (lot 75)');
  w.eval(`applyInstrumentDefaults('dO1', ${JSON.stringify(CRUDE_CE)})`);
  ok('MCX pick → qty 1 LOT, announced with the unit conversion, LOTS label',
    w.document.getElementById('oQ').value === '1' &&
    w.document.getElementById('TC').textContent.includes('auto-filled: 1 LOT') &&
    w.document.getElementById('TC').textContent.includes('100 units') &&
    w.document.querySelector('#oQ').closest('.fgrp').querySelector('label').textContent === 'Qty (LOTS)' &&
    /LOTS/.test(w.document.getElementById('oQ').title));
  w.document.getElementById('TC').innerHTML = '';
  w.eval(`document.getElementById('oQ').value='3'; applyInstrumentDefaults('dO1', ${JSON.stringify(CRUDE_CE)})`);
  ok('same-instrument re-pick keeps valid 3, no re-announce',
    w.document.getElementById('oQ').value === '3' &&
    !w.document.getElementById('TC').textContent.includes('auto-filled'));
  w.eval(`document.getElementById('oQ').value='40'; applyInstrumentDefaults('dO1', ${JSON.stringify(NIFTY_CE)})`);
  ok('instrument change with invalid qty snaps to the new lot (75)',
    w.document.getElementById('oQ').value === '75');
  w.eval(`applyInstrumentDefaults('dG1', ${JSON.stringify(NIFTY_CE)})`);
  ok('GTT form qty auto-fills too (75, labelled)',
    w.document.getElementById('gQt').value === '75' &&
    w.document.querySelector('#gQt').closest('.fgrp').querySelector('label').textContent === 'Qty (lot 75)');

  /* AMO select auto-sync on pick */
  clock('2026-09-18T18:10:00');
  w.eval(`applyInstrumentDefaults('dO1', ${JSON.stringify(NIFTY_CE)})`);
  ok('after-hours NSE pick auto-sets AMO Yes',
    w.document.getElementById('oAm').value === 'true');
  w.eval(`applyInstrumentDefaults('dO1', ${JSON.stringify(CRUDE_CE)})`);
  ok('MCX evening pick keeps AMO No (session still open)',
    w.document.getElementById('oAm').value === 'false');

  /* ---- 15. GTT doc conformance: trailing-gap floor + bracket leg shapes ---- */
  w.confirm = () => true;
  clock('2026-09-18T11:00:00');
  const setBracket = (t, sl, gap) => w.eval(`
    document.getElementById('gTg').value=${JSON.stringify(String(t))};
    document.getElementById('gSl').value=${JSON.stringify(String(sl))};
    document.getElementById('gTsl').value=${JSON.stringify(String(gap || ''))};`);
  /* LTP for NIFTY_CE (NSE_FO|56842) is 225 → floor = 10% × |225 − 200| = 2.50 */
  w.document.getElementById('TC').innerHTML = '';
  const before15 = gttCount();
  setGtt(NIFTY_CE, 'BUY', 75, 230);
  setBracket(260, 200, 1); /* gap 1 < 2.50 → blocked */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  ok('trailing gap below the 10%-of-|LTP−SL| floor is blocked with the computed minimum',
    gttCount() === before15 &&
    w.document.getElementById('TC').textContent.includes('Trailing gap') &&
    w.document.getElementById('TC').textContent.includes('2.50'));
  setBracket(260, 200, 3); /* ≥ 2.50 → placed */
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 400));
  const g15 = gttBodies().pop();
  ok('gap ≥ floor places a MULTIPLE GTT, trailing_gap rides the STOPLOSS leg',
    gttCount() === before15 + 1 && g15.type === 'MULTIPLE' &&
    g15.rules.find(r => r.strategy === 'STOPLOSS').trailing_gap === 3);
  ok('doc shapes: ENTRY first; TARGET/STOPLOSS IMMEDIATE-only; market_protection −1 on every leg',
    g15.rules[0].strategy === 'ENTRY' &&
    g15.rules.filter(r => r.strategy !== 'ENTRY').every(r => r.trigger_type === 'IMMEDIATE') &&
    g15.rules.every(r => r.market_protection === -1));
  ok('bracket rules are DENSE — no null hole in the serialized array (old rules[2] bug)',
    g15.rules.length === 3 && g15.rules.every(Boolean) &&
    g15.rules.map(r => r.strategy).join(',') === 'ENTRY,TARGET,STOPLOSS');

  process.exit(report('GTT+ORDER GUARD TESTS', R));
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
