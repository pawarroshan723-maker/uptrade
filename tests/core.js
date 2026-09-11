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

  process.exit(report('CORE SMOKE+SHIFT TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
