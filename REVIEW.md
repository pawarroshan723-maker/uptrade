# Deep bug & logic review — 2026-10-16

Scope: `index.html` main script (~470 KB) read by hand, ESLint 9 pass, jsdom repros for every fix.
Baseline: all 7 suites green on `072b427`. This review found real defects the earlier AUDIT.md missed.
Fixed items are covered by `tests/regress.js` (29 checks; 15 of them fail on the old code).

## Fixed in this change

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| B1 | **High** | `upstoxFetch` | Retry loop ran for **every** method. A 15 s timeout or lost response on order place/modify/cancel, GTT, exit-all re-sent the order up to 3× (no idempotency key). The loose `rate` regex also re-sent plain 400 rejections such as "…circuit rate band". | Writes retry only on HTTP 429 (not processed). Timeout/network on a write now says "may already have reached Upstox — check the Order Book". GETs keep 3× retry; margin calculator opts in via `_retrySafe`. |
| B2 | Med | `isAuthFailure` | The bare word `expired` made any 4xx like "GTT/order has expired" a **session failure → logout** (repro: token wiped). | For non-401 HTTP errors require an explicit token/session phrase. 401 and 200-with-error-body behave as before (core.js A–I still pass). |
| W1 | Med | `ldWQ` | A 401 "Invalid token…" matched `/invalid/`, so the per-symbol fallback classified **every** watchlist item as invalid/expired, deleted them and persisted the empty list. | Auth failures are excluded from both the batch and per-key checks. |
| W2 | Med | `wlChgPct` | Read `q.cp`, but `$.lq` rows only hold `last_price`/`net_change`. The watchlist **Chg% column was always "-"** and the Chg% sort did nothing. | Derive previous close from `last - net_change`; NaN-safe comparator. |
| N1 | Med | `evaluateTextSentiment` | `lower.includes('ed')` (Enforcement Directorate) tagged almost every headline "regulatory" → 1.5× impact. Bearish phrases ignored both negation and intensifiers ("denies profit falls" scored −5, "sharply plunges" got no boost). | Whole-word catalyst match; `finalWeight = v × mult` with negation = −0.8. |
| B10 | Med | `panicExitAll` | Panic button needed **6** dialogs (2 + 2 inner cancel + 2 inner exit). Declining an inner cancel confirm still ran exit-all. | `cancelAllMine/exitAllMine(skipConfirm)`; panic = its own 2 confirms, aborts if cancel is declined. |
| B11 | Low | `ksSet` | Toast flagged every successful **ENABLE** as "request may have failed". Per Upstox docs `kill_switch_enabled=true` means the switch is *engaged*, so DISABLE→true, ENABLE→false. Also threw a TypeError when `data` was empty. | Compare with the expected state; null-safe. |
| B9 | Low-Med | `wsC` `ws.onclose` | `if(!$.tok)return` skipped backoff reconnect + `wsKickAll` for analytics-token-only sessions. | `!$.tok&&!$.atok`. `proSyncTick` has the same guard fixed. |
| L7 | Med | `ldOC_WS` | No stale-response guard (unlike `ldOC`): a slow chain response for the previous underlying could rebuild keys/WS for the wrong index, and its catch could enable fallback on stale keys. | `chainSeq` check after the await and in the catch. |
| B13 | Low | `pollTick` | The "v2 rejected → greeks" branch ran before the 429 branch; a rate-limit message carrying a `UDAPI…` code switched source instead of slowing the poll. | 429 detected first. |
| B7 | Low-Med | `doMd` | MCX order qty is in lots but the multiple-of-lot check used the unit lot size (qty 1 lot ≠ multiple of 100). | lot = 1 for `MCX_` orders. |
| B8 | Med | `sqO` | Exit slicing was dead code: it read `freeze_quantity` from the position row, which has none, so exits above the freeze limit were never sliced. | Look the freeze up in the instrument master (non-MCX keys; MCX unit semantics unverified). |
| A3 | Low-Med | `algoOnlyClosedCandles` | Daily bars treated the market as closed at 15:31 IST for every exchange → today's partial MCX candle leaked into signals/backtests (look-ahead). | Optional session-close minute; MCX passes 1436. |
| L5 | Low | `wlOrdered` | NaN comparator for quote-less rows. | Mapped to −∞. |

## Open (not changed — need a product decision or live verification)

- **B12 GTT modify (`modG`)**: spreads response-only fields (status, order_id, message…) from the GET into the PUT rules; `gttTickFor` falls back to 0.05 when the master isn't loaded (blocks 0.01-tick equity edits); no side-aware target/stop-loss vs entry check like `crG`. Suggest a field whitelist.
- **B3/B4**: pasting a new token doesn't clear `PRO_HUB.cache`; pasting the Analytics token also drops an active daily session. `logout()` leaves GTT/trades/funds/P&L state and rendered tables (previous user's data can flash on a shared machine) and doesn't reset `$.authShiftAt`/`$.ro`.
- **B5**: the 15 s abort timer is cleared once headers arrive; a stalled `r.text()` body is uncovered (`rawUpstoxFetch`, `apiHist`).
- **B6**: `init()` catch uses `/token|unauthor|401|auth|expired/i` — same looseness as B2.
- **L1** `marketPhase` uses months Mar–Oct for the MCX 23:30 close while `marketHoursOpen` uses Apr–Oct; the real switch follows US DST dates. One shared helper please.
- **L2** `plO`/`crG` compare MCX lots to master `freeze_quantity` (units) with no conversion.
- **L4** `ldPl` has no request-sequence guard. **L6** `chartApplyTick` applies an out-of-order older tick to the latest fixed-interval candle. **L8** `prepareOCChain` centres on the lowest strikes when `underlying_spot_price` is missing.
- **A1** buy-and-hold benchmark starts at `candles[warmup].o` but the first tradable bar is `warmup+1`. **A2** metric field `sharpe` is SQN-like (UI label is right). Weekly/monthly bars are returned unfiltered by `algoOnlyClosedCandles`.
- Equity tick is forced to ₹0.01 for every `_EQ` instrument, ignoring the master (client check is therefore looser than the exchange; harmless but not exact).
- README is stale (says 6,948 lines and no package.json).
- Kill switch: Upstox's community post says `PUT /v2/user/kill-switch`, the API page says `POST`. Worth a live check.

Checked and found correct: indicators, backtest ordering, margin/order-ticket maths, GTT create, OC feed processing/OI baselines, WS watchdog/reconnect, option-chain fallback, P&L pagination, instrument-master worker (identical to main-thread normaliser), search `segments` values (`EQ,FO,CURR,COMM,INDEX` are valid per Upstox docs), fundamentals scoring.

---

# Round 2 deep dive — 2026-10-28

Scope: the pre-ship fixes from the 2026-10-16 review were verified in code, then the
still-open items were re-examined and closed where the broker contract was clear.
Baseline before any edit: **8 suites / 193 checks green** (`node tests/run-all.js`).
Every fix below is covered by `tests/deepdive.js` (originally 36 checks; it now holds
**50** after Round 3, **36 of which fail on the pre-fix file**).

## Fixed in this round

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| B5 | **High** | `rawUpstoxFetch`, `apiHist`, `chartFetchFreshIntraday` | The 15 s abort timer was cleared as soon as the **headers** arrived, so a stalled response *body* left `await r.text()` pending forever. That kept one of `PRO_HUB`'s 5 concurrency slots occupied — five stalls wedged every API call in the app (reproduced: the hub's own watchdog reported "no progress for 34.9 s — reset 9 job(s)"). | The abort budget now covers `fetch()` **and** the body read (`try { r=await fetch(); raw=await r.text(); } finally { clearTimeout() }`). A body-level network error is reported as `Network/CORS error`, not a raw DOMException. |
| CACHE | Med | `upstoxFetch` ×2, `apiHist` | The GET-cache write was gated on `ttl && $.tok`, so **read-only Analytics-token sessions (the 1-year token) never cached anything** — every poll, watchlist refresh and chart reload hit the broker. | Cache under either token. Correctness is preserved because every token transition purges the cache (see B3). |
| B3 | Med | `aTok`, `aExch`, `wsC` demote | A token change kept payloads cached under the **previous** token: pasting a new daily token served the old session's orders/positions/funds for one TTL. | `PRO_HUB.cache.clear()` on any token change (manual paste, OAuth exchange, WS-driven demote). |
| B3 | Med | `aTok` | Pasting the Analytics token while a daily session was live **threw the daily token away** (silent drop into read-only mode). Pasting both fields in one submit silently discarded the Analytics token. | The Analytics token is a *fallback layer*: it is staged (session + localStorage) and the live daily session keeps running; a read-only session starts only when the login screen is showing or no daily token exists. Submitting both fields stages both. |
| B4 | Med | `logout` | The GTT list, kill-switch states, inspector quote, market strip, option-chain strikes/keys, selected instruments, P&L report and **every rendered table** survived a logout, and `$.authShiftAt` kept de-duping 401s for 4 s into the next session. | Logout now resets all of it (state containers + `_ksStates` + rendered `#oTB/#pTB/#hTB/#gTB/#tTB/#plB/#plCh/…#ocBody`, closes any open modal). `OC.*` is cleared too — which also fixes the follow-on bug where `ocAutoInit()` refused to run after a re-login (`OC.underKey` was still set) and the chain page opened empty. |
| B6 | Low-Med | `init()` catch | `/token|unauthor|401|auth|expired/i` classified any error mentioning "expired" as a dead session — an instrument-level "The contract has expired" wiped a healthy daily token. | Reuses the single `isAuthFailure()` classifier introduced in §12, plus the app's own "no access token" pre-flight wording. |
| L1 | Med | `marketPhase`, `marketHoursOpen` | Two different month windows decided the MCX evening close (Mar–Oct vs Apr–Oct) and neither matched reality: the 23:30/23:55 switch follows **US DST** (2nd Sunday of March → 1st Sunday of November). In March the order gate demanded AMO while the feed watchdog still believed the market was open. | One `mcxCloseMinute()` helper (US DST rules) feeds both; a `nthSundayUTC()` helper computes the transition instants. |
| B12 | Med | `modG`, `gttTickFor` | GTT modify spread the **whole GET rule** back into the PUT (`status`, `order_id`, `failure_reason`, timestamps…), fell back to a blanket ₹0.05 tick when the master was not loaded (blocking valid 1-paise equity triggers), and never checked that target/stop-loss sat on the correct side of the entry — the create path (`crG`) does. | `GTT_RULE_FIELDS` whitelist + `gttRulePayload()`; tick resolved from the master (any leg's key) then from the segment (`_EQ` → .01); the same BUY/SELL bracket rule as `crG`; modal `step` follows the tick. |
| L4 | Low-Med | `ldPl`, `ldPlCharges` | No request-sequence guard: flipping segment/FY quickly let a slower, older response repaint over the newer selection's numbers. | `$.plSeq` token; every await (metadata, each page, charges) re-checks it before painting. |
| L6 | Low-Med | `chartApplyTick` | A late tick from an **earlier** bucket was folded into the newest candle (its low/close jumped to the stale price). | A bucket older than the last candle is ignored; the intraday reconcile backfills the true OHLC. Also ignores non-finite tick timestamps. |
| L8 | Low-Med | `prepareOCChain` | With no `underlying_spot_price` every distance was measured from 0, so the ±N window centred on the **lowest** strikes (deep ITM). | Centre on the median strike; the first live spot tick re-centres on the real ATM. |
| A1 | Low | `algoBacktest` | The buy-and-hold benchmark entered at `candles[warmup].o`, but the loop's first tradeable bar is `warmup+1` — the benchmark was shifted by one bar. | Enters at `warmup+1` (bounded), so the benchmark and the strategy share a start. |
| A2 | Low | `algoOnlyClosedCandles` | `weeks` / `months` fell through unfiltered — the still-forming weekly/monthly candle (today's partial data) fed the signals and the backtest. | Drops the candle whose IST period key equals the current one. |

## Still open (unchanged, need broker confirmation or a product decision)

- **L2** `plO`/`crG` compare MCX **lots** to the master `freeze_quantity` (units for NSE; the MCX unit is unverified) — left alone deliberately, a wrong conversion is worse than a conservative slice.
- Kill switch: Upstox's community post says `PUT /v2/user/kill-switch`, the API page says `POST`. Unchanged pending a live check.
- Equity tick is pinned to ₹0.01 for `_EQ` (master says 0.05 for some rows) — deliberate, documented, harmless.
- README is stale (line count, `package.json`).

## Verification

| Check | Result |
|---|---|
| `node --check` on both executable script blocks | PASS |
| Full battery (`node tests/run-all.js`) | **229/229 green across 9 suites** at the end of this round (193 before it) |
| New suite `tests/deepdive.js` | 36 checks added here; all pass, 27 of them fail on the pre-fix file |
| Mutation sanity (each fix reverted in isolation) | body-read timeout removed → 2 fail · MCX close back to a month window → 2 fail · logout resets dropped → 5 fail · GTT rule whitelist + tick fallback reverted → 4 fail |
| Malformed-response fuzz (data = `null`, `[{}]`, garbage strings) across all 14 pages + every `ld*` loader | 0 uncaught errors / rejections |
| Full-page smoke with realistic payloads (14 pages, `opnM`, `estMargin`, `ldOC`, `ldOC_WS`, `ldPl`, `runA`, `loadFundamentals`) | 0 uncaught errors / rejections |

---

# Round 3 deep dive — 2026-10-28 (second sweep)

Same method: read the path, reproduce, write a failing assertion, fix, prove the assertion
now fails on the pre-fix file. `tests/deepdive.js` grew from 36 to **50 checks**; the full
battery is **243/243 green across 9 suites**.

## Fixed in this round

| ID | Sev | Where | Problem | Fix |
|----|-----|-------|---------|-----|
| R3-1 | Med | `chartBucketStart` | Daily/weekly/monthly bars start at the broker's **period start** (IST midnight, Monday, the 1st), but a live tick opened a fresh period bar at the **09:15 session open**. Whenever the current period had no candle yet, a second bar appeared for the same day — with the live LTP as its "open" — and the reconcile could not merge it because it keys on the exact timestamp. | New `chartPeriodStartMs()` anchors new period bars to IST midnight / Monday / the 1st; the same-period fold is unchanged. |
| R3-2 | Med | `algoOnlyClosedCandles`, `runA` | The daily look-ahead guard used one blanket 15:31 IST close for every non-MCX instrument. A **currency (CDS) session runs to 17:00**, so a backtest started between 15:31 and 17:00 folded today's still-forming candle into the signals — look-ahead in the exact place the guard exists to prevent it. | `algoSessionCloseMin(inst)` derives the close from the segment (MCX → `mcxCloseMinute()+1`, CDS → 17:01, NSE/BSE → 15:31); `runA` passes the instrument. |
| R3-3 | Low | `ldPlCharges` | The success path honoured the L4 request ticket, the **error path did not**: a slow failure for the previous segment painted "Charges unavailable" over the card the user had just switched to. | The catch re-checks `seq` before painting. |
| R3-4 | **Med-High** | `sqO` | The single-position **Exit** button always sent `is_amo:false` and never consulted the clock, so pressing it outside the session (or on MCX after 23:30) was rejected by the broker (UDAPI100039) instead of being queued. `plO` has the full gate; this path had none. | Same contract as `plO`: refuse inside the API's 00:00–05:30 window, queue an AMO outside the session with an explicit confirm, keep the live order in session. |
| R3-5 | Low | `proCachePrune` | `proTTL()` caches news for 5 minutes, but the 60 s pruner had no `/news` branch — every news payload was dropped after a minute and each reopen re-hit the broker. | The pruner's TTL table gained the missing `/news` branch. |

## Test-harness bug found while writing R3-4

The earlier MCX block overrode `window.istClock` and cleaned up with `delete window.istClock`.
A global **function declaration** is not configurable, so the delete silently failed and the
frozen clock (23:40 IST, 10 March) leaked into every later test — which is why the first
version of the R3-4 checks disagreed with the app. The suite now saves and restores the
function; any future clock-dependent assertion must do the same.

## Still open (unchanged)

- **L2** MCX lots vs the master `freeze_quantity` unit basis (needs broker confirmation).
- Kill-switch verb (`PUT` vs `POST`) — needs a live check.
- Tick pinned to ₹0.01 for `_EQ` — deliberate and correct for NSE cash, kept.

## Verification

| Check | Result |
|---|---|
| Full battery (`node tests/run-all.js`) | **243/243 green, 9 suites** |
| `tests/deepdive.js` on the pre-fix file | **36 FAIL / 14 PASS** (the 14 are controls) |
| Mutation sanity (each fix reverted in isolation) | body-read timeout → 2 fail · MCX month window → 2 fail · logout resets → 5 fail · GTT whitelist/tick → 4 fail |
| Malformed-payload probe over 14 pages + 20 loaders | 0 uncaught errors / rejections |
