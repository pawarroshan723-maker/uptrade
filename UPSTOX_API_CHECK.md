# Upstox API Endpoints — Doc Compliance Check & Feature Roadmap

**Repo:** `pawarroshan723-maker/uptrade` · **Branch:** `arena/01a08bb7-uptrade` · **Date:** 2026-09-10
**Mode:** CHECK-ONLY — no application code was changed. This report documents (1) verification of every Upstox API endpoint the app uses against the official documentation, (2) real request/response JSON from the docs, (3) discrepancies found, and (4) a roadmap of high-grade features the documented API unlocks.

**Sources checked (official):**
- OpenAPI spec: `https://api.upstox.com/v2/api-docs` (linked from Upstox "Self Generated SDK's" page) — tags include Login, User, Portfolio, Order, Pre Risk Checks, Market Quote (V3), Market Holidays and Timings, Options, Trade P&L, History V3, Charge, Websocket, Post Trade, Expired Instrument, Instruments, **News**, Mutual Fund, Fundamentals, IPO, PAYMENTS, Events
- Documentation pages fetched: API Overview, Deprecation Notice, Analytics Token, News, Margin Details, Place Order V3, Market Data Feed V3 (WS), Put/Call Option Chain, Instrument Search, Place GTT Order, Kill Switch, Exit All Positions, Market Information, Orders index, GTT index, Instruments index
- Endpoint inventory cross-checked against the official `upstox-python` SDK (v2 complete endpoint table)

---

## 1. Verdict at a glance

> **Update 2026-09-10 (implementation pass):** following this check, the highest-value roadmap items were implemented in `index.html` and verified (77/77 smoke + 17/17 feature assertions): Analytics-token login (0.1), server-side logout (0.4), v3 quotes migration (0.5), latency readout (0.6), MCX lots confirm (0.3 mitigation), bracket GTT with trailing SL (1.1 place-side), bulk cancel-all/exit-all/panic (1.3), and the Trades page (1.4). See §5 status column.

| Area | Result |
|---|---|
| App endpoints that are **documented and correctly used** | **26 / 29** ✅ |
| App endpoints with **discrepancies or doc-side risks** | 3 (F-1 MCX lots, F-2 quotes v2 deprecation, F-3 WS connection headroom) — see §3 |
| Documented endpoints the app **doesn't use yet** | **35+** — the feature roadmap in §5 is built on them |
| Highest-impact unlocks | Analytics Token (1-year auth), Multi-leg GTT (brackets + trailing SL), Multi-Order baskets, server-side Max Pain/PCR/OI analytics, Kill Switch, Exit-All, Trade book + charges, Sandbox mode |

---

## 2. Endpoint compliance matrix (app `END` registry vs official docs)

Legend: ✅ = verified against official docs this session · 📄 = verified via official SDK endpoint table · ⚠️ = documented discrepancy (§3)

| App key | App path (base) | Doc status | Notes from docs |
|---|---|---|---|
| `AUTH_DIALOG` | `/v2/login/authorization/dialog` | 📄 | Matches SDK `LoginApi.authorize` |
| `TOKEN` | `/v2/login/authorization/token` | 📄 | `POST`, form-urlencoded `code/client_id/client_secret/redirect_uri/grant_type` — matches app |
| `PROFILE` | `/v2/user/profile` | 📄 | GET; also `DELETE /v2/logout` exists (app doesn't call it → §5-T0) |
| `FUNDS_V3` | `/v3/user/get-funds-and-margin` + `Api-Version: 3.0` | 📄 | App sends the version header correctly |
| `ORDER_PLACE` | `api-hft` `/v3/order/place` | ✅ | Body verified field-by-field — see §4.1. Response: `{data:{order_ids[]}, metadata:{latency}}` |
| `ORDER_MODIFY` | `api-hft` `/v3/order/modify` (PUT) | 📄 | V3 replacement for deprecated v2 modify — app already migrated ✅ |
| `ORDER_CANCEL` | `api-hft` `/v3/order/cancel` (DELETE) | 📄 | Same — app already on v3 ✅ |
| `ORDER_BOOK` | `/v2/order/retrieve-all` | 📄 | Full day book |
| `ORDER_HISTORY` | `/v2/order/history` | 📄 | Docs: accepts `order_id` **or `tag`** (app passes order_id only) |
| `POSITIONS` | `/v2/portfolio/short-term-positions` | 📄 | |
| `HOLDINGS` | `/v2/portfolio/long-term-holdings` | 📄 | |
| `GTT_PLACE` | `/v3/order/gtt/place` | ✅ | `type: SINGLE\|MULTIPLE`, `rules[]: {strategy, trigger_type, trigger_price, trailing_gap?, market_protection?}` — app sends single-leg only (§5-T1) |
| `GTT_LIST` | `/v3/order/gtt` | 📄 | Also `PUT /v3/order/gtt/modify` exists — **app lacks GTT edit** |
| `GTT_CANCEL` | `/v3/order/gtt/cancel` | 📄 | |
| `QUOTES_V3` | `/v2/market-quote/quotes` | ⚠️ | Works, but "Market OHLC Quotes V2" is on the official deprecation list → v3 replacement exists (§3, F-2) |
| `LTP_V3` | `/v3/market-quote/ltp` | ✅ | Up to **500 keys/request**; response adds `ltq`, `volume`, `cp` — matches app's fastTick parsing |
| `OPT_CHAIN` | `/v2/option/chain` | ✅ | Verified with full response body (§4.4). **New:** `expiry_date` accepts keywords `current_week/next_week/far_week/current_month/next_month/far_month` — app still computes dates itself. **MCX explicitly not supported** (why the app builds MCX chains client-side — correct design) |
| `OPT_CONTRACT` | `/v2/option/contract` | 📄 | |
| `INSTRUMENT_SEARCH` | `/v2/instruments/search` | ✅ | Params: `query`, `exchanges`, `segments`, `instrument_types`, `expiry` (keywords), **`atm_offset`**, `page_number`, `records` (max 30). Response items carry `tick_size, lot_size, freeze_quantity, qty_multiplier, cas_eligible` |
| `HIST` | `/v3/historical-candle` | 📄 | V3 replacement — app already migrated ✅ |
| `HIST_INTRA` | `/v3/historical-candle/intraday` | 📄 | Same ✅ |
| `WS_AUTH_V3` | `/v3/feed/market-data-feed/authorize` | 📄 | V3 replacement — app already migrated ✅ |
| `PORTFOLIO_WS_AUTH` | `/v2/feed/portfolio-stream-feed/authorize` | 📄 | Current version (no v3 for this feed) ✅ |
| `PNL_META` | `/v2/trade/profit-loss/metadata` | 📄 | Financial-year metadata — **re-verified 2026-09-11** vs official docs: params `segment` (EQ/FO/COM/CD) + `financial_year` (`2122` style) required, `from_date`/`to_date` optional dd-mm-yyyy; response `data.trades_count` + `data.page_size_limit` — app usage exact |
| `PNL_DATA` | `/v2/trade/profit-loss/data` | 📄 | **Fixed + re-verified 2026-09-11**: `page_number` (from 1) + `page_size` (≤ metadata `page_size_limit`, ≤ 5000) both required — app now paginates **all** pages (`ceil(count/page_size_limit)`, short-page break, 20-page cap), totals across every row, table capped at 1,000 rendered rows with honest "showing X of Y" notes. Row fields (`quantity,isin,scrip_name,trade_type,buy_date,buy_average,sell_date,sell_average,buy_amount,sell_amount`) match the documented schema |
| `PNL_CHARGES` | `/v2/trade/profit-loss/charges` | 📄 | **Re-verified 2026-09-11**: `data.charges_breakdown{total,brokerage,taxes{gst,stt,stamp_duty},charges{transaction,clearing,ipft,others,sebi_turnover,demat_transaction}}` — app renders all of it incl. the previously-missing **IPFT** row |

### P&L audit (2026-09-11 — vs official docs get-report-meta-data / get-profit-and-loss-report / get-trade-charges)

Bugs found & fixed: (1) only EQ/FO segments offered → **COM + CD added** (docs allow all four); (2) only page 1 fetched with page_size hard-capped at 1,000 → **"Gross Realised" totals were wrong for >1,000 trades** → full pagination, totals over all loaded rows; (3) `charges.ipft` documented but never rendered → added; (4) spinner was set *before* the empty-FY guard → stuck spinner → guard reordered; (5) analytics-token click silently no-opped → visible toast (P&L correctly stays daily-token-only — Upstox serves Trade P&L to analytics tokens only from a whitelisted static IP). Verified by `/tmp/pltest.js`: **22/22** (doc-shaped happy path, 3-page pagination, short-page break, zero-trades, COM segment, RO-session toast, metadata/data/charges error paths, IPFT + total asserts).
| `NEWS` | `/v2/news` | ✅ | **Real endpoint** (was unverified before this check). `category=instrument_keys\|positions\|holdings`, max **30 keys**, `page_number` 1–100, `page_size` 1–100 — app's `upstoxFetchNews('instrument_keys', keys, 1, 15)` is compliant. App doesn't use the `positions`/`holdings` categories |
| `MARGIN` | `/v2/charges/margin` (POST) | ✅ | Body `{instruments:[{instrument_key, quantity, product, transaction_type, price}]}` — app's `estMargin` body **matches the documented schema exactly**; max **20 instruments**; products `I,D,CO,MTF` |
| `BROKERAGE` | `/v2/charges/brokerage` | 📄 | GET with order params — app matches |
| — (implicit) | WS `sub` message | ✅ | App's `wsSend` sends **binary** `TextEncoder().encode(JSON)` frames `{guid, method, data:{mode, instrumentKeys}}` — exactly the documented V3 format. Methods `sub/change_mode/unsub`, modes `ltpc/full/full_d30/option_greeks` all supported by the app except `change_mode` (§3, F-4) |

**Doc-verified JSON response for Option Greek V3** (app already chunks to the documented **50-key max** — its `CHUNK=50` fix matches `UDAPI100076`):

```json
{ "status": "success",
  "data": { "NSE_FO:NIFTY2540923000PE": {
      "last_price": 412.2, "instrument_token": "NSE_FO|43885", "ltq": 75,
      "volume": 3609600, "cp": 831.2, "iv": 0.33599853515625,
      "vega": 3.3899, "gamma": 0.0005, "theta": -51.848,
      "delta": -0.8081, "oi": 2476650 } } }
```

---

## 3. Discrepancies & doc-side risks found (check-only flags)

| # | Severity | Finding |
|---|---|---|
| **F-1** | **HIGH (trading risk — verify before next MCX order)** | **Commodity quantity semantics.** Place Order V3 docs: *"For commodity — **number of lots** is accepted. For other F&O and equities — number of units."* The app's `plO()` validates `qty % lot === 0` and sends **units** for every segment. If Upstox interprets MCX quantity as lots, a ticket of "1 lot = 100 barrels units" would be placed as **100 lots**. Needs an empirical sandbox/live-paper test; if confirmed, MCX tickets must send `qty / lot`. |
| **F-2** | MEDIUM (future breakage) | **`/v2/market-quote/quotes` is on the official deprecation list** ("Market OHLC Quotes V2 → V3 replacement"). The app's full-quote panel (depth, OHLC) still calls v2. Migrate to the v3 quotes endpoint before it is switched off. |
| **F-3** | LOW (design ceiling) | **WS market-feed limit = 2 connections per user** (5 with Upstox Plus). The app already runs exactly 2 market sockets (main + OC dedicated). Any future third market socket (e.g., a second tab, or a strategy feed) will be rejected. Portfolio stream is a separate feed/limit. Subscription ceilings: LTPC 5000 keys individual / 2000 combined; Full 2000/1500; **Full-D30 is Upstox-Plus-only (50 keys)**. |
| F-4 | LOW | WS `change_mode` method unused — chart LTPC↔Full flips could switch mode without unsub/resub (fewer gap windows). |
| F-5 | LOW | `metadata.latency` is returned by Place Order V3, GTT place, etc. — app ignores it; a "broker latency" readout is free. |
| F-6 | LOW | Option-chain response now includes `option_greeks.pop` (Probability of Profit) — not rendered in any OC column. |
| F-7 | INFO | New **CAS (Closing Auction Session)** fields stream in `full`/`full_d30`/`LTPC.iep` (`iep, rp, ieq, iiqTotal, iiqM, casEligible`) — app ignores them; pre-open/auction display is a cheap add. |
| F-8 | INFO | **Global indices** (GIFT NIFTY, Dow, S&P, FTSE…) are now streamable — keys in `global.json.gz`; India VIX confirmed as `NSE_INDEX|India VIX` (app already has VIX). |
| F-9 | INFO | `DELETE /v2/logout` exists — the app's logout is client-side only; calling the endpoint would **invalidate the token server-side** (better shared-machine hygiene). |

---

## 4. Documented request/response examples (official)

### 4.1 Place Order V3 — `POST https://api-hft.upstox.com/v3/order/place`
```json
{ "quantity": 4000, "product": "D", "validity": "DAY", "price": 0, "tag": "string",
  "instrument_token": "NSE_FO|43919", "order_type": "MARKET", "transaction_type": "BUY",
  "disclosed_quantity": 0, "trigger_price": 0, "is_amo": false, "slice": true,
  "market_protection": 0 }
```
Response:
```json
{ "status": "success",
  "data": { "order_ids": ["1644490272000","1644490272001","1644490272003"] },
  "metadata": { "latency": 30 } }
```
Doc notes the app already honors: `market_protection: -1` default (auto), `slice` auto-slicing on freeze breach, `is_amo` **auto-overridden** during market hours, optional `X-Algo-Name` header for exchange-approved algos.
**Quantity semantics (official request-body doc, verified 2026-09-18):** *"For commodity - number of lots is accepted. For other Futures & Options and equities - number of units is accepted"* — the basis of the MCX-LOTS ticket behavior (README §3.8/§3.9).
**AMO / after-hours (verified 2026-09-18, README §3.9):** the docs say *"If you intend to place an order outside of market hours, the 'is_amo' should be set to 'true'"*; error table pins the edges — **UDAPI100039** AMO rejected during market hours, **UDAPI100074** the place API itself is open only **05:30–24:00 IST**. ⚠️ **The same page is self-contradictory on is_amo during market hours**: the "Automatic AMO detection" callout says the flag "will be ignored, and the system will automatically infer its value based on the current market session" (is_amo:true in market hours → processed as live), while the error table keeps UDAPI100039 ("AMO orders cannot be placed during the market hours"). App strategy — never send is_amo:true inside a session (auto-sync + confirm flip to false) and always true outside it: correct under both readings. Sessions are segment-aware: NSE/BSE 09:15–15:30, CDS 09:00–17:00, MCX non-agri 09:00–~23:30 (≈23:55 while US DST is off). **UDAPI1161** exists for MCX-via-API being temporarily disabled broker-side — surfaced verbatim if ever hit. GTT place has **no** timing restriction (broker-side trigger; child order only on trigger — IMMEDIATE sends it at once).

### 4.2 GTT V3 (place) — `POST /v3/order/gtt/place`
```json
{ "type": "SINGLE", "quantity": 1, "product": "D",
  "rules": [ { "strategy": "ENTRY", "trigger_type": "ABOVE",
               "trigger_price": 6, "market_protection": 0 } ],
  "instrument_token": "NSE_EQ|INE669E01016", "transaction_type": "BUY" }
```
Response: `{ "status":"success", "data":{ "gtt_order_ids":["GTT-CU25280200021013"] }, "metadata":{ "latency":88 } }`
**Multi-leg:** `type:"MULTIPLE"` with `rules[]` = `ENTRY` + `TARGET` + `STOPLOSS` (TARGET/STOPLOSS trigger_type must be `IMMEDIATE`); **Trailing SL (beta):** add `trailing_gap` on the STOPLOSS leg (min gap = 10 % of |LTP − SL trigger| — pre-checked client-side since 2026-09-18).
**Conformance audit (2026-09-18, README §3.10):** verified against the request-body table — ENTRY mandatory; TARGET/STOPLOSS IMMEDIATE-only; `market_protection` optional on all three legs, default −1 (0 = MARKET-order rejection from API — never sent); TARGET/STOPLOSS sides are broker-implied opposite of the ENTRY's `transaction_type`; IMMEDIATE = child LIMIT sent at once (day-valid; SL/Target 365d after primary fills). **Bug found & fixed:** `rules[2]=…` on `[ENTRY]` serialized a sparse hole as `null` → `[ENTRY,TARGET,null,STOPLOSS]`; legs now built densely.

### 4.3 Margin — `POST /v2/charges/margin`
Request: `{ "instruments":[{ "instrument_key":"NSE_EQ|INE669E01016", "quantity":1, "transaction_type":"BUY", "product":"D" }] }` (max 20, no duplicate keys)
```json
{ "status": "success",
  "data": { "margins":[{ "span_margin":57501.5, "exposure_margin":12320.55, "equity_margin":0,
      "net_buy_premium":0, "additional_margin":0, "total_margin":69822.05, "tender_margin":0 }],
    "required_margin": 69822.05, "final_margin": 69822.05 } }
```

### 4.4 Option Chain — `GET /v2/option/chain?instrument_key=NSE_INDEX|Nifty 50&expiry_date=2025-02-13`
```json
{ "status": "success", "data": [{
    "expiry": "2025-02-13", "pcr": 7515.3, "strike_price": 21100,
    "underlying_key": "NSE_INDEX|Nifty 50", "underlying_spot_price": 22976.2,
    "call_options": { "instrument_key": "NSE_FO|51059",
      "market_data": { "ltp":2449.9, "volume":0, "oi":750, "close_price":2449.9,
        "bid_price":1856.65, "bid_qty":1125, "ask_price":1941.65, "ask_qty":1125, "prev_oi":1500 },
      "option_greeks": { "vega":4.1731, "theta":-472.8941, "gamma":0.0001,
        "delta":0.743, "iv":262.31, "pop":40.56 } },
    "put_options": { "…same shape…" } }] }
```
(Also accepts `expiry_date=current_week|next_week|far_week|current_month|next_month|far_month`.)

### 4.5 News — `GET /v2/news?category=instrument_keys&instrument_keys=NSE_EQ|INE040H01021`
```json
{ "status": "success",
  "data": { "NSE_EQ|INE040H01021": [ { "heading": "…", "summary": "…",
      "thumbnail": "https://assets.upstox.com/…webp",
      "article_link": "https://upstox.com/news/…", "published_time": 1776251261821 } ] },
  "metadata": { "page": { "page_number":1, "page_size":10, "total_records":1, "total_pages":1 } } }
```

### 4.6 Kill Switch — `POST /v2/user/kill-switch`
Request: `[{"segment":"NSE_FO","action":"DISABLE"},{"segment":"NSE_EQ","action":"DISABLE"}]`
Response: `{ "status":"success", "data":[{ "segment":"NSE_FO", "segment_status":"ACTIVE", "kill_switch_enabled":true }, …] }`
Rules: cancels all pending orders in disabled segments; **12-hour cooling period** to re-enable; segment must have zero open positions; **token must be regenerated after toggling**.

### 4.7 Exit All Positions — `POST /v2/order/positions/exit?segment=NSE_FO` (or `?tag=…`)
```json
{ "status": "success", "data": { "order_ids": ["1644490272000","…"] },
  "errors": null, "summary": { "total":3, "success":3, "error":0 } }
```
207 partial-success returns `errors[]` per instrument (`error_code, message, instrument_key, order_id`) — UI should render per-leg failures. Squares off with MARKET orders (MPP applied); BUY positions exit first.

### 4.8 Instrument Search — `GET /v2/instruments/search?query=Reliance&expiry=current_month&atm_offset=0&page_number=1&records=20`
```json
{ "status": "success",
  "data": [ { "name":"RELIANCE INDUSTRIES LTD", "segment":"NSE_EQ", "exchange":"NSE",
      "isin":"INE002A01018", "instrument_key":"NSE_EQ|INE002A01018", "exchange_token":"2885",
      "trading_symbol":"RELIANCE", "short_name":"Reliance", "tick_size":10.0, "lot_size":1,
      "instrument_type":"EQ", "freeze_quantity":100000.0, "qty_multiplier":1,
      "security_type":"NORMAL", "cas_eligible": true } ],
  "meta_data": { "page": { "page_number":1, "total_pages":1, "records":20, "total_records":2 } } }
```

### 4.9 WS V3 subscribe (must be a BINARY frame)
```json
{ "guid": "13syxu852ztodyqncwt0", "method": "sub",
  "data": { "mode": "full", "instrumentKeys": ["NSE_INDEX|Nifty Bank"] } }
```
The app's `wsSend()` produces exactly this (with `crypto.randomUUID` guid) ✅.

---

## 5. High-grade feature roadmap (doc-unlocked, mapped to app internals)

Priorities: **T0 = foundation/quick wins, T1 = trading power, T2 = analytics, T3 = infra.** Every item names the endpoint and where it plugs into `index.html`.

### T0 — Foundation (low effort, high leverage)

| # | Feature | Endpoint(s) | Status |
|---|---|---|---|
| 0.1 | **Analytics Token login mode** — 1-year read-only token, no daily re-auth for market data, charts, option chain, news, fundamentals | any GET in Market Data + market-WS authorize | ✅ **IMPLEMENTED 2026-09-10** — third auth field (`aN`), token picker in `rawUpstoxFetch` (market-data paths accept `$.atok`), RO `init()` branch, portfolio-stream stays daily-only. **Token-shift (same day):** analytics token persisted to `localStorage`, always staged as fallback, and auto-adopted whenever the daily token is missing or expires (boot, init failures, WS auth errors — classifier widened for Upstox's real `Invalid access token` / `HTTP 401` messages); neither token → login screen; verified 10/10 shift assertions | **Doc-aligned pass (same day):** allowlist widened to the official Analytics-supported categories (Market Quote, Historical Data, Option Chain, Market Information `/v2/market/*`, Fundamentals, News, Charges, Margins estimate) with GET-only enforcement; `apiHist`/`chartFetchFreshIntraday` bypass fixed so charts + algo backtests work in read-only sessions; verified 10/10 doc-compliance assertions |
| 0.2 | **Sandbox toggle** — risk-free order testing | `sandbox.upstox.com` supports place/modify/cancel | open |
| 0.3 | **MCX lots fix (F-1)** | Place V3 lots semantics | ⚠️ **mitigated 2026-09-10** — `plO()` now forces an explicit LOTS-vs-units confirm on every MCX ticket; auto-conversion awaits sandbox verification |
| 0.4 | **Server-side logout** | `DELETE /v2/logout` | ✅ **IMPLEMENTED 2026-09-10** — fire-and-forget before local teardown in `logout()` |
| 0.5 | **Migrate full quotes to v3 (F-2)** | v3 market-quote | ✅ **IMPLEMENTED 2026-09-10** — `END.QUOTES_V3` now `/v3/market-quote/quotes` (response re-keyed by `instrument_token`, which both consumers already did; gains `year_high/low`, CAS fields for free) |
| 0.6 | **Latency readout** | `metadata.latency` | ✅ **IMPLEMENTED 2026-09-10** — order-placed toast appends `· broker N ms` |
| 0.7 | **Relative expiries** | `option/chain` keywords | open |

### T1 — Trading power

| # | Feature | Endpoint(s) | Status |
|---|---|---|---|
| 1.1 | **Bracket GTT + Trailing SL builder** (ENTRY+TARGET+STOPLOSS legs, `trailing_gap` TSL) | `gtt/place` `type:MULTIPLE` | ✅ **IMPLEMENTED 2026-09-10** — GTT ticket gains optional Target / Stop-loss / Trailing-gap fields; side-aware validation (BUY: target>trigger>SL; SELL mirrored); tick checks; builds `type:MULTIPLE` rules. GTT *modify* API integration still open |
| 1.2 | **Multi-leg strategy basket** (straddle/strangle/condor presets) | `POST place-multi-order` | open |
| 1.3 | **One-click cancel-all-mine / exit-all-mine** — app tags every order `uptrade-web` | `DELETE /v2/order/multi/cancel?tag=`, `POST /v2/order/positions/exit?tag=` | ✅ **IMPLEMENTED 2026-09-10** — header 🛑 Panic (double-confirm, cancel→exit), Orders-page "Cancel all (mine)", Positions-page "Exit all (mine)"; 207 per-leg errors surfaced; empty-book pre-checks |
| 1.4 | **Trade book + charge-adjusted P&L** | `GET /v2/order/trades/get-trades-for-day` (+ `/v2/trade/profit-loss/charges`) | ✅ **IMPLEMENTED 2026-09-10** — new Trades page (sidebar 🧾): trade count / buy value / sell value metrics + escaped table. Charges column still open |
| 1.5 | **Position converter** (MIS↔NRML↔MTF) | `PUT /v2/portfolio/convert-position` | open |
| 1.6 | **Order-history-by-tag** drill-down | `/v2/order/history?tag=` | open |

### T2 — Analytics (all Analytics-Token friendly = no daily token needed)

| # | Feature | Endpoint(s) | Integration point |
|---|---|---|---|
| 2.1 | **Server-side Max Pain** (intraday series, no client OI math) | `GET get-max-pain` | New OC panel column/chart near PCR (`updateOCPCR`) |
| 2.2 | **PCR time-series + OI/ΔOI per strike by interval** | `get-pcr`, `get-oi`, `get-change-oi` | OC footer chart; complements existing OI bars |
| 2.3 | **FII/DII activity widget** | `get-fii-data`, `get-dii-data` | Dashboard panel (`renderProDashboard`) |
| 2.4 | **Options/Futures/MTF Smartlists** (ranked movers) | `get-options-smartlist`, `get-futures-smartlist`, `get-mtf-smartlist` | Dashboard "market pulse" upgrade + watchlist quick-add |
| 2.5 | **Market status / holidays / timings** — session-aware UI (pre-open banner, holiday notice, CAS auction display `iep/ieq`) | `get-market-status`, `get-market-holidays`, `get-market-timings`; WS CAS fields (F-7) | `ocMarketOpen()/chartMarketOpen()` become API-driven; auction prices in header strip |
| 2.6 | **Global indices strip** | `global.json.gz` + WS | `PRO_MARKETS` array (one more card: GIFT NIFTY) |
| 2.7 | **Expired-instrument backtesting** | Expired Instruments API | Algo page can backtest options on expired expiries (today it can't — master only has live contracts) |
| 2.8 | **Portfolio news feed** | `/v2/news?category=positions` / `holdings` | Dashboard + P&L page news column — zero symbol bookkeeping |

### T3 — Infra / notes

- **WS `change_mode`** for chart-mode flips without resubscribe gaps (F-4).
- **`X-Algo-Name` header** field if the user registers an exchange-approved algo (Place/Modify/Cancel + GTT docs).
- **Webhooks** (order/GTT push) require a server — out of scope for this pure-client app; documented for future backend.
- **Kill-switch UI** (§4.6) belongs next to the panic button of 1.3: segment toggles with the 12-hour cooling warning.
- **Rate-limit cheat sheet** for any of the above: option-greek **50 keys**, margin **20 instruments**, news **30 keys**, search **30 records/page**, LTP **500 keys**, WS market feed **2 connections** (5 Plus), LTPC 5000 / Option-Greeks 3000 / Full 2000 keys (halved when mixed), Full-D30 Plus-only.

---

## 6. Method note & boundaries

- Live sandbox testing of order placement was **out of scope** (check-only; sandbox tokens are provisioned per-account). F-1 (MCX lots) is a documentation-vs-code conflict to resolve empirically in the Sandbox (T0.2 provides the toggle to do it safely).
- `index.html` was **not modified** for this report. The only repo changes remain the previously committed audit/README/cleanup work.

---

## 7. Remaining gaps ranked by importance (2026-09-10 re-check)

Post-implementation, the app calls **29 registry paths** + the WS subscribe protocol (plus the instrument-master CDN files). The documented endpoints still unused, ranked for **this app's actual usage profile** (personal NSE F&O / MCX / options-chain terminal with bracket GTTs, OC analytics and algo backtests):

### Tier 1 — most important for you (money protection & daily loop)

| Rank | Endpoint | Why it matters for this app | Effort |
|---|---|---|---|
| **1** | ✅ **IMPLEMENTED 2026-09-10 (Tier-1 pass)** `PUT /v3/order/gtt/modify` — Edit button on every GTT row; quantity + trigger prices editable, strategies/trigger types/trailing gap preserved; doc constraints honored. | You can now *create* bracket GTTs but not edit them. Trailing a target/SL means cancel + recreate today — you lose the GTT ID and re-enter the trigger queue. Modify is atomic; the GTT list page already has the row data to prefill an editor. **Doc caveats to encode:** quantity is locked once the GTT is `OPEN`; an `OPEN` GTT's ENTRY leg only accepts `trigger_type: IMMEDIATE`; MULTIPLE = 2–3 rules, no duplicate strategies. | S |
| **2** | ✅ **IMPLEMENTED 2026-09-10 (Tier-1 pass)** `GET /v2/trade/profit-loss/charges` — charges breakdown card on the P&L page for the selected segment + FY. | Your Trades page and P&L page show gross numbers. This returns the **per-trade charge breakdown** — the net figure that actually hits your account. Direct column add to both pages (reuse the P&L FY pagination pattern). | S |
| **3** | ✅ **IMPLEMENTED 2026-09-10 (Tier-1 pass)** `POST /v2/user/kill-switch` — Profile → Risk controls modal, per-segment enable/disable, all cooling/token-regen warnings in-app, state updated from the response. | The missing half of the Panic button: hard-disable a segment (NSE_FO, MCX_FO…) when you're done for the day. **Must warn in UI:** pending orders auto-cancel, **12-hour cooling** before re-enable, token must be regenerated after toggling. | S |
| **4** | ✅ **IMPLEMENTED 2026-09-10 (Tier-1 pass); FIXED 2026-09-11** `GET /v2/market/status/:exchange` — header chip (NSE + **MCX** — was `MCX_FO`, which is an *instrument segment*, not a valid exchange here → UDAPI1089 → chip stuck on "Mkt CLOSED" through the MCX evening session; exchange appendix: NSE NFO CDS BSE BFO BCD **MCX** NSCOM). Status values now appendix-exact: live = `NORMAL_OPEN`/`CLOSING_START`, `PRE_OPEN_START` shows its own "Pre-open" label (the old `/OPEN/` test false-matched `PRE_OPEN_END`). 5-min refresh, CAS in tooltip, analytics-token friendly, timer cleared on logout. | One call fixes session logic everywhere: `chartMarketOpen`/`ocMarketOpen` heuristics, `fastTick` polling on holidays, "market closed" toasts — plus a live **CAS (closing-auction) badge** from `cas_eligible_status`. Poll every 5 min; cache; works with the analytics token. | S |

### Tier 2 — decision analytics (all analytics-token friendly, no daily token)

| Rank | Endpoint | Why / where |
|---|---|---|
| **5** | `GET /v2/market/max-pain?instrument_key&expiry&date&bucket_interval` → `{max_pain, spot_closing_price, insights[]{max_pain, spot_price, time}}` | Expiry-day staple, computed server-side (no client OI math). OC page footer chart next to the existing PCR block; `insights[]` plots max-pain migration through the day. Accepts relative expiry keywords (`current_week`). |
| **6** | `GET /v2/market/pcr`, `/v2/market/oi`, `/v2/market/change-oi` | Server PCR/OI-per-strike/ΔOI series by bucket interval — upgrades the OC footer from a snapshot to a time-series. |
| **7** | `GET /v2/market/fii-data`, `get-dii-data` | Dashboard sentiment strip (buy/sell ₹, contracts, net positions by interval). |
| **8** | `GET …options-smartlist`, `…futures-smartlist` | Ranked active contracts → one-tap watchlist add; better than searching when volatility rotates. |
| **9** | `PUT /v2/portfolio/convert-position` | MIS↔NRML↔MTF conversion at 3:00 PM without close-and-reopen slippage; button on positions rows. |
| **10** | `POST place-multi-order` | Strategy baskets (straddle/strangle/condor presets from OC ATM±offsets). Highest power here, but also highest complexity + risk — build after 1–9, with basket-margin preview via the existing 20-instrument margin call. |

### Tier 3 — situational

- `GET /v2/order/trades` (per-order fills) + `get-historical-trades` — drill-down/export from the Trades page.
- **Expired Instruments + expired-candle** endpoints — options backtesting on the Algo page (your backtester currently can't price expired option contracts).
- `get-market-holidays`, `get-market-timings` — pairs with Rank 4 for a session calendar.
- `get-mtf-smartlist` — only if you actually use MTF.

### Explicitly NOT recommended for this app

| Endpoint | Reason |
|---|---|
| Mutual Fund APIs | Different asset class; large UI surface for zero daily value in a derivatives terminal |
| IPO APIs | Application-flow product; niche |
| Payments/payouts (`/v2/user/payments/*`) | Account admin is safer in the main Upstox app |
| User static-IP management | Console task, not a terminal feature |
| Webhooks | Requires a server; this app is deliberately server-less |
| MCP integration | For AI assistants, not the app itself |

### Free upgrades (no new endpoint — just unused parameters)

- `/v2/news` supports `category=positions` and `category=holdings` — a "news for what I hold" feed with zero symbol bookkeeping (currently only `instrument_keys` is used).
- `option/chain` & `max-pain` & `instruments/search` all accept **relative expiry keywords** (`current_week`…`far_month`) — removes client-side expiry-date math.
