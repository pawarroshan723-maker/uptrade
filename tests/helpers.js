/* Shared jsdom boot harness for the UpTrade test suites.
 * Usage: const { boot } = require('./helpers');
 *   boot({ tokens:{ss:{u_tok:'...'}, ls:{u_atok:'...'}}, routes:[{re:/regex/, status:200, body:{...}}] })
 *   → resolves after the app's boot microtasks, exposing { w, calls }.
 * Fetch calls are recorded in `calls` as { u, auth }.
 * The WebSocket stub defines static CONNECTING/OPEN/CLOSING/CLOSED — required,
 * else `$.ws?.readyState===WebSocket.CONNECTING` silently no-ops.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');

/* Order-write suites are clock-sensitive: plO()/exit paths refuse to send
 * during the broker's 00:00–05:30 IST blackout (UDAPI100074) and switch to
 * AMO outside the session. Run the suite at 00:05 IST and every placement
 * assertion fails for a reason that has nothing to do with the code.
 * `clock` pins istClock() to a fixed in-window instant so results are
 * reproducible at any hour. Pass `clock:null` to keep the real clock.
 *   clock: '2026-11-20T10:30:00+05:30'  (10:30 IST, order API open, NSE live)
 */
const DEFAULT_TEST_CLOCK = '2026-11-20T10:30:00+05:30';

function boot({ tokens = {}, routes = [], settle = 1000, clock = DEFAULT_TEST_CLOCK } = {}) {
  const calls = [];
  const dom = new JSDOM(fs.readFileSync(INDEX, 'utf8'), {
    runScripts: 'dangerously',
    url: 'https://test.example.com/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.WebSocket = class WS {
        constructor() { this.readyState = 0; }
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        send() {} close() {}
      };
      w.crypto = { randomUUID: () => 'g1' };
      if (tokens.ls) for (const [k, v] of Object.entries(tokens.ls)) w.localStorage.setItem(k, v);
      if (tokens.ss) for (const [k, v] of Object.entries(tokens.ss)) w.sessionStorage.setItem(k, v);
      w.__calls = calls;
      w.fetch = (u, o) => {
        const us = String(u);
        calls.push({ u: us, auth: o && o.headers && (o.headers.Authorization || o.headers.authorization) });
        for (const r of routes) {
          if (r.re.test(us)) {
            const body = r.bodyFn ? r.bodyFn(us) : (r.body !== undefined ? r.body : { status: 'success', data: [] });
            return Promise.resolve({ ok: !r.status || r.status < 400, status: r.status || 200,
              text: () => Promise.resolve(JSON.stringify(body)) });
          }
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: 'success', data: [] })) });
      };
    }
  });
  return new Promise(res => setTimeout(() => {
    if (clock) {
      const pinned = new Date(clock);
      try {
        /* Delegate to the app's own istClock so its IST shift is preserved:
           pinning a raw Date would shift the readout into UTC. istClock is a
           reassignable function declaration, and placeApiOpen()/marketPhase()
           call it through the closure, so this controls every gate at once. */
        dom.window.eval(
          `(function(){var __ist=istClock,__at=${pinned.getTime()};` +
          `istClock=function(){return __ist(new Date(__at));};` +
          `try{window.istClock=istClock;}catch(e){}` +
          `try{window.placeApiOpen=placeApiOpen;}catch(e){}})()`
        );
      } catch (e) {
        console.log('[helpers] clock pin failed:', e.message);
      }
    }
    res({ w: dom.window, calls });
  }, settle));
}

const okpush = (R) => (n, c) => R.push([n, c === true ? 'ok' : JSON.stringify(c).slice(0, 160)]);
function report(suite, R) {
  let pass = 0, fail = 0;
  R.forEach(([n, r]) => { if (r === 'ok') pass++; else { fail++; console.log('FAIL', n, '->', r); } });
  console.log(`${suite}: PASS ${pass} FAIL ${fail}`);
  return fail;
}

module.exports = { boot, okpush, report, INDEX, DEFAULT_TEST_CLOCK };
