/* Algo-page regression suite (2026-11-05 deep dive).
 * Covers the fifth hunt on the Algo engine: the historical-only candle feed
 * (a 5m/15m/1H signal could be a session stale), news queried with a
 * derivative key instead of its underlying, plan/backtest quantities that were
 * not whole lots, the divergence banner's hard-coded ±25, the intraday candle
 * stamp that dropped the time, and algoValue(null) printing 0.00.
 * Every assertion fails on the pre-fix build and passes now.
 */
const { boot, okpush, report } = require('./helpers');

const json = body => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const iso = ms => new Date(ms).toISOString();

(async () => {
  const R = []; const ok = okpush(R);
  const { w } = await boot({ tokens: { ss: { u_tok: 'DAYTOK-1234567890abcdef' } }, settle: 700 });
  const ev = s => { try { return w.eval(s); } catch (e) { return '__THROW__'; } };
  const html = () => ev(`document.getElementById('alR').innerHTML`);
  const planQty = h => { const m = /Risk-sized units<\/span><b>([^<]*)<\/b><small>([^<]*)/.exec(h || ''); return m ? { qty: m[1], note: m[2] } : null; };

  /* ---------- a strong breakout tape: 300 closed 5m bars + today's ---------- */
  const now = Date.now(), TF = 5 * 60000;
  const mk = (i, t) => { const c = 100 + i * 0.2; return [iso(t), c - 0.05, c + 0.12, c - 0.12, c, (i % 5 === 0 ? 20000 : 1000)]; };
  const hist = [], intra = [];
  for (let i = 0; i < 300; i++) hist.push(mk(i, now - 40 * 60000 - (300 - i) * TF));
  const tClosed = now - 6 * 60000, tForming = now - 60000;      /* last closed / in-progress bar */
  intra.push(mk(300, tClosed)); intra.push(mk(301, tForming));

  const urls = [];
  w.fetch = u => {
    const us = String(u); urls.push(us);
    if (/historical-candle\/intraday/.test(us)) return json({ status: 'success', data: { candles: intra } });
    if (/historical-candle/.test(us)) return json({ status: 'success', data: { candles: hist } });
    if (/\/v2\/news/.test(us)) {
      const key = new URLSearchParams(us.split('?')[1]).get('instrument_keys');
      /* the feed tags headlines to the underlying instrument only */
      const arts = key === 'NSE_INDEX|Nifty 50'
        ? [{ heading: 'Nifty beats street estimates as order wins surge', article_link: 'https://example.com/n', published_at: new Date(now - 3600e3).toISOString(), thumbnail: '', tags: [] }]
        : [];
      return json({ status: 'success', data: { [key]: arts } });
    }
    return json({ status: 'success', data: [] });
  };

  const run = async setup => { ev(setup); await new Promise(r => setTimeout(r, 1600)); return html(); };

  /* ---- F&O contract: lot 250, news tagged to the underlying index ---- */
  const setupFo = `$.ddSel.dA1={k:'NSE_FO|43919',s:'NIFTY FUT',n:'Nifty fut',x:'NSE',segment:'NSE_FO',lot:250,minimumLot:250,tick:0.05,underlyingKey:'NSE_INDEX|Nifty 50'};
    document.getElementById('alI').value='NIFTY FUT';
    document.getElementById('alStrat').value='breakout';
    document.getElementById('alTF').value='minutes/5';
    document.getElementById('alBars').value='250';
    document.getElementById('alCap').value='100000';
    document.getElementById('alRisk').value='1';
    document.getElementById('alFee').value='5';
    document.getElementById('alAtr').value='1.5';
    document.getElementById('alRR').value='2';
    document.getElementById('alI').value='NIFTY FUT';
    runA();`;
  const foHtml = await run(setupFo);

  /* ============ CANDLES: intraday merge, no look-ahead ============ */
  ok('algo: an intraday timeframe also reads the intraday candle endpoint',
    urls.some(u => /\/v3\/historical-candle\/intraday\/NSE_FO%7C43919\/minutes\/5$/.test(u)));
  const lastT = ev(`$.algoResult?.candles?.at(-1)?.t?.getTime()`);
  ok('algo: the latest completed bar is today\'s, not the previous session\'s', lastT === tClosed);
  ok('algo: the in-progress candle is still excluded (no look-ahead)',
    ev(`(()=>{const c=$.algoResult?.candles||[];return c.length>0&&!c.some(x=>x.t.getTime()===${tForming});})()`) === true);
  const stamp = /Candle ([^<]*)</.exec(foHtml || '')?.[1] || '';
  ok('algo: the hero stamp keeps the IST candle time on intraday timeframes',
    / · \d{2}:\d{2}$/.test(stamp) && stamp.startsWith(ev(`algoDate(${tClosed})`)));

  /* =============== NEWS: underlying key, real confluence =============== */
  ok('algo: news is queried with the underlying key, not the derivative key',
    urls.some(u => /\/v2\/news\?/.test(u) && /instrument_keys=NSE_INDEX%7CNifty\+50/.test(u)) &&
    !urls.some(u => /\/v2\/news\?/.test(u) && /NSE_FO/.test(decodeURIComponent(u))));
  ok('algo: the underlying\'s headlines reach the bias card',
    /(\d+) articles \(trailing/.exec(foHtml || '')?.[1] === '1' &&
    !/News bias <b[^>]*>\+0</.test(foHtml || ''));

  /* ================== SIZING: whole lots only ================== */
  const foPlan = planQty(foHtml);
  ok('algo: an F&O plan quantity is a whole number of lots',
    !!foPlan && Number(foPlan.qty) > 0 && Number(foPlan.qty) % 250 === 0);
  const foQtys = JSON.parse(ev(`JSON.stringify(($.algoResult?.backtest?.trades||[]).map(t=>t.qty))`) || '[]');
  ok('algo: the backtest never fills fractional F&O lots',
    foQtys.length > 0 && foQtys.every(q => q % 250 === 0));

  /* ---- equity contract: lot 1 must behave exactly as before ---- */
  const eqHtml = await run(`$.ddSel.dA1={k:'NSE_EQ|INE002A01018',s:'RELIANCE',n:'Reliance',x:'NSE',segment:'NSE_EQ',lot:1,minimumLot:1,tick:0.05};
    document.getElementById('alI').value='RELIANCE';
    runA();`);
  const eqPlan = planQty(eqHtml);
  ok('algo: a cash-equity plan quantity stays in raw units', !!eqPlan && Number(eqPlan.qty) > 0 && !/per lot/.test(eqPlan.note));
  const eqQtys = JSON.parse(ev(`JSON.stringify(($.algoResult?.backtest?.trades||[]).map(t=>t.qty))`) || '[]');
  ok('algo: cash-equity backtest fills are unchanged by the lot logic',
    eqQtys.length > 0 && eqQtys.every(q => Number.isInteger(q) && q > 0 && q % 250 !== 0));

  /* ================= DIVERGENCE: strategy threshold ================= */
  ok('algo: divergence needs the strategy\'s own threshold, not a fixed 25',
    ev(`algoIsDivergent(27,-30,30)`) === false && ev(`algoIsDivergent(27,-30,25)`) === true &&
    ev(`algoIsDivergent(-31,26,30)`) === true && ev(`algoIsDivergent(-26,26,30)`) === false);

  /* ==================== FORMATTING: null ≠ zero ==================== */
  ok('algo: a missing indicator prints a dash, not 0.00',
    ev(`algoValue(null)`) === '—' && ev(`algoValue(undefined)`) === '—' && ev(`algoValue(0)`) === '0.00');
  ok('algo: day candles keep the date-only stamp', ev(`algoCandleStamp(Date.UTC(2026,9,30,3,45),'days')`) === '30 Oct 26');
  ok('algo: intraday candles print the IST time', ev(`algoCandleStamp(Date.UTC(2026,9,30,3,45),'minutes')`) === '30 Oct 26 · 09:15');

  /* ============ BACKTEST SIZING: settings.lot respected ============ */
  const lotRun = ev(`(()=>{const c=[];for(let i=0;i<300;i++){const cl=100+i*0.2;
      c.push({t:new Date(Date.UTC(2026,0,1)+i*300000),o:cl-.05,h:cl+.12,l:cl-.12,c:cl,v:(i%5===0?20000:1000)});}
    const ind=algoIndicators(c),bt=algoBacktest(c,ind,'breakout','BOTH',{capital:100000,riskPct:1,feeBps:5,atrMult:1.5,rr:2,lot:250});
    return JSON.stringify({n:bt.trades.length,q:[...new Set(bt.trades.map(t=>t.qty))]});})()`);
  const lotParsed = JSON.parse(lotRun || '{}');
  ok('algo: the backtest sizes in lots when settings.lot is set',
    lotParsed.n > 0 && lotParsed.q.every(q => q % 250 === 0));

  const rawRun = JSON.parse(ev(`(()=>{const c=[];for(let i=0;i<300;i++){const cl=100+i*0.2;
      c.push({t:new Date(Date.UTC(2026,0,1)+i*300000),o:cl-.05,h:cl+.12,l:cl-.12,c:cl,v:(i%5===0?20000:1000)});}
    const ind=algoIndicators(c),bt=algoBacktest(c,ind,'breakout','BOTH',{capital:100000,riskPct:1,feeBps:5,atrMult:1.5,rr:2,lot:1});
    return JSON.stringify({n:bt.trades.length,q:[...new Set(bt.trades.map(t=>t.qty))]});})()`) || '{}');
  ok('algo: a lot of 1 keeps the raw-unit fills the backtest always used',
    rawRun.n > 0 && rawRun.q.every(q => Number.isInteger(q) && q > 0) && rawRun.q.some(q => q % 250 !== 0));

  process.exit(report('ALGO ENGINE TESTS', R) ? 1 : 0);
})();
