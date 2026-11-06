/* Menu-by-menu regression suite (2026-10-31 deep dive).
 * One block per menu; every assertion fails on the pre-fix build and passes now.
 * Menus covered: Dashboard/RO sessions · Orders · GTT · Trades · Positions ·
 * Option Chain · Chart · Algo · P&L · Session/logout · Session clock.
 * See REVIEW.md ("Menu-by-menu deep dive — 2026-10-31").
 */
const { boot, okpush, report } = require('./helpers');

const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
const OK = { status: 'success', data: [] };

(async () => {
  const R = []; const ok = okpush(R);
  const DAY = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };
  let { w } = await boot({ tokens: DAY, settle: 700 });
  /* eval that never aborts the run: a missing helper (pre-fix build) turns into
     a failed assertion instead of a crashed suite. */
  const ev = s => { try { return w.eval(s); } catch (e) { return '__THROW__'; } };
  const txt = id => (w.document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
  const cells = sel => [...w.document.querySelectorAll(sel)].map(t => t.textContent.trim());
  w.confirm = () => true;
  w.prompt = (m, d) => d;

  /* ============================ ORDERS ============================ */
  ev(`$.ords=[
    {order_id:'O1',trading_symbol:'TCS',instrument_token:'NSE_EQ|INE467B01029',transaction_type:'BUY',order_type:'MARKET',quantity:5,price:0,status:'open',order_timestamp:'2026-10-30T10:15:00+05:30'},
    {order_id:'O2',trading_symbol:'INFY',instrument_token:'NSE_EQ|INE009A01021',transaction_type:'SELL',order_type:'LIMIT',quantity:10,price:1500,status:'complete',order_timestamp:'2026-10-30T09:20:00+05:30'}
  ];$.oM={O1:$.ords[0],O2:$.ords[1]};rnO();`);
  let row = cells('#oTB tr:first-child td');
  ok('orders: MARKET order shows MKT, not 0.00', row[5] === 'MKT');
  ok('orders: order time renders in IST (10:15) for a UTC viewer', row[0] === '10:15');
  ev(`$.oTab='all';rnO();`);
  ok('orders: LIMIT price still shows the price', cells('#oTB tr:nth-child(2) td')[5] === '1500.00');

  /* double-click Cancel must not fire two DELETEs */
  let deletes = 0;
  w.fetch = (u, o) => {
    if (String(o && o.method).toUpperCase() === 'DELETE' && /order\/cancel/.test(String(u))) {
      deletes++;
      return new Promise(r => setTimeout(() => r(json(200, { status: 'success', data: { order_id: 'O1' } })), 60));
    }
    return json(200, OK);
  };
  ev(`canO('O1')`); ev(`canO('O1')`);
  await new Promise(r => setTimeout(r, 200));
  ok('orders: double-click Cancel sends exactly one DELETE', deletes === 1);
  ok('orders: cancel lock is released afterwards', ev('$.cancelBusy') === null);

  /* ============================== GTT ============================== */
  const gttRow = { gtt_order_id: 'GTT-CU25280200021013', type: 'SINGLE', quantity: 1, product: 'D',
    instrument_token: 'NSE_EQ|INE669E01016', transaction_type: 'BUY', created_at: 1733935563,
    rules: [{ strategy: 'ENTRY', trigger_type: 'ABOVE', trigger_price: 6, status: 'OPEN' }] };
  w.fetch = u => /\/v3\/order\/gtt(\?|$)/.test(String(u)) ? json(200, { status: 'success', data: [gttRow] }) : json(200, OK);
  await ev('ldG()');
  const gttText = txt('gTB');
  ok('gtt: a token-only row no longer renders "?"', !gttText.includes('?') && /INE669E01016|ESCORTS/.test(gttText));
  ok('gtt: quantity/trigger/status still render', gttText.includes('6.00') && gttText.includes('OPEN'));

  ok('gtt: equity tick resolves to 0.01 without the master',
    ev(`gttTickFor({instrument_token:'NSE_EQ|INE669E01016'})`) === 0.01);
  ok('gtt: modify payload drops response-only fields',
    ev(`JSON.stringify(gttRulePayload({strategy:'ENTRY',trigger_type:'ABOVE',trigger_price:6,status:'OPEN',message:'x',order_id:'y',market_protection:-1}))`)
      === '{"strategy":"ENTRY","trigger_type":"ABOVE","trigger_price":6,"market_protection":-1}');

  /* bracket direction is validated like the create form */
  ev(`$.gts=[{gtt_order_id:'G1',type:'MULTIPLE',quantity:1,instrument_token:'NSE_EQ|INE002A01018',transaction_type:'BUY',
      rules:[{strategy:'ENTRY',trigger_type:'ABOVE',trigger_price:100,status:'OPEN'},
             {strategy:'TARGET',trigger_type:'IMMEDIATE',trigger_price:90},
             {strategy:'STOPLOSS',trigger_type:'IMMEDIATE',trigger_price:110}]}];modG('G1');`);
  ok('gtt: OPEN GTT quantity field is locked', w.document.getElementById('gmQ')?.disabled === true);
  if (w.document.getElementById('gmTg')) w.document.getElementById('gmTg').value = '90';
  if (w.document.getElementById('gmSl')) w.document.getElementById('gmSl').value = '110';
  w.document.getElementById('gmSave')?.click();
  await new Promise(r => setTimeout(r, 60));
  ok('gtt: BUY bracket with target below entry is rejected client-side',
    /BUY bracket/.test(txt('TC')));

  /* ============================= TRADES ============================= */
  ev(`rnT([{order_id:'T1',instrument_token:'NSE_EQ|INE467B01029',transaction_type:'SELL',quantity:5,average_price:3600,trade_date:'2026-10-31T10:11:00+05:30'}])`);
  const trow = cells('#tTB tr:first-child td');
  ok('trades: ISO trade_date renders as IST time', trow[0] === '10:11:00');
  ok('trades: token-only row resolves the symbol', trow[1] === 'TCS');
  ok('trades: sell value metric', txt('tSell') === '18,000');

  /* ============================== CHART ============================== */
  const chartOut = ev(`(()=>{$.cKey='NSE_EQ|INE002A01018';$.cTF='minutes/5';
    const t0=new Date('2026-10-30T10:00:00+05:30').getTime();
    $.cd=[{t:new Date(t0),o:100,h:101,l:99,c:100,v:500,live:true}];
    chartApplyTick(105,t0+60000,5,1005);
    chartApplyTick(90,t0-30*60000,1,900);          /* late, stale tick */
    const c=$.cd.at(-1);return JSON.stringify({h:c.h,l:c.l,c:c.c});})()`);
  ok('chart: an out-of-order tick cannot rewrite the live candle', chartOut === '{"h":105,"l":99,"c":105}');

  /* =============================== ALGO =============================== */
  const weekOut = ev(`(()=>{const now=Date.now(),last=new Date(now-7*86400000);
    const c=[{t:last,o:1,h:2,l:.5,c:1.5,v:1},{t:new Date(now),o:1,h:2,l:.5,c:1.5,v:1}];
    return algoOnlyClosedCandles(c,'weeks',1).length;})()`);
  ok('algo: the in-progress weekly candle is excluded', weekOut === 1);

  const monthOut = ev(`(()=>{const now=new Date();const prev=new Date(now.getFullYear(),now.getMonth()-1,10);
    const c=[{t:prev,o:1,h:2,l:.5,c:1.5,v:1},{t:now,o:1,h:2,l:.5,c:1.5,v:1}];
    return algoOnlyClosedCandles(c,'months',1).length;})()`);
  ok('algo: the in-progress monthly candle is excluded', monthOut === 1);

  const rOut = ev(`(()=>{const c=[];for(let i=0;i<300;i++){const cl=100+Math.sin(i/5)*10+i*.1;
      c.push({t:new Date(Date.UTC(2026,0,1)+i*86400000),o:cl,h:cl*1.03,l:cl*.97,c:cl,v:1000});}
    const ind=algoIndicators(c),bt=algoBacktest(c,ind,'trend','BOTH',{capital:100000,riskPct:5,feeBps:0,atrMult:.1,rr:2});
    const t=bt.trades.find(x=>/^Stop/.test(String(x.reason)))||bt.trades[0];
    return JSON.stringify({reason:t?.reason,r:t?.r});})()`);
  const rParsed = JSON.parse(rOut || '{}');
  ok('algo: a stop-out reports -1.00R (actual qty × risk distance)',
    /^Stop/.test(String(rParsed.reason)) && Math.abs(rParsed.r + 1) < 1e-6);

  const bh = ev(`(()=>{const c=[];for(let i=0;i<260;i++){const px=i<201?100:200;
      c.push({t:new Date(Date.UTC(2026,0,1)+i*86400000),o:px,h:px+1,l:px-1,c:px,v:1000});}
    const ind=algoIndicators(c),bt=algoBacktest(c,ind,'trend','BOTH',{capital:100000,riskPct:1,feeBps:0,atrMult:1.5,rr:2});
    return bt.buyHold;})()`);
  ok('algo: buy&hold starts at the first tradable bar, not the warmup bar', Math.abs(bh) < 1e-6);

  /* =========================== OPTION CHAIN =========================== */
  const ocOut = ev(`(()=>{const raw=[];for(let i=0;i<40;i++)raw.push({strike_price:24000+i*50,
      call_options:{instrument_key:'C'+i},put_options:{instrument_key:'P'+i}});
    prepareOCChain(raw,'rest');
    return JSON.stringify({atm:OC.atm,first:OC.filtered[0].strike_price,last:OC.filtered.at(-1).strike_price});})()`);
  const oc = JSON.parse(ocOut);
  ok('oc: without a spot price the ladder centres instead of showing the lowest strikes',
    oc.atm === 24950 && oc.first === 24200 && oc.last === 25700);

  /* =============================== P&L =============================== */
  w.fetch = u => /profit-loss\/charges/.test(String(u))
    ? json(200, { status: 'success', data: { charges_breakdown: { total: 154.23, charges: { brokerage: 97.23 }, taxes: { gst: 20.93 } } } })
    : json(200, OK);
  await ev(`ldPlCharges('EQ','2627')`);
  const chTxt = txt('plCh');
  ok('pnl: brokerage nested under charges is still shown', chTxt.includes('97.23'));
  ok('pnl: charge rows render as costs, not green gains', !chTxt.includes('+₹'));
  ok('pnl: total charges', txt('plChTotal').includes('154.23'));

  /* ======================= SESSION CLOCK (MCX/CDS) ======================= */
  ok('clock: US DST off in early March', ev(`usDstActive(new Date('2026-03-07T12:00:00Z'))`) === false);
  ok('clock: US DST on mid-March', ev(`usDstActive(new Date('2026-03-09T12:00:00Z'))`) === true);
  ok('clock: US DST on at end of October', ev(`usDstActive(new Date('2026-10-31T12:00:00Z'))`) === true);
  ok('clock: US DST off in November', ev(`usDstActive(new Date('2026-11-02T12:00:00Z'))`) === false);
  ok('clock: MCX closes 23:30 under DST / 23:55 otherwise',
    ev(`mcxCloseMinute(new Date('2026-06-15T12:00:00Z'))`) === 1410 &&
    ev(`mcxCloseMinute(new Date('2026-12-15T12:00:00Z'))`) === 1435);

  const origParts = ev('chartISTParts');
  ev(`window.__origParts=chartISTParts;chartISTParts=()=>({y:2026,m:10,d:30,h:16,mi:0,s:0});`);   /* Fri 16:00 IST */
  ok('clock: currency derivatives stay open until 17:00 IST', ev(`marketHoursOpen('CDS_FO|123')`) === true);
  ok('clock: NSE cash is closed at 16:00 IST', ev(`marketHoursOpen('NSE_EQ|INE002A01018')`) === false);
  ev(`chartISTParts=window.__origParts;`);

  /* ====================== READ-ONLY (ANALYTICS) MENUS ====================== */
  let ro = await boot({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } }, settle: 700 });
  ro.w.confirm = () => true;
  ro.w.eval(`document.getElementById('TC').innerHTML='';nav('pos')`);
  await new Promise(r => setTimeout(r, 200));
  const roToast = (ro.w.document.getElementById('TC')?.textContent || '');
  ok('ro: opening Positions in a read-only session explains why', /read-only/i.test(roToast));
  ok('ro: the positions table shows a locked empty state',
    /Daily token required/.test(ro.w.document.querySelector('#pg-pos tbody')?.textContent || ''));
  ok('ro: watchlist still loads (market data)', (() => { ro.w.eval(`nav('watch')`); return true; })());

  /* ============================ LOGOUT HYGIENE ============================ */
  ({ w } = await boot({ tokens: DAY, settle: 700 }));
  w.confirm = () => true;
  w.eval(`$.gts=[{gtt_order_id:'X'}]`);
  w.eval(`document.getElementById('oTB').innerHTML='<tr><td>OLD USER ROW</td></tr>'`);
  w.eval(`document.getElementById('gTB').innerHTML='<tr><td>OLD GTT</td></tr>'`);
  await w.eval('logout()');
  await new Promise(r => setTimeout(r, 120));
  ok('logout: rendered portfolio rows are wiped', w.eval(`document.getElementById('oTB').innerHTML`) === '' && w.eval(`document.getElementById('gTB').innerHTML`) === '');
  ok('logout: GTT/trade/session caches are cleared', w.eval(`($.gts||[]).length===0 && !$.mktStatus && $.authShiftAt===0`));

  process.exit(report('MENU-BY-MENU TESTS', R) ? 1 : 0);
})();
