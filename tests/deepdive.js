/* Regression suite for the 2026-10-28 deep dive (see REVIEW.md §Round 2).
 * One block per finding; every assertion below fails on the pre-fix file.
 */
const { boot, okpush, report } = require('./helpers');

const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
const OKBODY = { status: 'success', data: [] };

(async () => {
  const R = []; const ok = okpush(R);
  const { w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 600 });
  const stubFetch = fn => { w.fetch = fn; };
  const DAY = 'DAYTOK-1234567890abcdef';

  /* ---- B5: the 15 s abort budget must cover the BODY read ---- */
  const realST = w.setTimeout;
  w.setTimeout = (fn, ms, ...a) => realST(fn, Math.min(Number(ms) || 0, 30), ...a);
  stubFetch((u, o) => Promise.resolve({
    ok: true, status: 200,
    text: () => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); })
  }));
  const t0 = Date.now();
  const raced = await Promise.race([
    w.eval(`upstoxFetch({path:'/v2/user/profile'},{_force:true})`).then(() => ({ ok: true })).catch(e => ({ err: e })),
    new Promise(r => setTimeout(() => r({ hung: true }), 2500)),
  ]);
  ok('B5: a stalled response body rejects instead of hanging forever',
    !raced.hung && raced.err && /Timeout after 15s/.test(raced.err.message) && Date.now() - t0 < 2500);
  ok('B5: the request hub releases its slot after a body stall', w.eval('PRO_HUB.active') === 0);
  stubFetch(() => Promise.resolve({ ok: true, status: 200, text: () => new Promise(r => setTimeout(() => r(JSON.stringify({ status: 'success', data: { ok: 1 } })), 8)) }));
  const slow = await w.eval(`upstoxFetch({path:'/v2/user/profile'},{_force:true})`);
  ok('B5: a slow but healthy body still resolves', slow && slow.data && slow.data.ok === 1);
  w.setTimeout = realST;

  /* ---- read-only Analytics sessions must use the 5 s quote cache too ---- */
  w.eval(`$.tok='';$.atok='ANALYTICS-1234567890abcdef';PRO_HUB.cache.clear();window.__n=0`);
  stubFetch(() => { w.eval('window.__n++'); return json(200, { status: 'success', data: [{ last_price: 1 }] }); });
  await w.eval(`upstoxFetch({path:'/v2/market-quote/quotes'},{query:'?instrument_key=A'})`);
  await w.eval(`upstoxFetch({path:'/v2/market-quote/quotes'},{query:'?instrument_key=A'})`);
  ok('CACHE: analytics-only sessions are cached (2 identical calls -> 1 request)', w.eval('window.__n') === 1);

  /* ---- B3: a new token must never be served the old token's cache ---- */
  stubFetch(() => json(200, { status: 'success', data: [{ last_price: 2 }] }));
  await w.eval(`upstoxFetch({path:'/v2/market-quote/quotes'},{query:'?instrument_key=B'})`);
  const cachedBefore = w.eval('PRO_HUB.cache.size');
  w.eval(`$.tok='${DAY}';document.getElementById('aT').value='FRESHTOKEN-1234567890abcdef'`);
  w.eval('aTok()');
  ok('B3: pasting a new daily token purges payloads cached under the old one', cachedBefore > 0 && w.eval('PRO_HUB.cache.size') === 0);

  /* ---- B3: a fresh daily token must not drop the staged fallback ---- */
  w.eval(`$.tok='';$.atok='ANALYTICS-KEEP-1234567890';$.ro=true;document.getElementById('aT').value='NEWDAYTOKEN-1234567890abc';document.getElementById('aN').value=''`);
  w.eval('aTok()');
  ok('B3: a fresh daily token keeps the staged analytics fallback',
    w.eval('$.atok') === 'ANALYTICS-KEEP-1234567890' && w.eval('$.tok') === 'NEWDAYTOKEN-1234567890abc' && w.eval('$.ro') === false);

  /* ---- B3: submitting both fields stages both (used to silently drop one) ---- */
  w.eval(`$.tok='';$.atok='';$.ro=false;document.getElementById('aT').value='BOTHDAYTOKEN-1234567890abc';document.getElementById('aN').value='BOTHANALYTICS-1234567890abc'`);
  w.eval('aTok()');
  ok('B3: submitting both token fields stages the fallback too',
    w.eval('$.tok') === 'BOTHDAYTOKEN-1234567890abc' && w.eval('$.atok') === 'BOTHANALYTICS-1234567890abc');

  /* ---- B3: pasting the Analytics token must not drop a live daily session ---- */
  w.eval(`$.tok='${DAY}';$.atok='';$.ro=false;document.getElementById('aN').value='ANALYTICS-1234567890abcdef';document.getElementById('aT').value=''`);
  w.eval('aTok()');
  ok('B3: analytics paste keeps the active daily trading session', w.eval('$.tok') === DAY && w.eval('$.ro') === false);
  ok('B3: analytics token was still staged as the fallback', w.eval('$.atok') === 'ANALYTICS-1234567890abcdef' && w.eval(`localStorage.getItem('u_atok')`) === 'ANALYTICS-1234567890abcdef');

  /* ---- B3: analytics paste from the LOGIN screen must start a read-only session ---- */
  w.eval(`$.tok='STALE-DAY-TOKEN-1234567890';$.atok='';$.ro=false;$.initBusy=false;document.getElementById('AP').classList.remove('on');document.getElementById('aN').value='LOGINSCREEN-ANALYTICS-123456';document.getElementById('aT').value=''`);
  w.eval('aTok()');
  ok('B3: analytics paste from the login screen drops the stale daily token',
    w.eval('$.tok') === '' && w.eval('$.ro') === true && w.eval('$.atok') === 'LOGINSCREEN-ANALYTICS-123456');
  await new Promise(r => setTimeout(r, 250));

  /* ---- L1: MCX close follows the real US DST window ---- */
  const close = iso => w.eval(`typeof mcxCloseMinute==='function'?mcxCloseMinute(Date.parse('${iso}')):null`);
  ok('MCX: 23:30 close while US DST is on (March after 2nd Sunday)', close('2026-03-10T18:00:00Z') === 1410);
  ok('MCX: 23:55 close before US DST starts (early March)', close('2026-03-05T18:00:00Z') === 1435);
  ok('MCX: 23:55 close after US DST ends (November)', close('2026-11-05T18:00:00Z') === 1435);
  ok('MCX: October is still on US DST', close('2026-10-30T18:00:00Z') === 1410);
  /* the feed gate must agree with the order gate (same helper) */
  const openAt = iso => { w.eval(`window.__dn=Date.now;Date.now=()=>Date.parse('${iso}')`); const r = w.eval(`marketHoursOpen('MCX_FO|1')`); w.eval(`Date.now=window.__dn`); return r; };
  ok('MCX: the feed gate closes after 23:30 IST during US DST (10 Mar 23:50)', openAt('2026-03-10T18:20:00Z') === false);
  ok('MCX: the feed gate keeps early March open to 23:55 IST (5 Mar 23:50)', openAt('2026-03-05T18:20:00Z') === true);

  w.eval(`window.__istReal=window.istClock`);                     // restore point: a global
  w.eval(`window.istClock=()=>new Date(2026,2,10,23,40,0)`);      // function declaration is not deletable
  const phaseAt2340 = w.eval(`marketPhase('COMM')`);
  w.eval(`window.istClock=()=>new Date(2026,2,10,23,20,0)`);      // 23:20 IST, 10 Mar
  const phaseAt2320 = w.eval(`marketPhase('COMM')`);
  w.eval(`window.istClock=()=>new Date(2026,2,10,23,40,0)`);
  ok('MCX: marketPhase uses the same close (23:40 closed, 23:20 open)', phaseAt2340 === 'closed' && phaseAt2320 === 'open');
  w.eval(`window.istClock=window.__istReal`);                      // do NOT leak a frozen clock into later tests

  /* ---- A1: buy & hold must start at the first tradeable bar ---- */
  const bh = w.eval(`(()=>{const n=120,c=[];for(let i=0;i<n;i++)c.push({t:new Date(Date.now()-(n-i)*86400000),o:100+i,h:100+i+1,l:100+i-1,c:100+i,v:1000});const ind=algoIndicators(c),r=algoBacktest(c,ind,'mean','BOTH',{capital:100000,riskPct:1,feeBps:5,atrMult:1.5,rr:2});return {got:r.buyHold,newBasis:(c.at(-1).c/c[r.warmup+1].o-1)*100,oldBasis:(c.at(-1).c/c[r.warmup].o-1)*100}})()`);
  ok('ALGO A1: buy & hold enters at warmup+1, not warmup', Math.abs(bh.got - bh.newBasis) < 1e-9 && Math.abs(bh.got - bh.oldBasis) > 1e-6);

  /* ---- A2: weekly / monthly candles must drop the forming period ---- */
  const wk = w.eval(`(()=>{const now=Date.now();const cs=[{t:new Date(now-40*86400000)},{t:new Date(now-3*86400000)},{t:new Date(now)}];return algoOnlyClosedCandles(cs,'weeks',1).length})()`);
  const mo = w.eval(`(()=>{const now=Date.now();const cs=[{t:new Date(now-80*86400000)},{t:new Date(now-40*86400000)},{t:new Date(now)}];return algoOnlyClosedCandles(cs,'months',1).length})()`);
  ok('ALGO A2: the forming weekly/monthly bar is excluded', wk === 2 && mo === 2);

  /* ---- L6: an out-of-order tick must not corrupt the newest candle ---- */
  w.eval(`$.cTF='minutes/5';$.cd=[{t:new Date(Date.now()-300000),o:100,h:101,l:99,c:100,v:1,live:true}]`);
  const beforeTick = w.eval(`JSON.stringify($.cd.at(-1))`);
  w.eval(`chartApplyTick(50, Date.now()-30*60000)`);
  ok('CHART L6: a tick from an earlier bucket is ignored', w.eval(`JSON.stringify($.cd.at(-1))`) === beforeTick);
  w.eval(`chartApplyTick(102, Date.now())`);
  ok('CHART L6: a current tick is still applied', w.eval(`$.cd.at(-1).h`) === 102);

  /* ---- L8: OC window centres on the median strike when spot is absent ---- */
  const raw = []; for (let s = 100; s <= 2000; s += 100) raw.push({ strike_price: s, call_options: { instrument_key: `NSE_FO|C${s}` }, put_options: { instrument_key: `NSE_FO|P${s}` } });
  const prep = w.eval(`(()=>{document.getElementById('ocStrikeCnt').value='5';const st=prepareOCChain(${JSON.stringify(raw)},'full');return {atm:OC.atm,spot:OC.spot,filtered:OC.filtered.map(r=>r.strike_price)}})()`);
  ok('OC L8: no spot -> window centres on the median strike (not the lowest)', prep.atm === 1000 && prep.spot === 0 && prep.filtered.includes(1000) && !prep.filtered.includes(100));
  const prep2 = w.eval(`(()=>{const r=${JSON.stringify(raw)};r.forEach(x=>x.underlying_spot_price=610);const st=prepareOCChain(r,'full');return {atm:OC.atm,spot:OC.spot}})()`);
  ok('OC L8: a real spot still wins (regression guard)', prep2.atm === 600 && prep2.spot === 610);

  /* ---- L4: a stale P&L response must not repaint a newer selection ---- */
  w.eval(`$.tok='${DAY}';$.authShiftAt=0;buildFinancialYears();document.getElementById('plS').value='EQ'`);
  ok('PNL L4: financial-year picker is populated', w.eval(`document.getElementById('plY').value`) !== '');
  stubFetch((u) => {
    const url = String(u);
    if (/profit-loss\/metadata/.test(url) && /segment=EQ/.test(url))
      return new Promise(r => setTimeout(() => r({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'success', data: { trades_count: 3, page_size_limit: 100 } })) }), 160));
    if (/profit-loss\/metadata/.test(url))
      return json(200, { status: 'success', data: { trades_count: 0 } });
    if (/profit-loss\/data/.test(url))
      return json(200, { status: 'success', data: [{ scrip_name: 'STALE-SEGMENT-ROW', buy_amount: 1, sell_amount: 2, quantity: 1 }] });
    return json(200, OKBODY);
  });
  w.eval('ldPl()');                                   // slow EQ request
  w.eval(`document.getElementById('plS').value='FO'`);
  w.eval('ldPl()');                                   // fast FO request wins
  await new Promise(r => setTimeout(r, 400));
  const plText = w.eval(`document.getElementById('plB').textContent`);
  ok('PNL L4: the newer segment result is the one on screen', /No realised trades/.test(plText) && !/STALE-SEGMENT-ROW/.test(plText));

  /* ---- B12: GTT modify sends a whitelisted rule payload ---- */
  w.eval(`$.tok='${DAY}';$.authShiftAt=0;window.__puts=[]`);
  w.eval(`$.gts=[{gtt_order_id:'G1',type:'MULTIPLE',quantity:10,transaction_type:'BUY',instrument_token:'NSE_EQ|INE002A01018',trading_symbol:'RELIANCE',rules:[
    {strategy:'ENTRY',trigger_type:'ABOVE',trigger_price:100,status:'active',order_id:'ord-1',failure_reason:null,created_at:'x'},
    {strategy:'TARGET',trigger_type:'IMMEDIATE',trigger_price:120,status:'active',order_id:'ord-2'},
    {strategy:'STOPLOSS',trigger_type:'IMMEDIATE',trigger_price:90,status:'active',order_id:'ord-3'}]}]`);
  const gttRow = { gtt_order_id: 'G1', type: 'MULTIPLE', quantity: 10, transaction_type: 'BUY', instrument_token: 'NSE_EQ|INE002A01018', trading_symbol: 'RELIANCE', rules: [
    { strategy: 'ENTRY', trigger_type: 'ABOVE', trigger_price: 100, status: 'active' },
    { strategy: 'TARGET', trigger_type: 'IMMEDIATE', trigger_price: 120, status: 'active' },
    { strategy: 'STOPLOSS', trigger_type: 'IMMEDIATE', trigger_price: 90, status: 'active' }] };
  stubFetch((u, o) => {
    if (o && o.method === 'PUT') w.__puts.push(JSON.parse(o.body));
    if (/order\/gtt$/i.test(String(u))) return json(200, { status: 'success', data: [gttRow] });
    return json(200, { status: 'success', data: { gtt_order_id: 'G1' } });
  });
  w.eval(`modG('G1')`);
  w.eval(`document.getElementById('gmTr').value='2999.99';document.getElementById('gmTg').value='3100';document.getElementById('gmSl').value='2900'`);
  w.eval(`document.getElementById('gmSave').click()`);
  await new Promise(r => setTimeout(r, 150));
  const putBody = w.eval(`window.__puts[0]||null`);
  ok('GTT B12: modify sends exactly the 3 legs', !!putBody && putBody.rules.length === 3);
  const ruleKeys = putBody ? putBody.rules.map(r => Object.keys(r).sort().join(',')) : [];
  ok('GTT B12: response-only fields (status/order_id/failure_reason) are not echoed back',
    ruleKeys.length === 3 && ruleKeys.every(k => !/status|order_id|failure_reason|created_at/.test(k)));
  ok('GTT B12: a 1-paise equity price passes the tick check (master tick, not 0.05)', !!putBody && putBody.rules[0].trigger_price === 2999.99);
  ok('GTT B12: quantity and gtt id still travel', !!putBody && putBody.quantity === 10 && putBody.gtt_order_id === 'G1');

  w.eval(`window.__puts=[]`);
  w.eval(`$.gts=[${JSON.stringify(gttRow)}]`);
  w.eval(`modG('G1')`);
  w.eval(`document.getElementById('gmTr').value='100';document.getElementById('gmTg').value='50';document.getElementById('gmSl').value='90'`);
  w.eval(`document.getElementById('gmSave').click()`);
  await new Promise(r => setTimeout(r, 100));
  ok('GTT B12: an inverted BUY bracket is refused client-side', w.eval('window.__puts.length') === 0);
  w.eval(`utModalClose()`);

  /* ---- B6: init must not treat an instrument "expired" error as a dead token ---- */
  w.eval(`$.tok='${DAY}';$.atok='';$.ro=false;$.initBusy=false;window.__rpd=renderProDashboard;renderProDashboard=()=>{throw new Error('The contract has expired')}`);
  stubFetch(() => json(200, OKBODY));
  await w.eval('init()');
  ok('INIT B6: an instrument-level "expired" message does not wipe a healthy token', w.eval('$.tok') === DAY);
  w.eval(`renderProDashboard=window.__rpd;$.initBusy=false`);

  /* ---- B4: logout must leave no prior-session data behind ---- */
  w.eval(`$.tok='${DAY}';$.gts=[{gtt_order_id:'G1'}];window._ksStates={NSE_FO:true};$.authShiftAt=42;$.inspectorQuote={k:'X'};$.proMarkets={X:{}};document.getElementById('oTB').innerHTML='<tr><td>OLD-ORDER</td></tr>'`);
  w.eval(`utModal('x','y')`);
  const modalOpen = w.eval(`!!document.getElementById('utModalOv')`);
  w.eval('logout()');
  const after = w.eval(`({gts:($.gts||[]).length,ks:Object.keys(window._ksStates||{}).length,shift:$.authShiftAt,ro:$.ro,inspector:$.inspectorQuote,markets:Object.keys($.proMarkets||{}).length,orderTable:document.getElementById('oTB').innerHTML,modal:!!document.getElementById('utModalOv')})`);
  ok('LOGOUT B4: GTT list and kill-switch state are cleared', after.gts === 0 && after.ks === 0);
  ok('LOGOUT B4: auth-shift de-dupe window and read-only flag are reset', after.shift === 0 && after.ro === false);
  ok('LOGOUT B4: inspector / market strip state is cleared', after.inspector === null && after.markets === 0);
  ok('LOGOUT B4: the previous session\'s order table is emptied', modalOpen === true && after.orderTable === '' && after.modal === false);
  ok('LOGOUT B4: option-chain state is reset so the next login auto-loads', w.eval(`($.tok===''&&OC.underKey===''&&(OC.chain||[]).length===0&&(OC.keys||[]).length===0)`));


  /* ================= Round 3 (2026-10-28, second sweep) ================= */

  /* ---- R3-1: new daily/weekly/monthly bars must land on the broker's
     period start (IST midnight / Monday / the 1st), not the 09:15 open — a
     session-open bucket created a duplicate bar for the same period. ---- */
  const buckets = w.eval(`(()=>{try{const t=Date.parse('2026-10-28T05:00:00Z');/* 10:30 IST, Wed */
    return [new Date(chartBucketStart(t,{unit:'days',iv:1},null)).toISOString(),
            new Date(chartBucketStart(t,{unit:'weeks',iv:1},null)).toISOString(),
            new Date(chartBucketStart(t,{unit:'months',iv:1},null)).toISOString()];}catch(e){return [String(e.message),'',''];}})()`);
  ok('CHART R3-1: a new daily bar lands on IST midnight (broker stamp)', buckets[0] === '2026-10-27T18:30:00.000Z');
  ok('CHART R3-1: a new weekly bar lands on Monday 00:00 IST', buckets[1] === '2026-10-25T18:30:00.000Z');
  ok('CHART R3-1: a new monthly bar lands on the 1st 00:00 IST', buckets[2] === '2026-09-30T18:30:00.000Z');
  /* the same-period fold must still work: a tick inside today's bar keeps its timestamp */
  const folded = w.eval(`(()=>{const last={t:new Date('2026-10-27T18:30:00Z')};return new Date(chartBucketStart(Date.parse('2026-10-28T05:00:00Z'),{unit:'days',iv:1},last)).toISOString();})()`);
  ok('CHART R3-1: a tick inside the current daily bar folds into it', folded === '2026-10-27T18:30:00.000Z');

  /* ---- R3-2: the daily look-ahead guard must use each segment's own close.
     A CDS (currency) session runs to 17:00 IST, so at 16:00 today's bar is
     still forming; for equity it closed at 15:30. ---- */
  const dayBars = `[{t:new Date('2026-10-26T18:30:00Z')},{t:new Date('2026-10-27T18:30:00Z')}]`;
  w.eval(`window.__dn2=Date.now;Date.now=()=>Date.parse('2026-10-28T10:30:00Z')`);   /* 16:00 IST, Wed */
  const cdsKept = w.eval(`algoOnlyClosedCandles(${dayBars},'days',1,undefined,{k:'NSE_CDS|USDINR26NOVFUT',segment:'NSE_CDS'}).length`);
  const eqKept  = w.eval(`algoOnlyClosedCandles(${dayBars},'days',1,undefined,{k:'NSE_EQ|INE002A01018',segment:'NSE_EQ'}).length`);
  const cdsClose = w.eval(`typeof algoSessionCloseMin==='function'?algoSessionCloseMin({k:'NSE_CDS|USDINR26NOVFUT',segment:'NSE_CDS'}):null`);
  const mcxClose = w.eval(`typeof algoSessionCloseMin==='function'?algoSessionCloseMin({k:'MCX_FO|CRUDEOIL',segment:'MCX_FO'}):null`);
  w.eval(`Date.now=window.__dn2`);
  ok('ALGO R3-2: a currency (CDS) daily bar is still forming at 16:00 IST — excluded', cdsKept === 1);
  ok('ALGO R3-2: an equity daily bar is final at 16:00 IST — kept', eqKept === 2);
  ok('ALGO R3-2: session close is per segment (CDS 17:01, MCX 23:31/23:56)', cdsClose === 1021 && (mcxClose === 1411 || mcxClose === 1436));

  /* ---- R3-3: a stale charges failure must not repaint the new selection ---- */
  w.eval(`$.tok='${DAY}';$.plSeq=0;document.getElementById('plCh').innerHTML=''`);
  w.eval(`document.getElementById('plY').innerHTML='<option value="2526">2025-26</option>';document.getElementById('plY').value='2526';document.getElementById('plS').value='NSE_EQ'`);
  stubFetch((u) => {
    const us = String(u);
    if (/profit-loss\/charges/.test(us) && /segment=NSE_EQ/.test(us))
      return new Promise((_, rej) => setTimeout(() => rej(new Error('stale-charges-failure')), 120));
    if (/profit-loss\/charges/.test(us)) return json(200, { status: 'success', data: { charges_breakdown: { total: 7 } } });
    if (/profit-loss\/metadata/.test(us)) return json(200, { status: 'success', data: { trades_count: 0 } });
    if (/profit-loss\/data/.test(us)) return json(200, { status: 'success', data: [] });
    return json(200, OKBODY);
  });
  w.eval('ldPl()');                                     /* ticket 1: NSE_EQ */
  await new Promise(r => setTimeout(r, 20));
  w.eval(`document.getElementById('plS').value='MCX';ldPl()`);   /* ticket 2: MCX */
  await new Promise(r => setTimeout(r, 400));
  const chargesTxt = w.eval(`document.getElementById('plCh').textContent`);
  const plSeqNow = w.eval(`$.plSeq`);
  ok('PL R3-3: a late charges error for the previous segment does not repaint the card',
    plSeqNow >= 2 && !/stale-charges-failure|Charges unavailable/.test(chargesTxt));

  /* ---- R3-4: the single-position Exit must respect the market clock ---- */
  stubFetch(() => json(200, { status: 'success', data: { order_ids: ['EXIT1'] } }));
  w.eval(`$.tok='${DAY}';$.pos=[{instrument_key:'NSE_EQ|INE002A01018',product:'D',quantity:10}];window.__cn=0`);
  w.confirm = () => { w.eval('window.__cn++'); return true; };
  /* `new Date()` ignores a Date.now override, so swap the whole Date
     constructor for the duration of each case. */
  const setClock = iso => {
    const Real = w.Date, fixed = Real.parse(iso);
    class FakeDate extends Real {
      constructor(...a) { a.length ? super(...a) : super(fixed); }
      static now() { return fixed; }
    }
    w.Date = FakeDate;
    return () => { w.Date = Real; };
  };
  const withClock = async (iso) => {
    let seen = null;
    stubFetch((u, o) => { if (String(u).includes('/order/place')) seen = JSON.parse(o.body || '{}'); return json(200, { status: 'success', data: { order_ids: ['EXIT1'] } }); });
    const restore = setClock(iso);
    try { await w.eval(`sqO('NSE_EQ|INE002A01018','D',10)`); } finally { restore(); }
    return seen;
  };
  const afterHours = await withClock('2026-10-28T14:30:00Z');   /* 20:00 IST */
  ok('ORDER R3-4: an after-hours single exit is queued as an AMO, not sent live', !!afterHours && afterHours.is_amo === true && afterHours.order_type === 'MARKET');
  const inSession = await withClock('2026-10-28T05:00:00Z');    /* 10:30 IST */
  ok('ORDER R3-4: an in-session single exit still goes out live', !!inSession && inSession.is_amo === false);
  w.confirm = () => false;
  const declined = await withClock('2026-10-28T14:30:00Z');
  ok('ORDER R3-4: declining the after-hours queue sends nothing', declined === null);
  w.confirm = () => true;
  const preApi = await withClock('2026-10-27T23:00:00Z');       /* 04:30 IST — API closed */
  ok('ORDER R3-4: the 00:00-05:30 API window blocks the exit outright', preApi === null);
  w.confirm = () => true;

  /* ---- R3-5: the 60 s pruner must keep the 5-minute news payloads ---- */
  const newsKey = 'GET|https://api.upstox.com/v3/news?category=instrument_keys';
  w.eval(`PRO_HUB.cache.clear();PRO_HUB.cache.set('${newsKey}',{at:Date.now()-120000,data:{ok:1}});
          PRO_HUB.cache.set('GET|https://api.upstox.com/v2/market-quote/ltp?instrument_key=X',{at:Date.now()-120000,data:{ok:1}});
          proCachePrune();`);
  ok('CACHE R3-5: a 2-minute-old news payload survives the 60 s prune (5-min TTL)', w.eval(`PRO_HUB.cache.has('${newsKey}')`));
  ok('CACHE R3-5: a 2-minute-old 5-second quote is still pruned', !w.eval(`PRO_HUB.cache.has('GET|https://api.upstox.com/v2/market-quote/ltp?instrument_key=X')`));

  process.exit(report('deepdive', R) ? 1 : 0);
})();
