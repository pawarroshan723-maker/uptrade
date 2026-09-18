/* GTT product fix + order guards (2026-09-18).
 * Root cause reproduced here: a BUY GTT on an MCX crude-oil CE used to go
 * out with product 'I' (MIS); Upstox rejects MIS on BUYING options, so the
 * triggered child order died at exchange validation with only a generic
 * "Something went wrong… please contact us" and a bare "rejected" row.
 *   1. BUY  option GTT  → product 'D' (NRML)  ← the fix
 *   2. SELL option GTT  → product 'I' (unchanged)
 *   3. BUY  future GTT  → product 'I' (unchanged)
 *   4. GTT place is confirm()-gated (README §8 convention)
 *   5. GTT ticket header carries the Option-BUY→NRML hint chip
 *   6. Regular ticket: BUY option + Intraday product blocked client-side
 *   7. Order history surfaces the broker's status_message (rejection reason)
 *   8. instrumentIsOption: type master + symbol fallback, no equity false-positives
 */
const { boot, okpush, report } = require('./helpers');

(async () => {
  const R = []; const ok = okpush(R);
  const { w } = await boot({
    tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } },
    routes: [
      { re: /\/v3\/order\/gtt\/place/, body: { status: 'success', data: { gtt_order_ids: ['GTT-T1'] }, metadata: { latency: 42 } } },
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

  const gttBodies = () => bodies.filter(b => b.u.includes('/v3/order/gtt/place'))
    .map(b => (typeof b.body === 'string' ? JSON.parse(b.body) : b.body));
  const setGtt = (sel, side, qty, trig) => w.eval(`
    $.ddSel.dG1=${JSON.stringify(sel)};
    document.getElementById('gI').value=${JSON.stringify(sel.s)};
    document.getElementById('gSd').value=${JSON.stringify(side)};
    document.getElementById('gQt').value=${JSON.stringify(String(qty))};
    document.getElementById('gTr').value=${JSON.stringify(String(trig))};
  `);

  const CRUDE_CE = { k: 'MCX_FO|47861', s: 'CRUDEOIL26OCT10000CE', n: 'CRUDEOIL 26 OCT 10000 CE', type: 'CE', segment: 'MCX_FO', lot: 100, minimumLot: 100, tick: 0.1 };
  const CRUDE_FUT = { k: 'MCX_FO|47862', s: 'CRUDEOIL26OCTFUT', n: 'CRUDEOIL 26 OCT FUT', type: 'FUT', segment: 'MCX_FO', lot: 100, minimumLot: 100, tick: 0.1 };

  /* ---- 1. the reported case: BUY crude-oil CE GTT → NRML ---- */
  setGtt(CRUDE_CE, 'BUY', 100, 225.6);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 300));
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
  await new Promise(r => setTimeout(r, 300));
  ok('SELL option GTT keeps product I', gttBodies().length === 2 && gttBodies()[1].product === 'I');

  /* ---- 3. BUY future keeps intraday ---- */
  setGtt(CRUDE_FUT, 'BUY', 100, 6250.0);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 300));
  ok('BUY future GTT keeps product I', gttBodies().length === 3 && gttBodies()[2].product === 'I');

  /* ---- 4. confirm() gate: cancelled confirm → nothing placed ---- */
  w.confirm = () => false;
  setGtt(CRUDE_CE, 'BUY', 100, 225.6);
  await w.eval('crG()');
  await new Promise(r => setTimeout(r, 300));
  ok('GTT place is confirm()-gated (declined → no request)', gttBodies().length === 3);
  w.confirm = () => true;

  /* ---- 5. GTT ticket header hint chip ---- */
  ok('GTT ticket shows the Option-BUY→NRML hint chip',
    !!w.document.querySelector('#gttTicket .quick-head .qh-fohint') &&
    w.document.querySelector('#gttTicket .quick-head .qh-fohint').textContent.includes('NRML'));

  /* ---- 6. regular ticket guard: BUY option + Intraday blocked ---- */
  w.document.getElementById('TC').innerHTML = '';
  const before = bodies.filter(b => b.u.includes('/v3/order/place')).length;
  w.eval(`
    $.ddSel.dO1=${JSON.stringify({ k: 'NSE_FO|56842', s: 'NIFTY26OCT25000CE', n: 'NIFTY 26 OCT 25000 CE', type: 'CE', segment: 'NSE_FO', lot: 75, minimumLot: 75, tick: 0.05 })};
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
  /* same ticket with Delivery goes through to the confirm & place */
  w.document.getElementById('TC').innerHTML = '';
  w.eval(`document.getElementById('oPr').value='D'; plO();`);
  await new Promise(r => setTimeout(r, 300));
  ok('BUY option + Delivery is NOT blocked (place request sent)',
    bodies.filter(b => b.u.includes('/v3/order/place')).length === before + 1);

  /* ---- 7. order history shows the rejection reason ---- */
  await w.eval(`oHist('260918000172')`);
  await new Promise(r => setTimeout(r, 300));
  const hist = w.document.getElementById('dtBd');
  ok('history lists all three statuses', ['req received', 'validation pending', 'rejected'].every(t => hist.textContent.includes(t)));
  ok('history surfaces the broker rejection reason', hist.textContent.includes('Intraday product is not allowed for buying options'));

  /* ---- 8. instrumentIsOption unit checks ---- */
  ok('instrumentIsOption: type master + symbol fallback + no equity false-positives',
    w.eval(`instrumentIsOption(${JSON.stringify(CRUDE_CE)})===true &&
            instrumentIsOption({s:'CRUDEOIL26OCT10000PE'})===true &&
            instrumentIsOption(${JSON.stringify(CRUDE_FUT)})===false &&
            instrumentIsOption({s:'ACE',type:'EQ'})===false &&
            instrumentIsOption({s:'RELIANCE'})===false`));

  process.exit(report('GTT+ORDER GUARD TESTS', R));
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
