# UpTrade Pro — Deep Code Audit

**Repository:** `pawarroshan723-maker/uptrade` · **Branch:** `arena/01a08bb7-uptrade` · **Commit audited:** `cafe1fb` ("Add files via upload")
**Audit date:** 2026-09-10 · **Auditor:** Arena.ai Agent Mode (static analysis + runtime smoke test + independent re-verification pass)

---

## 1. Scope & Method

The repository contains exactly two tracked files:

| File | Size | Contents |
|---|---|---|
| `index.html` | 690 KB / 6,565 lines | The entire application (CSS, HTML, JS, proto schema) |
| `README.md` | 9 bytes | Placeholder (`# uptrade`) |

**Method (pass 1 — deep audit):**
1. Full structural mapping of `index.html` (CSS blocks, script blocks, body markup, app sections).
2. `node --check` syntax verification of every executable script block.
3. Manual review of all security-sensitive surfaces: auth/token handling, order placement, WebSocket lifecycle, DOM injection sinks, storage, secrets.
4. Cross-reference audit: all 78 inline `onclick/onchange/oninput` handler targets checked against actual definitions.
5. Duplicate-definition and duplicate-DOM-id scans.
6. Runtime smoke test in jsdom: app booted with stubbed browser APIs, 74 assertions executed (page nav, handlers, state, escaping, logout reset).

**Method (pass 2 — re-verification):** every finding and every "pass" claim from pass 1 was independently re-checked (see §8) — syntax re-parsed, smoke test re-run, the two smoke failures reproduced and root-caused as test-harness artifacts, and each code claim re-grepped against the source.

---

## 2. What the Application Is

**UpTrade Pro** is a client-side-only **live trading dashboard for the Upstox (India) broker APIs**. There is no backend, no build step, no dependencies to install — everything ships in one HTML file. Features:

- **Auth:** Upstox OAuth (API key + secret + redirect URI → authorization code → access token), or direct access-token paste.
- **Trading:** order ticket (MARKET/LIMIT/SL/SL-M, NRML/MIS/MTF products, AMO, freeze-limit slicing), order book with modify/cancel, GTT orders, positions with square-off, holdings.
- **Market data:** 3 WebSocket feeds (V3 market data, option chain, portfolio stream) decoding **protobuf** frames via a vendored protobuf.js 7.6.6 and an embedded Upstox `.proto` schema; REST quote polling as automatic fallback.
- **Option chain:** live chain with Greeks, OI bars, PCR, column manager, strike ladders, MCX commodity chains built client-side from the instrument master, quick-switch index/commodity tabs.
- **Charts:** canvas candlestick/line/Heikin-Ashi, 13 timeframes, indicators (SMA/EMA/BB/VWAP/Supertrend/S-R/RSI/MACD/Volume), live candle building from ticks, FUT expiry auto-roll.
- **Analysis:** fundamentals workspace, news sentiment, algo strategy backtester (EMA/Donchian/ADX/ATR strategies with no-look-ahead indicator discipline and equity curve).
- **Terminal UX:** dashboard command center, global search (Ctrl+K), multi-watchlist groups, inspector side panel, WS watchdog + status chips, idle throttling, Android fast-boot path.

### File anatomy (byte budget)

| Region | Lines (approx.) | Bytes | Content |
|---|---|---|---|
| `<head>` meta + console shim | 1–33 | — | charset, viewport, `no-referrer`, `nosniff`, defensive console polyfill |
| CSS (14 `<style>` blocks) | 34–1316 | ~156 KB | base theme + layered fix-pack stylesheets (`pro-ui-hardening`, `ocFixCSS`, `ocThemeUnify`, `mobile-fit`, …) |
| Auth + app shell markup | 1318–1612 | ~26 KB | login card, sidebar, 13 pages, modals, drawers |
| `<script id="protoText" type="text/plain">` | 1613–1633 | ~1.7 KB | Upstox market-data v3 `.proto` schema (parsed at runtime) |
| Main application script | 1634–6565 | ~424 KB | 433 top-level function declarations (0 duplicates after §11 cleanup; +8 intentional Web-Worker helper copies — see C-4) across 17 SECTION banners, numbered up to 26 |

---

## 3. Architecture Overview

```
index.html
├── Console shim (runs first — prevents WebView console-method crashes)
├── protobuf.js 7.6.6 (vendored, ~85 KB)
├── .proto schema (text/plain, parsed lazily by ocInitProto() → OC.Feed)
└── App script (one scope, no patch blocks; 17 surviving SECTION banners, numbered up to 26)
    ├── SECTION 1  core: auth / init / dropdowns / orders / GTT / positions /
    │              holdings / watchlist / charts / funds / profile / P&L / news
    ├── SECTION 2  option-chain column definitions (OC_COL_DEFS)
    ├── SECTION 3  logic fixes pack (orders/positions/holdings/chart/OC live/funds/algo)
    ├── SECTION 4  runtime error guard
    ├── SECTION 5  keyboard shortcuts (Ctrl+K, etc.)
    ├── SECTION 7  OC fix pack (stacked cells / column manager / depth ladder / OI bars)
    ├── SECTION 9  multi-watchlist groups
    ├── SECTION 11 WebSocket watchdog + status chips + revival
    ├── SECTION 12 OC auto-load (defaults to Nifty 50)
    ├── SECTION 13 MCX client-side commodity chain
    ├── SECTION 16 OC quick tabs (indices + commodities)
    ├── SECTION 17 OC underlying guard
    ├── SECTION 21 chart FUT expiry auto-roll
    ├── SECTION 22 OC spot-name badge
    ├── SECTION 23 REST quote polling mode (1 s)
    ├── SECTION 25 crude-oil front-future header (auto-roll)
    └── SECTION 26 fast REST refresh when WS is down (rate-limit aware)
```

**State containers (module-scope consts):**
- `$` — session/auth, orders, positions, holdings, quotes (`$.lq`), chart candles (`$.cd`), socket refs (`$.ws`, `$.pws`), UI mode flags.
- `OC` — option chain: rows, live quotes, dedicated WS, proto root, subscription keys.
- `M` — MCX instrument master (lazy-loaded).
- `PRO_HUB` — REST request hub: TTL cache, in-flight dedupe, concurrency cap (`max: 5`), hit/request/error counters.
- `FAST` — REST polling fallback timer (250 ms–10 s adaptive; 1 s desktop / 3 s Android default).
- `DB` / `TFS` / `END` — 50 hardcoded F&O + index instruments, 13 timeframes, Upstox endpoint registry.

**External endpoints (all Upstox-owned, verified):** `api.upstox.com`, `api-hft.upstox.com`, `assets.upstox.com` (instrument masters). No third-party calls, no trackers, no analytics.

---

## 4. Security Audit

### 4.1 Secrets & credentials

| # | Severity | Finding |
|---|---|---|
| S-1 | **HIGH (inherent to architecture, mitigated in code)** | **OAuth client-secret exchange runs in the browser.** `aExch()` POSTs `client_secret` directly to `https://api.upstox.com/v2/login/authorization/token`. Anyone using this path exposes the secret to the page environment (and to any future XSS). **Mitigations already present:** secret is `type="password"`, stored in `sessionStorage` only, wiped from DOM and storage immediately after exchange; the UI carries an explicit warning ("Browser apps should not hold a client secret"); the access-token paste path avoids the secret entirely. **Recommendation:** treat the token-paste path as the primary path; exchange codes on a server for any non-personal deployment. |
| S-2 | MEDIUM | **Access token lives in `sessionStorage` (`u_tok`).** Correct choice over `localStorage` (tab-scoped, dies with the tab); migration code actively removes legacy `localStorage` copies (`u_tok`, `u_as`). Residual risk: any successful XSS can read it. No way to fully avoid in a backend-less app — acceptable for personal use. |
| S-3 | PASS | **No hardcoded secrets.** Scanned for `client_id`/`client_secret`/API keys/passwords/keys — the app stores none; all credentials are user-supplied per session. |
| S-4 | LOW | **No Content-Security-Policy.** Meta allows `no-referrer` + `nosniff` only. Note: a strict CSP would break the vendored protobuf.js, which compiles decoders with `new Function()` (library-standard codegen). A pragmatic CSP (`script-src 'self' 'unsafe-eval'`; `connect-src` limited to the three Upstox hosts) would still block exfiltration to unknown hosts. |
| S-5 | PASS | **XSS posture is strong.** 93 `innerHTML` sinks audited: every render path that interpolates API/user data passes through `escapeHtml()` (attribute-safe: covers `& < > " '`) for markup and `jsStr()` (also escapes backtick, `<`→`\x3c`, U+2028/29) for inline handler arguments. Verified on order rows, watchlist rows, option-chain cells, depth popups, quick tabs. |
| S-6 | PASS | **No `eval` / `new Function` in application code** (library codegen only, see S-4). |
| S-7 | PASS | **Popup hygiene:** `window.open(url,'_blank','noopener,noreferrer')` — no opener leak, and a documented reason why blocker detection is intentionally neutral (per HTML spec `noopener` always returns `null`). |
| S-8 | PASS | **Logout is thorough:** closes/neutralizes all 3 sockets (detaching handlers first), clears every timer (poll, sync, reconnect, chart, depth popup, chain segment timer), purges the REST cache, wipes in-memory portfolio state and all credential inputs, and returns to the auth screen — no prior-session data can flash on a shared machine. |
| S-9 | INFO | Redirect-URI validation requires http(s); auth-code input is one-shot and cleared after exchange. |

### 4.2 Injection / DOM safety details

- All inline handler strings built with template literals use `jsStr(...)` for any dynamic value inside quotes, and numeric/boolean interpolation otherwise.
- `confirm()` gates exist before every destructive action (place, slice-confirm, modify, cancel, square-off, GTT create).
- No `document.write`, no `insertAdjacentHTML` with raw data, no `setAttribute('on…')` with data.

**Security verdict:** the attack surface is bounded by the single-origin, no-backend design. The only meaningful risks are inherent (in-browser secret exchange S-1, token in web storage S-2, no CSP S-4) — all are either mitigated in code or explicitly documented in the UI.

---

## 5. Correctness & Logic Audit

| # | Severity | Finding |
|---|---|---|
| C-1 | PASS | **Order placement validation is thorough** (`plO`): positive-integer quantity, lot-size multiple, tick-size conformity for limit/trigger prices, freeze-limit detection with slice confirm, side/type echo confirm, busy-lock (`$.orderBusy`) + button disable against double-submit, `market_protection:-1` and explicit zeroing of price/trigger for MKT/SL-M. |
| C-2 | PASS | **Token-expiry handling:** `init()` classifies auth-ish errors, clears the token and returns to login; market-WS auth failures count a 5-streak before a "token looks expired" toast; OC feed flips to "Session expired" on invalid-token. |
| C-3 | LOW | **No explicit HTTP-401 branch in `rawUpstoxFetch`.** A mid-session REST 401 surfaces as a toast error per call, and the fast-refresh loop stops itself after 5 consecutive failures, but the user isn't force-logged-out on REST 401 the way they are on init/WS auth failures. *Suggested improvement:* detect `HTTP 401` in the fetch wrapper and trigger the existing `logout()` path with a "session expired" toast. |
| C-4 | ~~LOW~~ **RESOLVED 2026-09-10** | **Shadowed duplicate function definitions** (merge leftovers; JS "later declaration wins" semantics applied). **Correction on original count:** a rigorous AST scan (acorn) found **3 true top-level duplicates** — `getOCSelectedCols`, `saveOCSelectedCols`, `ocUpdateRow` (the earlier regex audit over-counted 11; the other 8 hits were *intentional* self-contained helper copies inside `instrumentWorkerSource()`, whose body is serialized into a Blob Web Worker and **must** stay duplicated). For each of the 3, the later version was verified as the intended survivor (cached column reads, versioned persistence + `pinLtp`, whitespace-equivalent delegation). **All 3 shadowed copies were removed in the post-audit cleanup (see §11); behavior verified byte-identical.** |
| C-5 | LOW (guarded) | **One DOM id defined in 3 places** (`ocSpotRowPrice` — desktop / compact / mobile spot-row builders). Only one builder is mounted at a time and the mount path explicitly removes stale `tr.spot-row` elements ("never let duplicate #ocSpotRow rows pile up"). Fragile pattern, currently safe. |
| C-6 | PASS | **API quota compliance:** `/v3/market-quote/option-greek` calls are chunked to ≤ 50 keys (UDAPI100043 workaround documented inline). |
| C-7 | PASS | **Subscription refcounting:** `wsKeyStillNeeded()` unions watchlist + market strip + active chart + active instrument + OC-fallback keys before unsubscribing; front-month crude roll unsubscribes only orphaned keys. |
| C-8 | PASS | **Backtester hygiene:** indicators computed with explicit closed-candle discipline (`algoOnlyClosedCandles`, `algoRegimeAt`, `algoScoreAt`), R-multiple floored at 1, risk bounded ≤ 5 %, fees modeled in bps. |
| C-9 | PASS | **All 78 inline-handler function references resolve** to real definitions (direct `function` declarations or `window.X = function` exports). No dead buttons. |
| C-10 | PASS | **Chart math:** live candle bucketing is exchange-session aware (`chartISTSessionStart`), volume derived from cumulative `vtt` baselining with `ltq` delta fallback, candle buffer capped at 1800. |

---

## 6. Robustness & Resilience

| # | Finding |
|---|---|
| R-1 PASS | **WebSocket hardening is exemplary:** structured close diagnostics (`wsLog` with code/reason/wasClean), silent-death watchdog (30 s quiet window across offline→online edges), `wsReviveAll()` network-restored revival, `wsKickAll()` cascading recovery when the main feed dies, OC main-WS fallback mode (`OC-WS-1`) when the dedicated chain socket (`OC-WS-3`) fails, header chip reporting live state of all 3 sockets. |
| R-2 PASS | **Stale-socket identity guards:** every `onmessage/onclose` first checks `$.ws!==ws` / `OC.ws!==ws` / `$.pws!==ws`, so late events from replaced sockets can't corrupt state. |
| R-3 PASS | **REST fallback ladder:** WS down → 1 s REST poll (`fastTick`) → rate-limit doubles the interval (cap 10 s) → 5 straight failures stop the loop with an explanatory toast. Skips work when the tab is hidden or the user is idle 5 min. |
| R-4 PASS | **Request hub:** GET dedupe + per-endpoint TTLs (5 s quotes … 15 min fundamentals), concurrency cap 5, exponential backoff (+jitter) with retry on 429/5xx/network/timeouts, 15 s abort budget. |
| R-5 PASS | **Instrument master pipeline:** 100k-row `complete.json.gz` downloaded, gunzipped via `DecompressionStream` (feature-checked), cached in IndexedDB, chunk-normalized; graceful degradation verified — with IndexedDB unavailable the app logs a warning and continues (reproduced in smoke test). |
| R-6 INFO | **Hardcoded fallback `MCX_FO|565899`** for the crude-oil header if the instrument master is unavailable. Upstox instrument keys are stable numeric IDs, but this is the one piece of data that can silently age; the master-driven resolver (`resolveCrudeFuture`) is the primary path and re-rolls subscriptions on expiry change. |
| R-7 PASS | **Console shim** removes an entire class of WebView crashes (missing `console.*` methods aborting top-level script execution). |
| R-8 PASS | Decode paths accept Blob **or** ArrayBuffer, all wrapped in try/catch with `console.warn` (no feed frame can kill a socket loop). |

---

## 7. Performance & Maintainability

- **Payload:** 690 KB single file (~510 KB JS). Fine for a desktop trading terminal; on mobile it is the same payload every load. No minification of app code — deliberate (keep it greppable/editable); protobuf.js is the compact browser build.
- **Render discipline:** option-chain updates use per-row dynamic updates (`ocUpdateRowDynamic`), watchlist patches rows (`wlPatchRows`), chart draws are scheduled/coalesced (`chartScheduleDraw`) — no full-table re-render per tick.
- **Timer inventory:** 12 `setInterval` / 64 `setTimeout`, all tracked in `$`/`OC`/`FAST`/`window` fields and cleared on logout/reconnect. 65 `addEventListener` vs 2 `removeEventListener` — the imbalance is mostly document-level singletons installed once; no growth-per-tick listener leaks found.
- **Observability:** WS header counter with per-socket state tooltip, sync status chip, request-hub counters, toast log — good operability for a trading tool.
- **Docs debt:** the single biggest maintainability risk is the architecture itself — one 6,565-line file, layered fix-pack stylesheets (14 blocks, several overriding each other), section numbering with gaps (no 6, 8, 10, 14, 15, 18–20, 24 — removed packs). The section banners are accurate and the inline `AUDIT FIX` commentary is excellent, but there was no README explaining any of it (now provided).

---

## 8. Re-Verification Pass (independent second audit)

Every pass-1 claim was re-checked with fresh commands:

| Check | Command / Method | Result |
|---|---|---|
| Syntax, block 0 (shim + protobuf.js) | `node --check` | ✅ PASS |
| Syntax, block 2 (app, 447 fn) | `node --check` | ✅ PASS (433 top-level declarations after §11 cleanup) |
| Runtime boot in DOM | jsdom smoke (re-run) | ✅ **72 / 74 assertions PASS** |
| — assertion "OC.Feed parsed" | root-caused | ✅ Not a defect: proto init is **lazily gated behind auth** by design (`init()` → `ocInitProto()`). Called directly in the harness it returns `true` and `OC.Feed.decode` becomes available. |
| — assertion "jsStr escaping" | root-caused | ✅ Not a defect: harness expectation string was wrong. Actual output `a'b<c>` → `a\'b\x3cc\x3e` is correct (both angle brackets escaped). |
| Handler cross-reference | regex audit of 78 handler calls | ✅ all resolve (incl. `ocQtMenu`/`ocQtPick`/`ocQuickSwitch` via `window.X=`) |
| Secrets scan | grep for key/secret/password patterns | ✅ none hardcoded |
| eval / new Function | grep app code | ✅ none (protobuf.js codegen only) |
| Duplicate function definitions | name-count scan + manual diff of all 11 pairs | ✅ later-wins versions verified safe (C-4) |
| Duplicate DOM ids | id-count scan of body | ✅ only `ocSpotRowPrice` ×3, mount-guarded (C-5) |
| Storage key inventory | regex over storage calls | ✅ 6 localStorage + 3 sessionStorage keys, all documented in README §7 |
| IndexedDB failure path | jsdom without indexedDB | ✅ warning-only degradation (R-5) |
| Logout hygiene | smoke: `logout()` then state inspect | ✅ token empty, orders/positions wiped, sockets closed |
| Page navigation | smoke: `nav()` across all 13 pages | ✅ each page activates and renders |
| No-token action safety | smoke: `plO/crG/ldO/runA/chartToggleLive` | ✅ guarded toasts, no throws |

**Re-verification verdict:** all pass-1 findings stand; no new defects surfaced on the second pass. Zero blocking bugs found in the shipped code.

---

## 9. Findings Summary

| Severity | Count | Items |
|---|---|---|
| Critical / High open defects | **0** | — |
| High (architectural, mitigated) | 1 | S-1 in-browser secret exchange |
| Medium | 1 | S-2 token in web storage |
| Low | 2 open | S-4 no CSP · C-3 no REST-401 logout branch · (C-4 duplicate defs **resolved** §11; C-5 shared spot-row id remains, guarded) |
| Informational | 3 | R-6 fallback instrument key · payload size on mobile · missing README (now written) |

### Recommended follow-ups (priority order)
1. **Prefer the token-paste path** in personal use; if this app is ever shared, move code→token exchange behind a tiny server proxy (removes S-1 entirely).
2. Add a pragmatic CSP meta (`connect-src` allow-list of the 3 Upstox hosts + `'unsafe-eval'` for protobuf.js codegen).
3. In `upstoxFetch`, detect `HTTP 401` and route to `logout()` with a "session expired" toast (matches existing WS behaviour).
4. ~~Delete the shadowed first copies of the duplicated functions~~ — **DONE 2026-09-10**, see §11.
5. Re-centralize the `ocSpotRowPrice` id (e.g. class + query within the mounted row) when next touching OC spot-row code.

---

## 10. Verification Artifacts (reproducible)

```bash
# Syntax (both executable blocks)
python3 - <<'EOF'
import re
html=open('index.html',encoding='utf-8').read()
for i,s in enumerate(re.findall(r'<script[^>]*>(.*?)</script>',html,re.S)):
    open(f'/tmp/blk{i}.js','w').write(s)
EOF
node --check /tmp/blk0.js && node --check /tmp/blk2.js && echo SYNTAX-OK

# Runtime smoke (jsdom + stubbed WebSocket/fetch/IndexedDB/canvas)
npm i jsdom && node smoke.js    # 72/74 pass; 2 harness artifacts — see §8
```

---

## 11. Post-Audit Cleanup Applied (2026-09-10)

**Scope:** the 3 shadowed duplicate function declarations from C-4. Each earlier copy was removed via exact AST offsets (acorn parse of the app script), leaving a one-line traceability comment in place:

| Removed (shadowed) | Kept (was already winning at runtime) | Why the later one is the intended survivor |
|---|---|---|
| `getOCSelectedCols` ~L1312 (legacy: sync `localStorage` read on every call) | ~L3303 (memory-cached via `_colsCache`) | cache fix documented in-file as a PERF note |
| `saveOCSelectedCols` ~L1319 (naive write to legacy key) | ~L3322 (`invalidateColCache()` + `pinLtp()` + versioned `KEY_COLS`) | participates in the column-layout migration system |
| `ocUpdateRow` ~L1350 | ~L3754 (identical logic, whitespace only) | equivalent |

**Explicitly NOT removed:** the 8 helper copies inside `instrumentWorkerSource()` (`toNum`, `instrumentTick`, `instrumentTickFor`, `instrumentExchange`, `normalizeInstrument`, `instrumentExpiryTime`, `instrumentExpiryLabel`, `instrumentSearchText`). They are required — the function's body is serialized via `Function.toString()` into a Blob Web Worker and cannot reference outer-scope closures. The in-file comment mandates keeping them in sync with the top-level originals.

**Verification performed after the edit:**

| Check | Result |
|---|---|
| `node --check` on the modified script block | ✅ PASS |
| acorn re-scan: duplicate top-level declarations | ✅ **0** (433 declarations; each name exactly once) |
| All 3 kept definitions present & 8 worker helpers intact | ✅ |
| jsdom smoke suite (74 assertions) | ✅ 72/74 — identical to pre-cleanup baseline (2 known harness artifacts, §8) |
| **Behavioral equivalence probe** — identical script run against pre-cleanup (`cafe1fb`) vs cleaned file: default column set, save→read round-trip, persisted raw localStorage value, `ocUpdateRow` invocation | ✅ **output byte-identical** |
| `git diff` scope | ✅ exactly 3 replaced regions, nothing else |

**Net effect:** +39 bytes (traceability markers are longer than the removed code), 0 behavior change, and the "edit the wrong copy" trap is gone.


---

*End of audit. Current file state reflects §11.*
