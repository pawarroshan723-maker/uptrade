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

  w.eval(`window.istClock=()=>new Date(2026,2,10,23,40,0)`);      // 23:40 IST, 10 Mar
  const phaseAt2340 = w.eval(`marketPhase('COMM')`);
  w.eval(`window.istClock=()=>new Date(2026,2,10,23,20,0)`);      // 23:20 IST, 10 Mar
  const phaseAt2320 = w.eval(`marketPhase('COMM')`);
  w.eval(`window.istClock=()=>new Date(2026,2,10,23,40,0)`);
  ok('MCX: marketPhase uses the same close (23:40 closed, 23:20 open)', phaseAt2340 === 'closed' && phaseAt2320 === 'open');
  w.eval(`delete window.istClock`);                                // fall back to the real helper

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

  process.exit(report('deepdive', R) ? 1 : 0);
})();
