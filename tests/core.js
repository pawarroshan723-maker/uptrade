/* Core smoke + token-shift regression (compact rebuild of the older /tmp suites).
 * Token-shift contract: analytics token persists in localStorage; sessions with
 * only an analytics token run read-only ($.ro); daily token always wins; logout
 * wipes both. Trading guards (cancel-all, margin estimate) stay daily-only.
 */
const { boot, okpush, report } = require('./helpers');

(async () => {
  const R = []; const ok = okpush(R);

  // -- shift: no tokens → login state
  let { w } = await boot({ tokens: {}, settle: 800 });
  ok('no tokens: $.tok and $.atok empty', !w.eval('$.tok') && !w.eval('$.atok'));

  // -- shift: analytics token only → read-only session
  ({ w } = await boot({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } }, settle: 800 }));
  ok('atok-only: $.ro true, atok loaded', w.eval('$.ro===true && $.atok==="ATOKPERSIST-1234567890"'));

  // -- shift: daily only → normal session
  ({ w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 800 }));
  ok('daily-only: $.ro false, tok loaded', w.eval('$.ro===false && $.tok==="DAYTOK-1234567890abcdef"'));

  // -- shift: both → daily primary, analytics retained
  ({ w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' }, ls: { u_atok: 'ATOKPERSIST-1234567890' } }, settle: 800 }));
  ok('both: daily primary + atok retained', w.eval('$.ro===false && $.tok==="DAYTOK-1234567890abcdef" && $.atok==="ATOKPERSIST-1234567890"'));

  // -- shift: logout wipes both
  try { await w.eval('logout()'); } catch (e) { /* may navigate */ }
  await new Promise(r => setTimeout(r, 200));
  ok('logout: $.tok/$.atok cleared + storages wiped',
    w.eval('!$.tok && !$.atok && !$.ro') && !w.eval(`sessionStorage.getItem('u_tok') || localStorage.getItem('u_atok')`));

  // -- smoke: FY selector + toast machinery
  ({ w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 800 }));
  ok('FY picker: 6 options, current FY 2627 first', w.eval(`document.getElementById('plY').options.length`) === 6 && w.eval(`document.getElementById('plY').value`) === '2627');
  w.eval(`ts('hello-test','s')`);
  ok('toast writes to #TC', w.eval(`document.getElementById('TC').textContent`).includes('hello-test'));

  // -- smoke: navigation
  w.eval(`nav('oc')`);
  ok("nav('oc') shows option-chain page", w.eval(`document.getElementById('pg-oc') && document.getElementById('pg-oc').style.display!=='' ? true : document.getElementById('pg-oc').classList.contains('on') || getComputedStyle(document.getElementById('pg-oc')).display!=='none'`));

  // -- combined Live/Feed header button (merges old wCnt chip + wS chip + Feed button)
  ok('header: single #wS feed-btn; old wCnt chip + separate Feed button gone',
    w.eval(`var b=document.getElementById('wS'); b && b.tagName==='BUTTON' && b.classList.contains('feed-btn') && document.getElementById('wCnt')===null && document.getElementById('wCntT')===null`));
  w.eval(`$.ws={readyState:1}; upWS(1)`);
  ok('upWS(1) w/ live socket → "Live · 1", green state', w.eval(`document.getElementById('wT').textContent`) === 'Live · 1' && w.eval(`document.getElementById('wS').className`).includes('on'));
  w.eval(`$.ws=null; upWS(0)`);
  ok('upWS(0) → "Feed" (neutral)', w.eval(`document.getElementById('wT').textContent`) === 'Feed' && !w.eval(`document.getElementById('wS').className`).includes('on'));
  w.eval(`wsCountUpdate()`);
  ok('tooltip carries socket details (3 sockets)', w.eval(`document.getElementById('wS').title`).includes('Market feed') && w.eval(`document.getElementById('wS').title`).includes('Portfolio stream'));

  // -- trading guards stay daily-only (analytics session must be refused, no fetch)
  ({ w, calls: global.__none } = await boot({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } }, settle: 800 }));
  const before = w.__calls.length;
  w.eval(`cancelAllMine()`);
  await new Promise(r => setTimeout(r, 250));
  ok('cancelAllMine refused on atok-only ("Log in first"), no order fetch',
    w.eval(`document.getElementById('TC').textContent`).includes('Log in first') && !w.__calls.slice(before).some(c => c.u.includes('/order/')));
  w.eval(`estMargin()`);
  await new Promise(r => setTimeout(r, 250));
  ok('estMargin refused on atok-only ("Log in first to estimate margin")',
    w.eval(`document.getElementById('TC').textContent`).includes('estimate margin'));

  // -- search works in analytics session (part of the OC fix)
  const b2 = w.__calls.length;
  await w.eval(`searchInstruments('RELIANCE', null)`);
  await new Promise(r => setTimeout(r, 400));
  ok('searchInstruments hits /v2/instruments/search with atok bearer',
    w.__calls.slice(b2).some(c => c.u.includes('/v2/instruments/search') && c.auth === 'Bearer ATOKPERSIST-1234567890'));

  /* ---- AUDIT-C3 (2026-09-11): REST 401 → demote vs logout -------------------
   * Contract: a rejected token with an Analytics token staged DEMOTES (drop the
   * dead daily token, stay in the app read-only) and market-data calls are
   * retried on the RO token; with no fallback left it LOGOUTS with an explicit
   * "Session expired" toast. Local pre-flight errors, 403s and instrument-level
   * "expired" wording must never trigger either transition.
   */
  const DAY = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };
  const RO = { ls: { u_atok: 'ATOKPERSIST-1234567890' } };
  const BOTH = { ss: { u_tok: 'DAYTOK-1234567890abcdef' }, ls: { u_atok: 'ATOKPERSIST-1234567890' } };
  const UNAUTH = { status: 'error', errors: [{ errorCode: 'UDAPI100059', message: 'Invalid Access Token' }] };
  const toast = () => w.eval(`document.getElementById('TC').textContent`);
  const attempt = expr => w.eval(`(async()=>{try{await ${expr};return 'ALLOWED';}catch(e){return 'REJECTED: '+e.message;}})()`);
  const held = () => w.eval(`$.tok==="DAYTOK-1234567890abcdef" && $.ro===false`);

  // A: 401 on a market-data path + staged atok → demote, then retry on the RO token
  let md401 = 0;
  ({ w, calls } = await boot({ tokens: BOTH, routes: [{ re: /DEMO_MD401/, bodyFn: () => (++md401 === 1 ? UNAUTH : { status: 'success', data: {} }) }], settle: 800 }));
  const a1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/market-quote/quotes'},{query:'?i=DEMO_MD401',_force:true})`);
  await new Promise(r => setTimeout(r, 200));
  ok('401 on market path w/ staged atok → demote + retry on the RO token',
    a1 === 'ALLOWED'
    && w.eval(`!$.tok && $.ro===true && $.atok==="ATOKPERSIST-1234567890"`)
    && !w.eval(`sessionStorage.getItem('u_tok')`)
    && calls.filter(c => c.u.includes('DEMO_MD401')).map(c => c.auth).join(' → ') === 'Bearer DAYTOK-1234567890abcdef → Bearer ATOKPERSIST-1234567890'
    && toast().includes('Analytics token'));

  // B: 401 on a daily-only path → demote, but never retried on the RO token
  ({ w, calls } = await boot({ tokens: BOTH, routes: [{ re: /DEMO_PROF401/, status: 401, body: UNAUTH }], settle: 800 }));
  const b1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/user/profile'},{query:'?x=DEMO_PROF401',_force:true})`);
  ok('401 on daily-only path → demotes but does NOT retry on the RO token',
    b1.startsWith('REJECTED') && /Invalid Access Token/.test(b1)
    && w.eval(`!$.tok && $.ro===true && !!$.atok`)
    && !calls.some(c => c.u.includes('DEMO_PROF401') && c.auth === 'Bearer ATOKPERSIST-1234567890'));

  // C: daily-only session, no fallback → forced logout
  ({ w } = await boot({ tokens: DAY, routes: [{ re: /DEMO_LOGOUT401/, status: 401, body: UNAUTH }], settle: 800 }));
  const c1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/market-quote/quotes'},{query:'?i=DEMO_LOGOUT401',_force:true})`);
  await new Promise(r => setTimeout(r, 250));
  ok('401 with no atok staged → logout + "Session expired" toast',
    c1.startsWith('REJECTED') && w.eval(`!$.tok && !$.atok && !$.ro`)
    && !w.eval(`sessionStorage.getItem('u_tok')`) && toast().includes('Session expired'));

  // D: the Analytics token itself is rejected → logout (nothing left to fall back to)
  ({ w } = await boot({ tokens: RO, routes: [{ re: /DEMO_RO401/, status: 401, body: UNAUTH }], settle: 800 }));
  const d1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/market-quote/quotes'},{query:'?i=DEMO_RO401',_force:true})`);
  await new Promise(r => setTimeout(r, 250));
  ok('401 on the Analytics token itself → logout (no fallback left)',
    d1.startsWith('REJECTED') && w.eval(`!$.atok && !$.tok`)
    && !w.eval(`localStorage.getItem('u_atok')`) && toast().includes('Session expired'));

  // E: our own pre-flight "No access token" is not a revoked session
  ({ w } = await boot({ tokens: {}, settle: 800 }));
  const e1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/user/profile'},{_force:true})`);
  ok('local "No access token" pre-flight is NOT an expired session',
    /No access token/.test(e1) && w.eval(`$.authShiftAt===0`) && !toast().includes('Session expired'));

  // F: an ordinary business error must leave the session alone
  ({ w } = await boot({ tokens: BOTH, routes: [{ re: /DEMO_BIZ400/, status: 400, body: { status: 'error', errors: [{ errorCode: 'UDAPI1074', message: 'The financial_year is invalid' }] } }], settle: 800 }));
  const f1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/trade/profit-loss/data'},{query:'?financial_year=DEMO_BIZ400',_force:true})`);
  ok('non-auth 400 leaves the session untouched (no demote, no logout)',
    f1.startsWith('REJECTED') && held() && !toast().includes('Session expired'));

  // G: 403 is a scope/permission problem, not an expiry
  ({ w } = await boot({ tokens: BOTH, routes: [{ re: /DEMO_403/, status: 403, body: { status: 'error', errors: [{ message: 'Forbidden for this token' }] } }], settle: 800 }));
  const g1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/user/profile'},{query:'?x=DEMO_403',_force:true})`);
  ok('403 (scope/permission) is NOT treated as an expired session',
    g1.startsWith('REJECTED') && held() && !toast().includes('Session expired'));

  // H: a bare 401 with a generic body still ends the session (status-driven)
  ({ w } = await boot({ tokens: DAY, routes: [{ re: /DEMO_HARD401/, status: 401, body: { status: 'error', errors: [{ message: 'Something went wrong' }] } }], settle: 800 }));
  const h1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v2/user/profile'},{query:'?x=DEMO_HARD401',_force:true})`);
  await new Promise(r => setTimeout(r, 250));
  ok('bare HTTP 401 with a generic message still ends the session',
    h1.startsWith('REJECTED') && w.eval(`!$.tok`) && toast().includes('Session expired'));

  // I: "contract has expired" is an instrument error, not a session error
  ({ w } = await boot({ tokens: BOTH, routes: [{ re: /DEMO_EXPIRY/, status: 400, body: { status: 'error', errors: [{ message: 'UDAPI1509: The contract has expired' }] } }], settle: 800 }));
  const i1 = await attempt(`upstoxFetch({base:API_BASE,path:'/v3/order/place'},{method:'POST',body:{},query:'?x=DEMO_EXPIRY',_force:true})`);
  ok('"contract has expired" (instrument error) is not a session expiry',
    i1.startsWith('REJECTED') && held() && !toast().includes('Session expired'));

  process.exit(report('CORE SMOKE+SHIFT TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
