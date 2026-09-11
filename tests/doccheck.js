/* Doc-compliance — analytics-token (atok) allowlist must mirror the official
 * Analytics Token doc:
 *   atok-friendly (no static IP): Charges, Margins (GET + documented POST
 *   /v2/charges/margin exception), Market Quote, Historical Data, Option Chain,
 *   Market Information (/v2/market/), Fundamentals, News, IPO, Websocket — GET-only.
 *   Static-IP group (browser can never reach): User, Payments, Orders, GTT,
 *   Portfolio, Mutual Fund, Trade Profit And Loss → daily token required.
 */
const { boot, okpush, report } = require('./helpers');
const DAY = { ss: { u_tok: 'DAYTOK-1234567890abcdef' } };
const RO = { ls: { u_atok: 'ATOKPERSIST-1234567890' } };

const attempt = (w, expr) => w.eval(`(async()=>{ try{ await ${expr}; return 'ALLOWED'; }catch(e){ return 'REJECTED: '+e.message; } })()`);

(async () => {
  const R = []; const ok = okpush(R);

  let { w, calls } = await boot({ tokens: RO, settle: 800 });
  const F = ep => `upstoxFetch({base:API_BASE,path:'${ep}'},{_force:true})`;

  // 1-4: atok-friendly categories go out with the analytics bearer
  ok('charges/brokerage GET allowed on atok', (await attempt(w, F('/v2/charges/brokerage?segment=EQ'))) === 'ALLOWED'
    && calls.some(c => c.u.includes('/v2/charges/brokerage') && c.auth === 'Bearer ATOKPERSIST-1234567890'));
  ok('charges/margin POST allowed on atok (documented exception)',
    (await attempt(w, `upstoxFetch({base:API_BASE,path:'/v2/charges/margin'},{method:'POST',body:'{"instruments":[]}',_force:true})`)) === 'ALLOWED'
    && calls.some(c => c.u.includes('/v2/charges/margin') && c.auth === 'Bearer ATOKPERSIST-1234567890'));
  ok('market/status GET allowed on atok', (await attempt(w, F('/v2/market/status/NSE'))) === 'ALLOWED');
  ok('fundamentals GET allowed on atok', (await attempt(w, F('/v2/fundamentals/market-cap?instrument_key=NSE_EQ|INE002A01018'))) === 'ALLOWED');

  // 5-7: static-IP group stays locked with a clear daily-token message
  const rej1 = await attempt(w, F('/v2/trade/profit-loss/metadata?segment=EQ&financial_year=2627'));
  ok('P&L rejected on atok w/ daily-token message', rej1.startsWith('REJECTED') && /daily login token/.test(rej1));
  const rej2 = await attempt(w, `upstoxFetch({base:API_BASE,path:'/v3/order/place'},{method:'POST',body:'{}',_force:true})`);
  ok('order place rejected on atok w/ daily-token message', rej2.startsWith('REJECTED') && /daily login token/.test(rej2));
  const rej3 = await attempt(w, F('/v2/portfolio/long-term-holdings'));
  ok('portfolio rejected on atok w/ daily-token message', rej3.startsWith('REJECTED') && /daily login token/.test(rej3));

  // 8: GET-only within atok-friendly categories
  const rej4 = await attempt(w, `upstoxFetch({base:API_BASE,path:'/v2/news'},{method:'POST',body:'{}',_force:true})`);
  ok('non-GET on atok-friendly path rejected', rej4.startsWith('REJECTED'));

  // 9-10: daily-token session unaffected
  ({ w, calls } = await boot({ tokens: DAY, settle: 800 }));
  ok('P&L allowed on daily token w/ daily bearer', (await attempt(w, F('/v2/trade/profit-loss/data?segment=EQ&financial_year=2627&page_number=1&page_size=25'))) === 'ALLOWED'
    && calls.some(c => c.u.includes('/profit-loss/data') && c.auth === 'Bearer DAYTOK-1234567890abcdef'));
  const b = calls.length;
  await w.eval(`apiHist('https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/day/2026-09-01/2026-09-10')`).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  ok('apiHist uses daily bearer when daily present', calls.slice(b).some(c => c.u.includes('/v3/historical-candle') && c.auth === 'Bearer DAYTOK-1234567890abcdef'));

  process.exit(report('DOC-COMPLIANCE TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
