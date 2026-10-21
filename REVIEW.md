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
