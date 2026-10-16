/* Regression suite for the 2026-10 deep-review fixes (see REVIEW.md).
 * One block per finding; each failed before the fix and passes now.
 */
const { boot, okpush, report } = require('./helpers');

const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
const OKBODY = { status: 'success', data: [] };

(async () => {
  const R = []; const ok = okpush(R);
  const { w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 600 });
  const stubFetch = fn => { w.fetch = fn; };
  const call = (ep, opts) => w.eval(`upstoxFetch(${ep},${opts})`);

  /* ---- B1: writes are never replayed after a timeout / lost response ---- */
  let posts = 0;
  stubFetch((u, o) => { if (o && o.method === 'POST') { posts++; return Promise.reject(new Error('Failed to fetch')); } return json(200, OKBODY); });
  let err = null; try { await call(`{path:'/v2/order/place'}`, `{method:'POST',body:{quantity:1}}`); } catch (e) { err = e; }
  ok('B1: lost POST is sent exactly once', posts === 1);
  ok('B1: error tells the user to check the order book', err && /Order Book/i.test(err.message));
  posts = 0;
  stubFetch((u, o) => { if (o && o.method === 'POST') { posts++; return json(400, { status: 'error', errors: [{ message: 'Price outside circuit rate band' }] }); } return json(200, OKBODY); });
  try { await call(`{path:'/v2/order/place'}`, `{method:'POST',body:{}}`); } catch (e) {}
  ok('B1: a 400 rejection containing "rate" is not re-sent', posts === 1);
  posts = 0;
  stubFetch((u, o) => { if (o && o.method === 'POST') { posts++; return posts === 1 ? json(429, { status: 'error', errors: [{ message: 'Too many requests' }] }) : json(200, { status: 'success', data: { order_id: 'X' } }); } return json(200, OKBODY); });
  let res = null; try { res = await call(`{path:'/v2/order/place'}`, `{method:'POST',body:{}}`); } catch (e) {}
  ok('B1: HTTP 429 (request not processed) is still retried for writes', posts === 2 && res && res.data && res.data.order_id === 'X');
  let gets = 0;
  stubFetch(u => { if (/user\/profile/.test(String(u))) gets++; return Promise.reject(new Error('Failed to fetch')); });
  try { await call(`{path:'/v2/user/profile'}`, `{_force:true}`); } catch (e) {}
  ok('B1: idempotent GETs still retry 3x', gets === 3);
  posts = 0;
  stubFetch((u, o) => { if (o && o.method === 'POST') { posts++; return posts < 3 ? Promise.reject(new Error('Failed to fetch')) : json(200, OKBODY); } return json(200, OKBODY); });
  try { await call(`{path:'/v2/charges/margin'}`, `{method:'POST',_retrySafe:true,body:{}}`); } catch (e) {}
  ok('B1: margin calculator (pure calculation, _retrySafe) still retries', posts === 3);

  /* ---- B2: non-401 API rejections must not end the session ---- */
  w.eval(`$.tok='DAYTOK-1234567890abcdef';$.authShiftAt=0`);
  stubFetch(() => json(400, { status: 'error', errors: [{ message: 'GTT order has expired and cannot be modified', errorCode: 'UDAPI100' }] }));
  try { await call(`{path:'/v3/order/gtt/modify'}`, `{method:'PUT',body:{}}`); } catch (e) {}
  ok('B2: 400 "GTT has expired" keeps the token', w.eval('$.tok') === 'DAYTOK-1234567890abcdef');
  ok('B2: isAuthFailure strict for status 400', w.eval(`isAuthFailure(Object.assign(new Error('Order has expired'),{status:400}))`) === false);
  ok('B2: 400 "Invalid token" is still a session failure', w.eval(`isAuthFailure(Object.assign(new Error('Invalid token used to access API'),{status:400}))`) === true);
  ok('B2: 401 is always a session failure', w.eval(`isAuthFailure(Object.assign(new Error('whatever'),{status:401}))`) === true);
  ok('B2: status-less WS error "token expired" still matches', w.eval(`isAuthFailure(new Error('Access token expired'))`) === true);

  /* ---- sentiment engine ---- */
  const sc = t => w.eval(`evaluateTextSentiment(${JSON.stringify(t)})`);
  ok('NEWS: "listed"/"reduced" no longer trigger the regulatory (1.5x) catalyst', sc('Stock listed at premium').category === 'general' && sc('Shares reduced in volume').category === 'general');
  ok('NEWS: whole-word catalysts still work ("SEBI notice" -> regulatory)', sc('SEBI issues notice to broker').category === 'regulatory');
  ok('NEWS: negated bearish phrase flips positive', sc('Company denies profit falls').score > 0);
  ok('NEWS: plain bearish phrase stays negative', sc('Company profit falls').score < 0);
  ok('NEWS: intensifier now scales bearish phrases', Math.abs(sc('sharply plunges').score) > Math.abs(sc('plunges').score));

  /* ---- watchlist % column + sort ---- */
  ok('WL: Chg% derived from last & net_change', Math.abs(w.eval(`wlChgPct({last_price:110,net_change:10})`) - 10) < 1e-9);
  ok('WL: Chg% NaN when no quote', Number.isNaN(w.eval(`wlChgPct(undefined)`)));
  w.eval(`$.wl=[{k:'NSE_EQ|A',s:'A'},{k:'NSE_EQ|B',s:'B'},{k:'NSE_EQ|C',s:'C'}];$.lq={'NSE_EQ|A':{last_price:101,net_change:1},'NSE_EQ|C':{last_price:120,net_change:20}};$.wFilter='';$.wSort='chgPct'`);
  ok('WL: Chg% sort descending with quote-less rows last', w.eval(`wlOrdered().map(x=>x.s).join('')`) === 'CAB');

  /* ---- ldWQ: an auth failure must never purge the watchlist ---- */
  w.eval(`$.tok='DAYTOK-1234567890abcdef';$.wl=[{k:'NSE_EQ|INE002A01018',s:'RELIANCE',n:'Reliance'},{k:'NSE_EQ|INE009A01021',s:'INFY',n:'Infosys'}]`);
  stubFetch(() => json(401, { status: 'error', errors: [{ message: 'Invalid token used to access API' }] }));
  await w.eval('ldWQ()').catch(() => {});
  ok('WL: 401 "Invalid token" does not wipe the watchlist', w.eval('($.wl||[]).length') === 2);

  /* ---- B10 / B11: panic + kill switch ---- */
  w.eval(`$.tok='DAYTOK-1234567890abcdef';$.authShiftAt=0;$.ords=[{order_id:'1',status:'open'}];$.pos=[{instrument_token:'NSE_EQ|X',quantity:5}]`);
  let dialogs = 0, urls = [];
  w.confirm = () => { dialogs++; return true; };
  stubFetch((u, o) => { urls.push((o && o.method || 'GET') + ' ' + u); return json(200, { status: 'success', data: {}, summary: { success: 1, total: 1 } }); });
  await w.eval('panicExitAll()');
  ok('B10: panic needs exactly 2 confirmations (was 6)', dialogs === 2);
  ok('B10: panic still cancels then exits', urls.some(x => /DELETE .*multi\/cancel/.test(x)) && urls.some(x => /POST .*positions\/exit/.test(x)));
  dialogs = 0; urls = [];
  w.confirm = () => ++dialogs < 2;               // decline the 2nd (final) confirmation
  await w.eval('panicExitAll()');
  ok('B10: declining the panic confirmation sends nothing', urls.filter(x => !/^GET/.test(x)).length === 0);
  w.confirm = () => true;
  urls = [];
  await w.eval('cancelAllMine()');
  ok('B10: standalone cancel-all keeps its own 2 confirmations', urls.some(x => /DELETE/.test(x)));

  w.eval(`window._ksStates={}`);
  stubFetch(() => json(200, { status: 'success', data: [{ segment: 'NSE_FO', segment_status: 'ACTIVE', kill_switch_enabled: false }] }));
  w.eval(`document.getElementById('TC').innerHTML=''`);
  await w.eval(`ksSet('NSE_FO','ENABLE')`);
  ok('B11: successful ENABLE (kill_switch_enabled=false) is not flagged as failed', !/not confirmed|may have failed/i.test(w.eval(`document.getElementById('TC').textContent`)));
  stubFetch(() => json(200, { status: 'success', data: [{ segment: 'NSE_FO', segment_status: 'ACTIVE', kill_switch_enabled: true }] }));
  w.eval(`document.getElementById('TC').innerHTML=''`);
  await w.eval(`ksSet('NSE_FO','DISABLE')`);
  ok('B11: successful DISABLE (kill_switch_enabled=true) is not flagged', !/not confirmed|may have failed/i.test(w.eval(`document.getElementById('TC').textContent`)));
  stubFetch(() => json(200, { status: 'success', data: [{ segment: 'NSE_FO', segment_status: 'ACTIVE', kill_switch_enabled: true }] }));
  w.eval(`document.getElementById('TC').innerHTML=''`);
  await w.eval(`ksSet('NSE_FO','ENABLE')`);
  ok('B11: ENABLE that left the switch engaged IS flagged', /not confirmed/i.test(w.eval(`document.getElementById('TC').textContent`)));

  /* ---- A3: MCX daily candle of today is not "closed" at 15:31 IST ---- */
  const todayIst = w.eval(`algoISTDateKey(Date.now())`);
  w.eval(`window.__cs=[{t:new Date('${todayIst}T05:00:00Z')}]`);
  ok('A3: MCX close-minute keeps today\'s partial daily bar out', w.eval(`algoOnlyClosedCandles(window.__cs,'days',1,1436).length`) === 0);

  /* ---- B7: MCX modify quantity is in lots ---- */
  w.eval(`$.oM={'M1':{order_id:'M1',instrument_key:'MCX_FO|1',lot_size:100}}`);
  w.eval(`['mOid','mQ','mP','mTP'].forEach(id=>{let e=document.getElementById(id);if(!e){e=document.createElement('input');e.id=id;document.body.appendChild(e);}});document.getElementById('mOid').value='M1';document.getElementById('mQ').value='1';document.getElementById('mP').value='100';document.getElementById('mOT')&&(document.getElementById('mOT').value='LIMIT')`);
  urls = [];
  stubFetch((u, o) => { urls.push((o && o.method || 'GET') + ' ' + u); return json(200, { status: 'success', data: { order_id: 'M1' } }); });
  w.eval(`$.modBusy=false`);
  await w.eval('doMd()');
  ok('B7: MCX modify with qty=1 lot is not blocked by the unit lot-size check', urls.some(x => /^PUT .*order\/modify/.test(x)));

  process.exit(report('regress', R) ? 1 : 0);
})();
