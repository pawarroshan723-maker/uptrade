/* Option chain in a read-only (analytics-token-only) session — end-to-end.
 * Contract: /v2/option/contract (expiries) + /v2/option/chain (chain) are
 * analytics-token friendly; both must go out with `Bearer <atok>` and the
 * chain must render with no login toast. Daily-session regression included.
 */
const { boot, okpush, report } = require('./helpers');
const CHAIN = { status: 'success', data: [
  { expiry: '2026-09-24', pcr: 1.1, strike_price: 24500, underlying_key: 'NSE_INDEX|Nifty 50', underlying_spot_price: 24512.3,
    call_options: { instrument_key: 'NSE_FO|55001', market_data: { ltp: 120.5, volume: 1000, oi: 500, close_price: 118, bid_price: 120, bid_qty: 50, ask_price: 121, ask_qty: 60, prev_oi: 480 },
      option_greeks: { vega: 4, theta: -40, gamma: 0.001, delta: 0.6, iv: 12.5, pop: 41 } },
    put_options: { instrument_key: 'NSE_FO|55002', market_data: { ltp: 105.2, volume: 900, oi: 520, close_price: 104, bid_price: 105, bid_qty: 40, ask_price: 106, ask_qty: 55, prev_oi: 510 },
      option_greeks: { vega: 4.2, theta: -38, gamma: 0.0011, delta: -0.4, iv: 12.8, pop: 44 } } },
  { expiry: '2026-09-24', pcr: 1.1, strike_price: 24550, underlying_key: 'NSE_INDEX|Nifty 50', underlying_spot_price: 24512.3,
    call_options: { instrument_key: 'NSE_FO|55003', market_data: { ltp: 98.1, volume: 800, oi: 410, close_price: 97, bid_price: 98, bid_qty: 30, ask_price: 99, ask_qty: 35, prev_oi: 400 },
      option_greeks: { vega: 3.8, theta: -35, gamma: 0.0012, delta: 0.55, iv: 12.6, pop: 39 } },
    put_options: { instrument_key: 'NSE_FO|55004', market_data: { ltp: 130, volume: 700, oi: 430, close_price: 129, bid_price: 129, bid_qty: 25, ask_price: 131, ask_qty: 30, prev_oi: 420 },
      option_greeks: { vega: 4.1, theta: -36, gamma: 0.001, delta: -0.45, iv: 12.9, pop: 46 } } }
] };
const ROUTES = [
  { re: /\/v2\/option\/contract/, body: { status: 'success', data: [{ expiry: '2026-09-24' }, { expiry: '2026-10-29' }] } },
  { re: /\/v2\/option\/chain/, body: CHAIN },
  { re: /market-quote/, body: { status: 'success', data: {} } }
];

(async () => {
  const R = []; const ok = okpush(R);

  // ---- RO session: analytics token only ----
  let { w, calls } = await boot({ tokens: { ls: { u_atok: 'ATOKPERSIST-1234567890' } }, routes: ROUTES });
  ok('RO session active', w.eval('$.ro===true && $.atok==="ATOKPERSIST-1234567890"'));
  w.eval(`nav('oc')`);
  await new Promise(r => setTimeout(r, 300));
  ok('ocAutoInit selected Nifty in RO', w.eval('String(OC.underKey||"").includes("Nifty")'));
  const cExp = calls.filter(c => c.u.includes('/v2/option/contract'));
  ok('expiries fetched with analytics bearer', cExp.length > 0 && cExp[0].auth === 'Bearer ATOKPERSIST-1234567890');
  await w.eval(`(async()=>{ await ldOC(); })()`);
  await new Promise(r => setTimeout(r, 400));
  const cChain = calls.filter(c => c.u.includes('/v2/option/chain'));
  ok('chain fetched with analytics bearer', cChain.length > 0 && cChain[0].auth === 'Bearer ATOKPERSIST-1234567890');
  ok('expiries-loaded toast', w.eval(`document.getElementById('TC').textContent.includes('expiries loaded')`));
  ok('strikes-loaded toast', w.eval(`document.getElementById('TC').textContent.includes('strikes loaded')`));
  ok('no login-error toast', !w.eval(`document.getElementById('TC').textContent.includes('Connect a token')`));
  ok('chain rows rendered', w.eval(`(document.querySelectorAll('#ocBody tr').length)>=2`));

  // ---- Daily session regression ----
  ({ w, calls } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, routes: ROUTES }));
  ok('daily session active', w.eval('$.ro===false && $.tok==="DAYTOK-1234567890abcdef"'));
  w.eval(`nav('oc')`);
  await new Promise(r => setTimeout(r, 300));
  await w.eval(`(async()=>{ await ldOC(); })()`);
  await new Promise(r => setTimeout(r, 400));
  const cChain2 = calls.filter(c => c.u.includes('/v2/option/chain'));
  ok('daily: chain fetched with daily bearer', cChain2.length > 0 && cChain2[0].auth === 'Bearer DAYTOK-1234567890abcdef');
  ok('daily: strikes-loaded toast', w.eval(`document.getElementById('TC').textContent.includes('strikes loaded')`));

  process.exit(report('OC READ-ONLY TESTS', R) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
