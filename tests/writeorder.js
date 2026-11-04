/* Ambiguous-write recovery suite (2026-11-04).
 * Reproduces the reported failure — "when I place an order I get
 * Network/CORS error … may already have reached Upstox, check the order book" —
 * and proves the new behaviour:
 *   1. writes go to api.upstox.com (the host reads already use), not api-hft
 *   2. a lost reply is reconciled against the order book instead of guessed
 *   3. "found"  → the order DID land: no retry, no duplicate, honest toast
 *   4. "none"   → verified absent, so exactly ONE retry on the fallback host
 *   5. "unknown"→ never re-send; tell the user to check
 *   6. offline  → never re-send ("did not leave this device")
 *   7. cancels treat absence-from-open as success
 * Order-book reads are simulated through the page's own fetch, so every call
 * the app makes is visible in `calls`.
 */
const { boot, okpush, report } = require('./helpers');

const OKPLACE = { status: 'success', data: { order_ids: ['OID-NEW-1'] }, metadata: { latency: 42 } };
const ok = (body, status = 200) => ({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });

(async () => {
  const R = []; const okpush2 = okpush(R);
  const { w, calls } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 700 });
  const ev = s => { try { return w.eval(s); } catch (e) { return '__THROW__:' + e.message; } };
  const toasts = () => (w.document.getElementById('TC')?.textContent || '').replace(/\s+/g, ' ').trim();
  const clearToasts = () => { w.document.getElementById('TC').innerHTML = ''; };
  w.confirm = () => true;

  /* ---- endpoint hosts: order writes must not depend on api-hft ---- */
  okpush2('place/cancel/modify target api.upstox.com (host reads already reach)',
    ev(`END.ORDER_PLACE.base==='https://api.upstox.com'&&END.ORDER_CANCEL.base==='https://api.upstox.com'&&END.ORDER_MODIFY.base==='https://api.upstox.com'`));
  okpush2('api-hft is kept as the reconciliation-gated fallback',
    ev(`END.ORDER_PLACE.altBase==='https://api-hft.upstox.com'`));

  /* ---- a ticket the app will accept ---- */
  const armTicket = () => ev(`
    $.oSide='BUY';
    $.ddSel.dO1={k:'NSE_EQ|INE002A01018',s:'RELIANCE',n:'Reliance',x:'NSE',lot:1,minimumLot:1,tick:0.05};
    document.getElementById('oI').value='RELIANCE';
    document.getElementById('oQ').value='5';
    document.getElementById('oP').value='2500';
    document.getElementById('oTy').value='MARKET';
    document.getElementById('oPr').value='D';
    document.getElementById('oVl').value='DAY';
    document.getElementById('oAm').value='true';
    1;`);
  armTicket();

  /* ================= CASE 1: reply lost, order DID land ================= */
  let placed = 0, bookReads = 0;
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/place/.test(us)) { placed++; return Promise.reject(new TypeError('Failed to fetch')); }
    if (/order\/retrieve-all/.test(us)) {
      bookReads++;
      /* the broker accepted it — the row is already in the book */
      return Promise.resolve(ok({ status: 'success', data: [{ order_id: 'OID-NEW-1', instrument_token: 'NSE_EQ|INE002A01018', transaction_type: 'BUY', quantity: 5, order_type: 'MARKET', status: 'open', order_timestamp: new Date().toISOString() }] }));
    }
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev('plO()');
  await new Promise(r => setTimeout(r, 900));
  const t1 = toasts();
  okpush2('lost reply + order present → no duplicate send', placed === 1);
  okpush2('lost reply + order present → verified in the order book', /WAS placed/i.test(t1) && /verified in the order book/i.test(t1));
  okpush2('…and the user is told not to place it again', /Do NOT place it again/i.test(t1));
  okpush2('…and it never tried the fallback host', !calls.some(c => /api-hft/.test(c.u)));

  /* ================= CASE 2: reply lost, nothing landed ================= */
  placed = 0; bookReads = 0;
  const hosts = [];
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/place/.test(us)) {
      placed++; hosts.push(new URL(us).host);
      /* first attempt: transport failure; fallback attempt: success */
      if (hosts[0] === 'api.upstox.com' && placed === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(ok(OKPLACE, 200));
    }
    if (/order\/retrieve-all/.test(us)) { bookReads++; return Promise.resolve(ok({ status: 'success', data: [] })); }
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev('plO()');
  await new Promise(r => setTimeout(r, 2600));
  okpush2('verified-absent → exactly one retry, on the fallback host',
    placed === 2 && hosts[0] === 'api.upstox.com' && hosts[1] === 'api-hft.upstox.com');
  okpush2('verified-absent → order book was consulted twice before re-sending', bookReads >= 2);
  okpush2('retry success is reported as placed (and names the backup host)',
    /Order placed/i.test(toasts()) && /backup order host/i.test(toasts()));
  okpush2('limit guard: never more than one retry per attempt', placed <= 2);

  /* ============ CASE 3: reply lost and the book cannot be read =========== */
  placed = 0;
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/place/.test(us)) { placed++; return Promise.reject(new TypeError('Failed to fetch')); }
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(ok({ status: 'error', errors: [{ message: 'boom' }] }, 500));
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev('plO()');
  await new Promise(r => setTimeout(r, 1200));
  okpush2('unreadable book → never re-sends (no duplicate risk)', placed === 1);
  okpush2('unreadable book → says it is unconfirmed and to check Orders',
    /unconfirmed/i.test(toasts()) && /check Orders/i.test(toasts()));

  /* ================= CASE 4: offline → nothing left the device ========== */
  placed = 0;
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/place/.test(us)) { placed++; return Promise.reject(new TypeError('Failed to fetch')); }
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(ok({ status: 'success', data: [] }));
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev('plO()');
  await new Promise(r => setTimeout(r, 2200));
  okpush2('offline → no retry on the other host', placed === 1);
  okpush2('offline → reported as NOT placed and safe to retry', /NOT placed/i.test(toasts()) && /offline/i.test(toasts()));
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });

  /* ================= CASE 5: cancel success = absence from open ========= */
  let cancels = 0, cancelHosts = [];
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/cancel/.test(us) && String(o && o.method).toUpperCase() === 'DELETE') {
      cancels++; cancelHosts.push(new URL(us).host);
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    /* the order is gone (or cancelled) — not an open row any more */
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(ok({ status: 'success', data: [{ order_id: 'OID-C1', status: 'cancelled', transaction_type: 'BUY', quantity: 1 }] }));
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev(`canO('OID-C1')`);
  await new Promise(r => setTimeout(r, 900));
  okpush2('cancel: lost reply + order no longer open counts as success (no retry)',
    cancels === 1 && /confirmed in the order book/i.test(toasts()));

  /* ============ CASE 6: cancel did NOT land → one retry, then honest ==== */
  cancels = 0;
  w.fetch = (u, o) => {
    const us = String(u);
    if (/order\/cancel/.test(us)) { cancels++; return Promise.reject(new TypeError('Failed to fetch')); }
    /* still open after both reads */
    if (/order\/retrieve-all/.test(us)) return Promise.resolve(ok({ status: 'success', data: [{ order_id: 'OID-C2', status: 'open', transaction_type: 'BUY', quantity: 1 }] }));
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev(`canO('OID-C2')`);
  await new Promise(r => setTimeout(r, 2600));
  okpush2('cancel that never landed is not reported as cancelled',
    !/Cancelled/i.test(toasts()) && /(did not go through|Cancel:)/i.test(toasts()));

  /* ============ CASE 7: GTT create reconciles against the GTT list ====== */
  let gttPosts = 0;
  w.fetch = (u, o) => {
    const us = String(u);
    if (/gtt\/place/.test(us)) { gttPosts++; return Promise.reject(new TypeError('Failed to fetch')); }
    if (/\/v3\/order\/gtt(\?|$)/.test(us)) return Promise.resolve(ok({ status: 'success', data: [{ gtt_order_id: 'GTT-X1', instrument_token: 'NSE_EQ|INE002A01018', quantity: 5, rules: [{ strategy: 'ENTRY', trigger_price: 2500 }] }] }));
    return Promise.resolve(ok({ status: 'success', data: [] }));
  };
  clearToasts();
  ev(`
    $.gttBusy=false;
    $.ddSel.dG1={k:'NSE_EQ|INE002A01018',s:'RELIANCE',n:'Reliance',x:'NSE',lot:1,minimumLot:1,tick:0.05};
    document.getElementById('gI').value='RELIANCE';
    document.getElementById('gQt').value='5';
    document.getElementById('gTr').value='2500';
    document.getElementById('gTt').value='ABOVE';
    document.getElementById('gSd').value='BUY';
    crG();`);
  await new Promise(r => setTimeout(r, 1200));
  okpush2('GTT: lost reply + row present → verified, not duplicated',
    gttPosts === 1 && /WAS created/i.test(toasts()) && /GTT list/i.test(toasts()));

  process.exit(report('AMBIGUOUS-WRITE RECOVERY TESTS', R) ? 1 : 0);
})();
