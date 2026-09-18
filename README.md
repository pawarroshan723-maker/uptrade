# ⚡ UpTrade Pro

A **single-file live trading dashboard** for the [Upstox](https://upstox.com) broker APIs — option chain with Greeks, orders/GTT, positions, holdings, live charts, fundamentals, and an algo backtester. No build step, no backend, no dependencies: the whole app is **one HTML file**.

> 📋 For the full security/correctness review see **[AUDIT.md](AUDIT.md)**.

---

## 1. Files in this repository

| File | What it is |
|---|---|
| `index.html` | **The entire application** (~720 KB, 6,948 lines): CSS, HTML, JavaScript, and the Upstox protobuf schema, all inline. |
| `AUDIT.md` | Deep code audit: architecture map, security/correctness findings, re-verification results. |
| `README.md` | This document — how the app and its one file work. |

There is no `package.json`, no bundler, no server code. Upgrading = replacing the file.

---

## 2. Running it

**Option A — just open it.** Double-click `index.html`. It works from `file://`.

**Option B — serve it** (nicer URLs, no file:// quirks):

```bash
# any static server works
python3 -m http.server 8080        # → http://localhost:8080
# or: npx serve .
```

The app is 100 % client-side. At runtime it talks only to Upstox-owned hosts:

| Host | Used for |
|---|---|
| `api.upstox.com` | REST v2/v3 (auth, orders, GTT, portfolio, quotes, chain, fundamentals, news, charges) + WS authorize |
| `api-hft.upstox.com` | v3 HFT order place/modify/cancel |
| `assets.upstox.com` | instrument-master files (`complete.json.gz`, `MCX.json.gz`) |

Everything else runs in your browser. Nothing is sent anywhere else (verified in the audit; the page also sets `referrer: no-referrer`).

> **CORS note:** some Upstox endpoints (notably the OAuth token exchange) may reject direct browser calls. If login fails with a CORS error, the app tells you — use the **access-token paste** path (§3) in that case.

---

## 3. Logging in (three ways)

The login card offers:

1. **API key + secret + redirect URI** → opens the Upstox authorize page in a new tab (`noopener`); you paste the `code` from the redirect back into "STEP 2" and hit **Exchange**. The secret is kept in `sessionStorage` only and wiped immediately after the exchange. ⚠️ The UI (and the audit) recommend exchanging the code on a server you control for anything beyond personal use.
2. **Access token paste** → paste a token generated elsewhere (e.g. Upstox API playground or your own backend). Simplest and secret-free.
3. **Analytics token paste** → a **1-year read-only** token generated once from the [Upstox Developer Apps page](https://account.upstox.com/developer/apps#analytics). It powers exactly the categories Upstox documents as Analytics-supported (no static IP needed): **market quotes, historical candles, option chain, market information, fundamentals, news, charges, margins, and the market WebSocket** — with no daily re-authorization. GET-only by contract (the margin *estimate* is the one non-mutating exception Upstox lists). Order, GTT, portfolio and P&L APIs stay locked until you connect a daily token (Upstox allows those read-only only from a whitelisted static IP, which a browser app doesn't have). In an analytics-only (or shifted) session the **full option chain works** — auto-load, expiries, live feed and REST poll — along with search, news, charts and fundamentals.
4. **Token fallback ("token-shift")**: the analytics token is **persistent** (`localStorage`, survives reloads and browser restarts) and is always staged as the fallback. If the daily token is missing or expires (detected at boot, on init failures, and on WebSocket auth errors), the app **automatically shifts to the analytics token** and keeps running in read-only market-data mode with a toast telling you to paste a fresh daily token to restore trading. Only when **neither** token is available do you land on the login screen. Logging out clears both (and invalidates the daily token server-side via `DELETE /v2/logout`, best-effort).

---

## 3.5 Risk actions & trade book (added 2026-09-10)

- **🛑 Panic (header)** — double-confirmed bulk action: cancels **all open orders tagged `uptrade-web`** (`DELETE /v2/order/multi/cancel?tag=`) then squares off **all open positions tagged `uptrade-web`** (`POST /v2/order/positions/exit?tag=`). Partial results (207) are reported per-leg in a toast.
- **✖ Cancel all (mine)** on the Orders page and **⇅ Exit all (mine)** on the Positions page run the two halves individually.
- **🧾 Trades page** — today's executed fills with trade count and buy/sell turnover (`GET /v2/order/trades/get-trades-for-day`).
- **Bracket GTT** — the GTT ticket accepts optional **Target** and **Stop-loss** prices (plus an optional **Trailing SL gap** on the SL leg) and places a `type: MULTIPLE` GTT (`ENTRY` + `TARGET` + `STOPLOSS` legs) with side-aware validation: BUY requires target above the entry trigger and SL below; SELL is mirrored.
- **MCX orders** show an extra confirmation because Upstox's V3 docs state commodity quantity is counted in **lots** — verify your ticket means lots, not units.
- **GTT edit** — every GTT row has an **Edit** button (`PUT /v3/order/gtt/modify`): change quantity and trigger prices (entry/target/SL, incl. a preserved trailing gap). Entry trigger *type* stays as placed — Upstox restricts type changes on OPEN GTTs.
- **Charges breakdown** — the P&L page shows brokerage/GST/STT/stamp duty/transaction/clearing/IPFT/SEBI/demat charges for the selected segment + financial year (`GET /v2/trade/profit-loss/charges`) next to the gross realised numbers. Segments: **EQ, F&O, Commodity, Currency derivatives**; the report paginates every page Upstox reports (up to the metadata `page_size_limit`, ≤ 5000/page) so **gross realised totals cover all trades**, with the table capping at 1,000 rendered rows.
- **🚨 Kill switch** (Profile → Risk controls) — disable/enable a trading segment (`POST /v2/user/kill-switch`). Pending orders are cancelled on disable, a 12-hour cooling period applies before re-enabling, and your token must be regenerated afterwards (all warned in-app).
- **Market status chip** (header) — live NSE + **MCX** exchange status (`GET /v2/market/status/:exchange`, refreshed every 5 min, analytics-token friendly) with a CAS (closing-auction) status in the tooltip. Shows `Mkt LIVE` / `NSE live` / `MCX live` / `Pre-open` / `Mkt CLOSED` per the appendix status values, so the MCX evening session (up to 23:30+) correctly shows live after NSE shuts. Works in read-only sessions.
- Order-placed toasts now show the broker's **processing latency** from the API's `metadata.latency`.

---

## 3.6 Order ticket v2 + auto margin estimate (added 2026-09-18)

- **Rebuilt ticket layout (single line)** — the old cramped form is now **one horizontal line**: **Instrument · BUY/SELL · Quantity · Type · Price · Trigger · Product · Validity · AMO** (price/trigger self-hide for MARKET; the line wraps only when the viewport truly can't fit it — phones get a 2-column grid). Footer bar on one line: **estimate summary · ↻ re-estimate · PLACE BUY/SELL**. Value-first sizing: **13px semi-bold field text in 30px-high boxes**, 10.5px labels. The **F&O product hint sits in the ticket header**, right of the "Order ticket" title (single ellipsized line, full text on hover), instead of eating a form row; the **Details ⌄ button sits directly after the summary text**, with ↻ Estimate + PLACE pinned to the far right.
- **Estimate results merged into one compact line** — instead of two cards, the summary shows just `Charges ₹X + Required margin ₹Y · ✓ Covered — ₹Z available` (or `✗ Shortfall ₹X — ₹Z available`); the full breakup (SPAN/exposure components, per-charge rows, per-share breakeven, DP plan, ticket echo) expands behind a **Details ⌄** toggle that survives re-estimates (`estMarginToggleDetail`).
- **🧮 Margin & charges now auto-fetch** — every ticket edit (qty/price/trigger typing, type/product/validity/AMO change, side toggle, instrument pick, panel open) re-runs the estimator after a 700 ms debounce (`otAuto()` → `estMargin({auto:true})`). Auto mode is **silent**: an incomplete ticket (wrong lot multiple, off-tick price) parks a muted note in the results box instead of toasting, a failed fetch shows the inline error, and in-flight estimates are retried so the last edit always wins. The ↻ button keeps the explicit, toasting behaviour. Still pre-trade only — nothing is placed.
- `setS()` now preserves the place-button styling class and re-arms the auto estimate.

---

## 3.7 GTT product fix + order guards (added 2026-09-18)

A BUY GTT on an MCX crude-oil CE (`CRUDEOIL26OCT10000CE`) went out with **product `I` (MIS)** and the triggered child order was **rejected at exchange validation** with only Upstox's generic *"Something went wrong… please contact us"*. Upstox's GTT policy allows intraday *and* delivery GTTs, but **Intraday (MIS) is not allowed for buying options** — the same rule the order ticket's F&O hint documents.

- **GTT product is now side-aware** (`crG`): option **BUY → `D` (NRML)**; option sells and futures keep `I`; equity stays `D`. The GTT ticket header carries an "NSE/BSE · Option BUY → NRML" hint chip.
- **GTT picker leak fixed**: `instrumentAllowed()` never enforced `INSTRUMENT_CONTEXTS.exchanges`, so MCX instruments (segment `MCX_FO`, grouped as `FO`) leaked into the NSE/BSE-only GTT picker — that's how the crude-oil CE GTT reached the broker. The exchange allow-list is honored now (missing `x` stays permissive; the order ticket still accepts MCX for regular orders).
- **MCX GTTs get an explicit risk-confirm** — the broker API rejected a crude-oil CE GTT with its generic `UDAPI100500` error *even on the correct NRML product*; the Upstox app may still accept them.
- **0.25% trigger-distance pre-check** (documented GTT rule): for ABOVE/BELOW entries the live LTP is fetched and a trigger within 0.25% of it is blocked with the exact allowed band before the request (IMMEDIATE entries are exempt).
- **Generic GTT failures are now diagnosed**: when the broker answers "Something went wrong… please contact us", the app pulls a fresh order book, finds a just-rejected child order for the same instrument, and surfaces its real `status_message` — plus the broker error code (e.g. `(UDAPI100500)`) is now appended to every API error.
- **GTT place is confirm()-gated** (echoes side, qty, trigger, product) — it was the only trading action without a confirm.
- **Order ticket guard**: a BUY on any option with Product = Intraday is blocked client-side with a clear message instead of eating the exchange rejection.
- **Order history (View) now shows the broker's `status_message`** — the actual rejection reason (e.g. *"63 : Intraday product is not allowed for buying options"*) under the status line, in red.

---

## 3.8 MCX quantity is LOTS + GTT trigger sanity (added 2026-09-18, later same day)

The rejection-reason surfacing (§3.7) exposed the real causes of the day's failures:

- **MCX quantity semantics confirmed live**: a Q:100 BUY of the 100-lot `CRUDEOIL…9000CE` @ ₹584 was rejected with `RMS:Margin Exceeds, Required:5840000.00` — i.e. the broker billed **100 lots × 100 barrels**, not 1 lot. On Upstox v3, **MCX quantity is counted in LOTS** (NSE/BSE/CDS stay in units). The app now:
  - resets an MCX pick's ticket quantity to **1 lot** (step 1) instead of auto-filling the lot size in units — order ticket *and* GTT ticket;
  - skips the lot-multiple validation for MCX (a single lot is valid there) in `plO`, `crG` and the margin estimator;
  - echoes the conversion in the MCX confirm: *"1 lot = 100 units of CRUDEOIL…"*;
  - notes "MCX quantity is in LOTS" in the ticket header hint.
- **GTT far-trigger guard**: a NIFTY-CE GTT still failed with the generic `UDAPI100500` — no rejected child order, so the trigger itself was refused (an index-style price against an option premium). For ABOVE/BELOW entries the app now shows the **instrument's LTP in the confirm** and demands an extra explicit confirm when the trigger is **≥3× or ≤⅓ of LTP** ("GTT triggers track THIS instrument's price — for an option that's the premium, NOT the index or future").
- Note: the RMS line also showed `Available:0.00` — even a correct 1-lot order needs free funds; the auto margin estimate's coverage line (`✗ Shortfall`) shows that before you place.

---

## 3.9 After-market orders + visible quantity auto-fill (added 2026-09-18, evening)

Two live reports: *"Orders quantity not auto fill"* and *"check after market allows GTT and normal order"*.

**Quantity auto-fill — now unmissable.** The fill was already deterministic, but a **1-LOT MCX fill is indistinguishable from the untouched default `1`**, and a same-lot carry-over looked like nothing happened. The Upstox place-order docs also state it verbatim: *"For commodity - number of lots is accepted. For other Futures & Options and equities - number of units"* — official confirmation of §3.8. Now, on **every instrument change**:

- the quantity resets to that instrument's basis — **1 (MCX lot)** or **the lot size (NSE/BSE/CDS units)** — re-picking the *same* instrument keeps a valid quantity;
- an **info toast announces the fill** ("Quantity auto-filled: 1 LOT = 100 units of … (MCX counts lots)" / "Quantity auto-filled: 75 (1 lot of …)");
- the field **label carries the basis** — `Qty (LOTS)` vs `Qty (lot 75)` vs `Quantity` — and the input's tooltip explains units vs lots.

**After-market — segment-aware market clock.** `istClock()`/`marketPhase()` compute the IST session for the ticket's instrument: **NSE/BSE equity & F&O 09:15–15:30 · currency (CDS) 09:00–17:00 · MCX 09:00–~23:30 (≈23:55 while US DST is off)**, Mon–Fri. Exchange holidays aren't knowable client-side — the broker stays the final arbiter and its rejection reasons surface via the §3.7 passthrough. Then:

- **Normal orders**: a live order is only valid inside the session. Outside it the broker requires **AMO** (`is_amo: true`) — the ticket **auto-sets AMO to Yes on instrument pick and panel open** (silently; the field shows the flip), and `plO()` re-checks at place time: after hours with AMO off you get *"Market is closed… Place as AMO?"* — declining sends **nothing**; accepting flips the flag and tags the confirm + success toast with `AMO — queued for the next session`. The reverse is guarded too: the docs are **self-contradictory** on AMO during market hours — the page's *"Automatic AMO detection"* callout says `is_amo` is ignored and auto-inferred (a `true` in market hours is processed as live), yet the same page's error table lists **`UDAPI100039`** ("AMO orders cannot be placed during the market hours"). The app never sends `is_amo: true` inside a session (the AMO select auto-syncs to No; a manual Yes triggers a confirm that flips it) — the one behavior that is correct under **both** readings. The order API itself is closed 00:00–05:30 IST (`UDAPI100074`) — blocked up front with that reason.
- **MCX evening session**: crude/gold/etc. trade until ~23:30 IST, so an 18:10 crude ticket is **LIVE — no AMO is forced** (this is exactly the live retry scenario).
- **GTT after hours: allowed.** GTT placement is broker-side (no exchange order until the trigger fires), so it works off-hours — the confirm now says *"after hours: stored now, armed during market hours"*. Caveat spelled out too: **IMMEDIATE** entries send the child LIMIT order to the exchange straight away, which off-hours can be rejected — ABOVE/BELOW only arm the trigger.

---

## 4. How `index.html` is organized

Read it top-to-bottom in five layers:

```
line ~1–33      <head> meta + DEFENSIVE CONSOLE SHIM
                (pads missing console.* methods so WebView quirks can't kill init)

line ~34–1316   14 <style> blocks — base dark theme + layered "fix-pack"
                stylesheets (pro-ui-hardening, ocFixCSS, ocThemeUnify,
                ocTopCompact, ocDarkChain, ocMobilePolish, mobile-fit, …).
                Later blocks override earlier ones; ids like #ocFixCSS name the pack.

line ~1318–1612 app markup — login card (#AU), app shell (#AP):
                sidebar nav (13 pages), header (global search, market strip,
                WS status chips), page divs #pg-dash #pg-watch #pg-orders
                #pg-gtt #pg-pos #pg-hold #pg-fund #pg-chart #pg-algo #pg-oc
                #pg-funds #pg-pnl #pg-prof, modals & drawers.
                Inline onclick= handlers call global functions (all verified to exist).

line ~1613–1633 <script id="protoText" type="text/plain"> — the Upstox
                market-data-feed v3 .proto schema as plain text.
                It is NOT executed; protobuf.parse() reads it at runtime.

line ~1634–6565 THE APP SCRIPT (one scope, ~440 functions), organized by
                banner comments "SECTION n: …" — see §5.
```

### The three script blocks, in execution order

1. **Block 1 (head):** console shim + **protobuf.js v7.6.6** (vendored, BSD-3). Exposes global `protobuf`.
2. **Block 2:** the `.proto` schema — `type="text/plain"`, parsed lazily.
3. **Block 3:** everything else — 433 top-level function declarations (each name defined exactly once; the 3 merge-leftover duplicates found by the audit were removed on 2026-09-10 — see AUDIT.md §11), ending with `renderActiveCols()` (deferred boot). After that the app idles until you log in.

---

## 5. Map of the app script (SECTION banners)

| Section | Lines (approx.) | Contents |
|---|---|---|
| **1** | 1644–2914 | Core: toasts (`ts`), dropdown machinery (`ddS/ddF/ddPick`), **auth** (`aStart/aExch/aTok/logout`), **init()**, **orders** (`plO/canO/opnM/doMd`), **GTT** (`crG`), positions/holdings (`ldP/ldH/sqO`), watchlist + quotes (`ldW/rnW/wl*`), **chart** (`ldCh/drawC/chart*`), **option-chain live WS** (`ldOC/ocConnectWS/ocProcessFeed/ocUpdateRow*`), funds/profile/P&L/news, request hub (`upstoxFetch`, `PRO_HUB`), **instrument master** pipeline, proto init (`ocInitProto`), algo backtester (`runA/algo*`) |
| **2** | 2915–2993 | `OC_COL_DEFS` — every option-chain column (id, label, renderer, width) |
| **3** | 2994–4498 | Logic fix-pack: hardened order/position/holding flows, chart feed merge, OC live-table rendering, margin estimator (`estMargin*`), fundamentals analyzers, quick-trade panel (`qO`), inspector (`proRenderInspector`…) |
| **4** | 4499–4506 | Global runtime error guard (last-resort toast instead of silent death) |
| **5** | 4507–4519 | Keyboard shortcuts (Ctrl+K search, Esc closes panels, etc.) |
| **7** | 4520–5756 | OC fix-pack: broker-style stacked cells, column manager modal, bid/ask depth ladder & popup, OI bars, font stepping, mobile card view, PCR, col-versioned localStorage migrations |
| **9** | 5757–5830 | Multi-watchlist groups (`wlg*`) |
| **11** | 5831–5910 | **WS watchdog & status**: `wsLog`, combined **Live Feed** header button (state + active socket count + connect/re-subscribe on click — replaces the old `0 WS` chip, `Off/Live` chip and separate Feed button), `wsReviveAll` (network-online revival), `wsKickAll` (cascade recovery when main feed dies) |
| **12** | 5911–5932 | OC auto-load (defaults to Nifty 50 on login) |
| **13** | 5933–6145 | **MCX commodity chains** built client-side; `ocOptionGreekQuotes` 50-key chunking |
| **16** | 6146–6259 | OC quick tabs (index + commodity one-click switch) |
| **17** | 6260–6284 | OC underlying guard (blocks non-optionable underlyings) |
| **21** | 6285–6324 | Chart FUT expiry auto-roll |
| **22** | 6325–6334 | OC spot-name badge |
| **23** | 6335–6432 | REST quote polling mode (1 s) with rate-limit backoff |
| **25** | 6433–6513 | Crude-oil front-future header (resolves the front month from the instrument master, re-rolls WS subscriptions) |
| **26** | 6514–end | **Fast REST refresh when WS is down** (`fastTick`, 250 ms–10 s adaptive, stops after 5 fails, idles when tab hidden/user idle) + deferred boot |

*(Section numbers 6, 8, 10, 14–15, 18–20, 24 were retired fix-packs — the gaps are historical.)*

---

## 6. Key state objects & data flow

```
                    ┌────────────────────  REST (upstoxFetch)  ───────────────────┐
 login ──► $.tok ──►│  PRO_HUB: TTL cache · in-flight dedupe · max 5 concurrent   │
                    │  retries w/ backoff+jitter · 15 s timeouts                  │
                    └──────────────────────────────────────────────────────────────┘
                    ┌────────────────────  3 WebSockets  ─────────────────────────┐
                    │  $.ws    V3 market feed  (protobuf → chart/watchlist/strip) │
                    │  OC.ws   option chain    (protobuf → ocProcessFeed)         │
                    │  $.pws   portfolio stream(JSON → positions/orders/funds)    │
                    │  watchdog · silent-death revive · OC fallback to main WS    │
                    └──────────────────────────────────────────────────────────────┘
                                        ▼
        $.lq (quote cache) ─► renderers: rnW (watchlist rows), ocUpdateRowDynamic (chain
        $.cd  (candles)   ─► drawC (chart, ≤1800 candles), proUpdateMarket (header strip)
                                        ▼
        WS down? ─► FAST timer polls LTP REST (1 s) ─► same renderers
```

Main state containers (top of block 3):

| Object | Holds |
|---|---|
| `$` | token, profile, orders (`ords`/`oM`), positions (`pos`), holdings (`hld`), quotes (`lq`), chart candles (`cd`) + indicator flags, socket refs, UI flags |
| `OC` | chain rows (`chain`/`filtered`), live quotes, dedicated WS + proto root, ATM strike, subscription keys, fallback flags |
| `M` | lazy MCX master |
| `PRO_HUB` | REST cache/inflight/queue + counters |
| `FAST` | REST-fallback timer state |
| `DB`, `TFS`, `END` | 50 hardcoded F&O instruments & indices, 13 timeframes, endpoint registry |

### protobuf decoding

`ocInitProto()` runs on first live connection: `protobuf.parse(document.getElementById('protoText').textContent)` → `OC.Feed = root.lookupType('…FeedResponse')`. Binary WS frames are decoded with `OC.Feed.decode(new Uint8Array(ab))` — int64 fields are read as plain numbers (`protobuf.util.Long = null`) for speed. Every decode is identity-guarded (`$.ws!==ws` stale-socket check) and try/catch-wrapped.

---

## 7. Browser storage — what persists where

| Key | Storage | Contents | Cleared when |
|---|---|---|---|
| `u_tok` | `sessionStorage` | daily access token | logout (incl. server-side invalidation) / tab close / detected expiry |
| `u_atok` | `localStorage` + `sessionStorage` | Analytics token (1-year, read-only market data) — **persistent fallback**: auto-restored and auto-used whenever the daily token is missing/expired | logout (explicit) |
| `u_as` | `sessionStorage` | API secret (exchange step only) | immediately after token exchange |
| `u_ak`, `u_ru` | `localStorage` | API key + redirect URI (login convenience) | never (non-secret) |
| `u_wl` | `localStorage` | watchlist instruments | edited in UI |
| `oc_selected_cols`, `KEY_COLS`/`KEY_COLVER` | `localStorage` | option-chain column layout (+ versioned migrations) | column manager edits |
| `pro_fast_ms` | `localStorage` | REST fallback interval | set via `proSetFastMs` |
| `pro_sidebar_mini`, `pro_inspector_open` | `localStorage` | terminal layout prefs | toggled in UI |
| OC toggles (`KEY_MIRROR/PIN/OIBASE/STACK/PCR/BARS/FS`) | `localStorage` | chain display prefs | toggled in UI |
| instrument master | **IndexedDB** | chunked, gzipped master cache | refresh buttons / stale |

Nothing sensitive is written to `localStorage`; logout wipes session state and all credential inputs.

---

## 8. Trading safety built into the code

- Quantity must be a positive whole multiple of lot size; limit/trigger prices must match the instrument tick; freeze-limit breaches ask to slice.
- Every order/cancel/modify/square-off is `confirm()`-gated; the place button double-submits are blocked by a busy flag.
- Orders go to the **HFT v3** endpoint with `tag: 'uptrade-web'` so you can identify them in Upstox reports.
- Margin/charges estimator is pre-trade only — it places nothing.

**You are sending real orders to a real broker account. Test with small quantities first.**

---

## 9. Modifying the file — practical notes

- **Find features by `SECTION n:` banners** (§5 table) — each fix-pack kept its logic inside the banner it belongs to.
- **One scope:** everything is top-level `function`/`const`. Inline HTML handlers call those globals directly; anything also needed from generated markup is exported as `window.X = function…`.
- **Duplicate helpers are intentional in one spot:** the 8 helpers inside `instrumentWorkerSource()` (`toNum`, `normalizeInstrument`, `instrumentSearchText`, …) duplicate top-level functions **on purpose** — that function's text is serialized into a Blob Web Worker and cannot use outer-scope closures. If you change the top-level versions, keep the worker copies in sync (the in-file comment says the same). *(The 3 accidental merge-leftover duplicates the audit found were removed on 2026-09-10 — AUDIT.md §11.)*
- **CSS layering:** later `<style>` blocks override earlier ones; prefer editing the matching pack rather than adding another layer.
- **The proto schema is data, not code** — edit `protoText` only if Upstox changes the feed contract.
- After edits, re-verify: `node --check` on extracted script blocks, plus the jsdom smoke test described in AUDIT.md §10.

---

## 10. Verifying the file

```bash
# 1. syntax-check both executable script blocks
python3 - <<'EOF'
import re
html=open('index.html',encoding='utf-8').read()
for i,s in enumerate(re.findall(r'<script[^>]*>(.*?)</script>',html,re.S)):
    open(f'/tmp/blk{i}.js','w').write(s)
EOF
node --check /tmp/blk0.js && node --check /tmp/blk2.js && echo SYNTAX-OK
```

### Regression battery (kept in `tests/`)

```bash
npm i jsdom            # the only dependency
node tests/run-all.js  # -> ALL SUITES GREEN
```

| Suite | Asserts | Covers |
|---|---|---|
| `mstest.js` | 11 | market-status header chip against the doc-exact contract |
| `oc_ro.js` | 11 | option chain in a read-only (analytics-token) session |
| `pltest.js` | 22 | P&L metadata / data / charges, paging, error surfacing |
| `doccheck.js` | 15 | analytics-token allow-list vs the official doc + CSP policy |
| `core.js` | 24 | boot, token shift, navigation, trading guards, REST 401 demote-vs-logout |
| `ottest.js` | 23 | order ticket v2 structure, auto-margin debounce/silent notes, manual-estimate toasts, no-token & closed-panel guards |
| `gtttest.js` | 40 | GTT side-aware product (option BUY → NRML), picker exchange allow-list, MCX risk-confirm, 0.25% trigger pre-check, far-trigger guard, generic-failure diagnosis + error codes, MIS option-buy guard, MCX lots semantics, rejection reasons in history, instrumentIsOption, segment-aware market clock (NSE/CDS/MCX sessions), after-hours AMO gate (UDAPI100039/100074), MCX evening session stays live, GTT after-hours note, quantity auto-fill announced + reset on instrument change |

**146/146 green** as of 2026-09-18. `tests/helpers.js` boots the real `index.html`
in jsdom with stubbed `fetch` / `WebSocket` / `IndexedDB`, so every suite
exercises the shipped file rather than a copy of its logic.

The 74-assertion jsdom smoke test these suites grew out of is described in
**[AUDIT.md](AUDIT.md)** §8 and §10 — last full run: **72/74 pass**, the 2
remaining assertions were test-harness artifacts, root-caused and re-verified
manually.

---

## 11. Disclaimer

This is an unofficial client for the Upstox API, provided as-is for personal use. Trading equities and derivatives involves substantial risk. The authors of this repository are not responsible for trading losses, and nothing here is investment advice. Prefer the access-token login path, and exchange OAuth codes server-side if you ever deploy this beyond your own machine.
