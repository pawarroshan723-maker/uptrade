/* Deep-dive batch 3 regression suite (2026-10-31).
 * Covers the second hunt: login with both tokens, dashboard market-pulse
 * percentages, dashboard risk score from real numbers, cache invalidation on
 * mutations, exit-all being a mutation, IST-only market timestamps, and the
 * '?'-symbol fallback on Positions/Holdings.
 * Every check targets a defect that existed before this patch.
 */
const { boot, okpush, report } = require('./helpers');

const OK = { status: 'success', data: [] };
const day = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };

(async () => {
  const R = []; const ok = okpush(R);
  let { w } = await boot({ tokens: day, settle: 700 });
  const ev = s => { try { return w.eval(s); } catch (e) { return '__THROW__'; } };
  const txt = id => (w.document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
  w.confirm = () => true;
  w.prompt = (m, d) => d;

  /* ===================== LOGIN: BOTH TOKENS ===================== */
  ev(`(()=>{const t=document.getElementById('aT'),a=document.getElementById('aN');
     t.value='DAYTOK-NEW-1234567890abcdef';a.value='ANALYTICS-TOKEN-1234567890abcdef';aTok();})()`);
  await new Promise(r => setTimeout(r, 260));
  ok('login: pasting daily + analytics keeps the analytics token',
    ev(`$.atok`) === 'ANALYTICS-TOKEN-1234567890abcdef' &&
    w.localStorage.getItem('u_atok') === 'ANALYTICS-TOKEN-1234567890abcdef');
  ok('login: daily token is active (not read-only)', ev(`$.tok==='DAYTOK-NEW-1234567890abcdef' && $.ro===false`));

  ev(`(()=>{$.tok='DAYTOK-LIVE-1234567890abcdef';const a=document.getElementById('aN');a.value='ANALYTICS-KEEP-1234567890abcdef';aTok();})()`);
  await new Promise(r => setTimeout(r, 220));
  ok('login: pasting the analytics token keeps a live daily session (B4)',
    ev(`$.tok==='DAYTOK-LIVE-1234567890abcdef' && $.ro===false && $.atok==='ANALYTICS-KEEP-1234567890abcdef'`));

  ev(`(()=>{$.tok='';const a=document.getElementById('aN');a.value='ANALYTICS-ONLY-1234567890abcdef';aTok();})()`);
  await new Promise(r => setTimeout(r, 200));
  ok('login: analytics-only (no daily token) is a read-only session',
    ev(`$.tok==='' && $.ro===true && $.atok==='ANALYTICS-ONLY-1234567890abcdef'`));

  ev(`(()=>{$.atok='';const a=document.getElementById('aN');a.value='short';aTok();})()`);
  await new Promise(r => setTimeout(r, 120));
  ok('login: a short analytics token is rejected', ev(`$.atok===''`));

  /* rebuild a daily session for the rest of the run */
  ev(`(()=>{$.tok='DAYTOK-1234567890abcdef';$.ro=false;$.atok='';})()`);

  /* ================= DASHBOARD: MARKET PULSE % ================== */
  ev(`$.proMarkets={};proUpdateMarket('NSE_INDEX|Nifty 50',24500,24300);`);
  const firstCard = txt('pmNiftyC');
  ev(`proUpdateMarket('NSE_INDEX|Nifty 50',24600,undefined);`);
  const secondCard = txt('pmNiftyC');
  ok('dashboard: a tick without prev-close keeps the known percentage',
    /\+0\.82%/.test(firstCard) && /\+0\.82%/.test(secondCard) && /\+200\.00/.test(firstCard));
  ok('dashboard: the absolute change stays consistent with the new LTP',
    /\+200\.8\d/.test(secondCard) || /\+200\.9\d/.test(secondCard) || /\+200\.7\d/.test(secondCard));
  ev(`$.proMarkets={};proUpdateMarket('BSE_INDEX|SENSEX',80000,0);`);
  ok('dashboard: cp=0 renders "—" instead of a fake 0.00%', /—/.test(txt('pmSensexC')));

  /* ============== DASHBOARD: RISK SCORE FROM NUMBERS ============ */
  ev(`(()=>{document.getElementById('dU').textContent='₹90,000.00';
      document.getElementById('dM').textContent='₹10,000.00';
      $.dashFunds={used:0,avail:100000};$.pos=[];$.hld=[];
      renderProDashboard(true);})()`);
  ok('dashboard: risk score uses ldD numeric funds, not ₹ text scraping',
    txt('dRiskState') === 'LOW');

  /* ================== CACHE INVALIDATION ======================= */
  ev(`PRO_HUB.cache.set('GET|/v2/portfolio/long-term-holdings',{at:Date.now(),data:{probe:1}});`);
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(OK)) });
  await ev(`upstoxFetch(END.ORDER_PLACE,{method:'POST',body:{}}).then(()=>1).catch(()=>0)`);
  ok('cache: a successful order POST clears cached GETs', ev(`PRO_HUB.cache.size`) === 0);

  ev(`PRO_HUB.cache.set('GET|/v3/user/get-funds-and-margin',{at:Date.now(),data:{probe:2}});`);
  await ev(`upstoxFetch(END.MARGIN,{method:'POST',_readonly:true,body:{}}).then(()=>1).catch(()=>0)`);
  ok('cache: a read-only POST (margin) keeps the GET cache', ev(`PRO_HUB.cache.size`) === 1);

  /* ==================== EXIT-ALL IS A MUTATION ================= */
  ev(`$.pos=[{trading_symbol:'TCS',instrument_key:'NSE_EQ|INE467B01029',quantity:5,product:'I'}];
      PRO_HUB.cache.set('GET|/v2/portfolio/short-term-positions',{at:Date.now(),data:{probe:3}});
      $.tok='DAYTOK-1234567890abcdef';`);
  await ev(`exitAllMine(true).then(()=>1).catch(()=>0)`);
  ok('exit-all: square-off clears the cached positions', ev(`PRO_HUB.cache.size`) === 0);

  /* ============ IST-ONLY MARKET TIMESTAMPS (chart/algo) ========= */
  ok('chart: intraday axis labels 03:45Z as 09:15 IST', ev(`(()=>{$.cTF='minutes/5';return chartAxisLabel(Date.UTC(2026,9,30,3,45));})()`) === '09:15');
  const cross = ev(`(()=>{$.cTF='minutes/5';return chartFormatCrossTime(Date.UTC(2026,9,30,3,45));})()`);
  ok('chart: crosshair stamps the IST day, not the UTC day', /30 Oct/.test(cross) && /09:15/.test(cross));
  ok('algo: a 20:00Z timestamp reports the IST trading day',
    ev(`algoDate('2026-10-30T20:00:00Z')`) === '31 Oct 26');
  ok('algo: invalid dates print a dash', ev(`algoDate('nope')`) === '-');

  /* ================= SYMBOL FALLBACK (pos/hold) ================= */
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'success',
    data: [{ instrument_token: 'NSE_EQ|INEZBOGUS001', quantity: 5, average_price: 100, last_price: 110, pnl: 50, product: 'D' }] })) });
  ev('ldP()');
  await new Promise(r => setTimeout(r, 160));
  ok('positions: a row without trading_symbol shows the scrip, not "?"',
    /INEZBOGUS001/.test(w.document.getElementById('pTB').textContent) &&
    !/\?/.test(w.document.getElementById('pTB').textContent));
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'success',
    data: [{ instrument_token: 'NSE_EQ|INEZBOGUS002', quantity: 2, average_price: 100, last_price: 110, close_price: 110 }] })) });
  ev('ldH()');
  await new Promise(r => setTimeout(r, 160));
  const holdTxt = w.document.getElementById('hTB').textContent;
  ok('holdings: a row without trading_symbol shows the scrip, not "?"',
    /INEZBOGUS002/.test(holdTxt) && !/\?/.test(holdTxt));

  process.exit(report('DEEP-DIVE BATCH 3 TESTS', R) ? 1 : 0);
})();
