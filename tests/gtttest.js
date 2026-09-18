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

  process.exit(report('GTT+ORDER GUARD TESTS', R));
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
