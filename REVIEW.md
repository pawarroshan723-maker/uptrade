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

- ~~**B12** GTT modify~~ — fixed 2026-10-31 (M7/M8/M9): whitelisted body, tick from DB/watchlist/segment, side-aware target–stop–entry validation, OPEN quantity locked.
- ~~**B3/B4** token/logout hygiene~~ — fixed (M21/M22/M27): cache cleared on token change, full logout wipe, both-token paste, analytics token no longer demotes a live session.
- ~~**B5** abort budget~~ — fixed (M26).
- ~~**B6** `init()` catch~~ — fixed (M23).
- ~~**L1** MCX close month windows~~ — fixed (M24): one `mcxCloseMinute()` on real US DST.
- **L2** `plO`/`crG` compare MCX lots to master `freeze_quantity` (units) with no conversion — still open.
- ~~**L6** out-of-order tick~~ fixed (M14). ~~**L8** off-spot ATM~~ fixed (M18). **L4** `ldPl` still has no request-sequence guard.
- ~~**A1** buy-and-hold anchor~~ fixed (M17). ~~**A2** weekly/monthly in-progress bars~~ fixed (M15). The `sharpe` field is SQN-like by design — the UI already says "SQN-like score".
- Equity tick is forced to ₹0.01 for every `_EQ` instrument, ignoring the master (client check is therefore looser than the exchange; harmless but not exact).
- README is stale (says 6,948 lines and no package.json).
- Kill switch: Upstox's community post says `PUT /v2/user/kill-switch`, the API page says `POST`. Worth a live check.

Checked and found correct: indicators, backtest ordering, margin/order-ticket maths, GTT create, OC feed processing/OI baselines, WS watchdog/reconnect, option-chain fallback, P&L pagination, instrument-master worker (identical to main-thread normaliser), search `segments` values (`EQ,FO,CURR,COMM,INDEX` are valid per Upstox docs), fundamentals scoring.

---

# Menu-by-menu deep dive — 2026-10-31

Scope: every sidebar page audited end-to-end against the live code path it calls
(Dashboard, Watchlist, Orders + order ticket/history, GTT + GTT modify, Trades,
Positions, Holdings, Fundamentals, Chart, Algo, Option Chain, Funds, P&L, Profile),
plus the boot/session layer those pages depend on.

Method:
1. Static pass per menu: renderers, loaders, handlers, API schemas, state keys.
2. Two jsdom harnesses: one boots the real `index.html` with doc-shaped fixtures
   for all 29 endpoints and walks every menu; the other replays each loader with
   malformed payloads (`data:null`, `data:{}`, rows missing every field, string
   numbers, HTTP 500) and scans the rendered text for `NaN`/`undefined`/`Infinity`.
3. Numeric probes for indicator/backtest/OC math and session-clock boundaries.
4. Fixes encoded in **`tests/menu.js`** (35 checks) and **`tests/deep.js`** (18 checks).
   Against the pre-fix build `2440125`: **29/35 menu checks fail, 12/18 deep checks fail**
   (one menu check is timing-sensitive and flips on very slow runs).

## Fixed in this pass

| ID | Menu | Sev | Problem | Fix |
|----|------|-----|---------|-----|
| M1 | Orders | Med | MARKET / SL-M rows printed the price column as `0.00` (no price exists). | Unpriced order types render `MKT`. |
| M2 | Orders | Med | Order time used `toLocaleTimeString()` → a 10:15 IST fill read 04:45 on a UTC machine. | Shared `fmtISTTime()` (Asia/Kolkata, epoch s/ms and ISO accepted). |
| M3 | Orders | Low | Double-clicking **Cancel** fired two DELETEs; the broker rejection surfaced as an error for an order that cancelled fine. | Per-order in-flight lock (`$.cancelBusy`). |
| M4 | Orders → history | Low | Status-history rows carried no timestamp. | IST time added to each row. |
| M5 | GTT | Med | The GTT list has no `trading_symbol`; `symbolOf()` returned `'?'` and **every** row showed `?`. | `rowSymbol()` resolves master → DB → watchlist → key tail (GTT, Trades, Position exit confirm all use it). |
| M6 | GTT | Low | Table read `rules[0]` for trigger/status (not necessarily ENTRY) and coloured every status the same. | ENTRY rule lookup; open/pending yellow vs closed green. |
| M7 | GTT modify | Med | The editor spread the **whole GET rule object** into the PUT body (`status`, `message`, `order_id`, …) — REVIEW B12, still open. | `gttRulePayload()` whitelist (strategy, trigger_type, trigger_price, market_protection, trailing_gap). |
| M8 | GTT modify | Med | No side-aware target/SL check on modify (create enforced it, edit did not). | BUY: target > entry > SL; SELL mirrored. Trailing gap must be positive + tick-aligned. |
| M9 | GTT modify | Med | Tick came from the instrument master only → with it unloaded every edit fell back to ₹0.05 and ₹0.01-tick equity GTTs could not be edited (B12). | Master → DB/watchlist → segment default (`_EQ\|` = 0.01). |
| M10 | GTT modify | Low | Quantity stayed editable on an `OPEN` GTT although Upstox locks it. | Field disabled + explicit message. |
| M11 | Trades | Med | Only a 13-digit epoch was formatted; an ISO `trade_date` printed verbatim (`2026-10-31T10:11:00+05:30`). | `fmtISTTime(..., true)`. |
| M12 | Trades | Low | `symbolOf(t) \|\| trading_symbol \|\| token` never fell back (`'?'` is truthy). | `rowSymbol()`. |
| M13 | Positions | Low | Exit confirmation showed `EXIT SELL 75 ?` when the row had no trading symbol. | `rowSymbol(meta, token)`. |
| M14 | Chart | **High** | A replayed/out-of-order tick older than the candle being built overwrote its live high/low/close (L6) — reproduced: close 105 → 90 after a 30-min-old tick. | Bucket authority guard (`bucket < lastBucket` → ignore). |
| M15 | Algo | **High** | `algoOnlyClosedCandles()` filtered minutes/hours/days but returned weekly/monthly **unfiltered**, so the in-progress week/month bar leaked into the live signal and the backtest (A2). | Current week/month period dropped. |
| M16 | Algo | Med | Trade `R` used the *planned* risk amount (`equity × riskPct`) instead of `qty × stop distance`, so a notional-capped trade reported −0.12R for a −1R stop. | `riskPerUnit` stored per position; `r = pnl / (qty × riskPerUnit)`. |
| M17 | Algo | Low | Buy & hold benchmark anchored on the warmup bar's open while the first tradable bar is `warmup+1` (A1). | Benchmark from `candles[warmup+1].o`. |
| M18 | Option chain | Med | With no `underlying_spot_price`, every strike is equidistant from 0 → ATM landed on the **lowest** strike and the ladder showed the bottom of the chain (L8). | Centre on the middle strike when spot ≤ 0. |
| M19 | P&L | Low | Brokerage read only from `charges_breakdown.brokerage`; a nested `charges.brokerage` rendered ₹0. Cost rows also used `fp()` → green "+₹" gains for debits. | Both shapes read; charges render neutral `fm()`. |
| M20 | Dashboard / Orders / GTT / Trades / Positions / Holdings / Funds / P&L / Profile | Med | In a read-only (Analytics-token) session every portfolio loader returns silently — the pages looked empty rather than locked. | `roPageNotice()` explains it once per page and drops a "Daily token required" empty state into the table. |
| M21 | Session | Med | `logout()` left `$.gts`, market-status/pro-market caches, inspector quote, next-expiry cache, and the rendered portfolio/P&L/algo/fundamentals DOM (B3). | All cleared; tables reset to their empty states. |
| M22 | Session | Low | Pasting a new token kept the REST cache, which is keyed by path+query (not identity) — a fresh login could read the previous session's cached profile/funds (B3). | `PRO_HUB.cache` + search cache reset on token paste and code exchange. |
| M23 | Session | Low | `init()`'s catch classified failures with a loose `/token\|auth\|expired/` regex and wiped healthy sessions (B6). | Uses `isAuthFailure()` like REST/WS. |
| M24 | Session clock | Med | MCX evening close was guessed twice with different month windows (Mar–Oct vs Apr–Oct) → orders blocked/polls stopped for up to 25 min around the March/November switches (L1). | One `mcxCloseMinute()` built on the real US DST window (2nd Sun Mar → 1st Sun Nov); both callers use it. |
| M25 | Session clock | Med | `marketHoursOpen()` treated every non-MCX key as NSE cash → a live CDS/BCD chart was marked closed after 15:40. | Currency segments keep 09:00–17:00 IST. |
| M26 | All requests | Med | The 15 s abort budget was cleared once headers arrived, so a stalled body could hang a request (or a write) forever (B5). | Budget covers `r.text()` in `rawUpstoxFetch`, `apiHist`, `chartFetchFreshIntraday`. |
| M27 | Login | **High** | The login form has a daily-token field **and** an analytics-token field, but `aTok()` `return`ed after the daily branch — pasting both silently discarded the 1-year analytics token, so the next reload bounced to the login screen. (Review B4: the mirror case also forced read-only over a live daily session.) | Both tokens are recorded and validated individually, then one `init()`; the analytics token is a fallback and no longer tears down a live daily session. |
| M28 | Dashboard | Med | `proUpdateMarket` computed `pct = cp ? … : 0`, so any tick without a prev-close printed "+412.35 (0.00%)" and erased the last known percentage. | Percentage is preserved (and the absolute change derived from it); a card with no basis prints "—". |
| M29 | Dashboard | Med | The margin-risk score re-parsed the page's own `₹1,23,456.78` strings out of `#dU`/`#dM` — thousands separators, a "—" placeholder or a slow funds call all bent the score. | `ldD` stores `$.dashFunds` numbers; the text is only a pre-first-load fallback. |
| M30 | Positions (exit-all) | Med | `exitAllMine` sent `_readonly:true` on `POST /order/positions/exit`. `upstoxFetch` honours that flag by **skipping cache invalidation**, so the Positions page could repaint the pre-square-off book from cache. | Flag removed — square-off is a mutation. |
| M31 | Chart / Algo / status chips | Med | Chart axis labels, crosshair, algo trade dates, spot-update stamps and the market-status "since" used `toLocale*()`, i.e. the viewer's timezone (09:15 IST drew as 03:45 on a UTC machine, and a 20:00Z trade dated a day early). | New `istFmt`/`fmtISTDay`/`fmtISTDayTime`/`fmtISTDayFull`/`fmtISTDayShort` sit on `istDateOf`; every market timestamp now renders in Asia/Kolkata. |
| M32 | Positions / Holdings / Dashboard | Low | These three still called `symbolOf()`, which answers `'?'` (truthy) when a row carries only `instrument_key` — Orders/Trades/GTT got `rowSymbol()` earlier, these were missed. | `rowSymbol()` everywhere a portfolio row is painted. |

## Verified correct in this pass (no change needed)

- **Order ticket**: lot/tick validation, freeze slicing, MCX lot echo, MIS-on-option-BUY block, AMO session logic, `market_protection:-1`, zeroed price for MKT/SL-M, busy lock.
- **Margin estimator**: doc-shaped `instruments[]` body, LTP fallback for MARKET/SL-M, funds coverage line, sequence guard against stale renders.
- **Positions/Holdings**: invested vs current maths, realised/unrealised split, P&L signs.
- **Watchlist**: in-place row patching (no DOM rebuild per tick), prev-close derivation from `net_change`, NaN-safe sort, invalid-key pruning.
- **Option chain**: PCR/OI totals, OI baselines, ATM handover, column manager, depth popup, `full_d30` 50-key cap.
- **Chart**: session-anchored buckets (09:15 NSE / 09:00 MCX), Heikin-Ashi transform, VWAP, EMA/SMA/STD/RSI/MACD seeding.
- **Algo**: indicator causality (no future data), ADX/Donchian look-back windows, conservative same-bar stop priority, 1:1 planned-R:R floor.
- **Fundamentals**: factor clamping, coverage weighting, peer/statement tables, ISIN resolution.
- **P&L**: metadata → paginated data → charges, IPFT row, FY list, analytics-token guard.
- **Kill switch / market status chip / bulk cancel & exit-all / panic**: doc-shaped bodies, confirmation ladders, state reporting.

## Static-scan flags that turned out NOT to be defects (checked, not "fixed")

- `id="ocSpotRowPrice"` appearing three times — one is a `set()` call by id; the other two are the desktop and mobile renderers, and each clears `#ocBody` before painting, so only one node ever exists.
- "OC header row has no `OI`" — the header is built from `OC_COL_DEFS` labels plus stacked sub-labels, so `OI` + `Chg` reads `OIChg` in `textContent`; the column and its tooltip are present on both sides.
- "Chain-wide PCR repeated on every strike row" — `strikeCellHtml`/`ocUpdateRow` divide that strike's own put OI by its call OI (verified 10.00 / 4.00 / 2.00 / 1.00 / 0.40 across a five-strike fixture); the chain-wide value lives only in the summary bar.
- `fundsSummary` vs the v3 docs — `available_to_trade.total`, `cash_available_to_trade.margin_used.total`, `pledge_available_to_trade.margin_used.total` and `cash.cash.opening_balance` all match the published schema.
- `_readonly` "unused" — it is consumed by `upstoxFetch` for cache invalidation; the only misuse was `exitAllMine` (M30).

## Open (need a live check or a product decision)

- GTT list rule status casing (`OPEN` vs `OPEN PENDING`) — the modify lock matches the documented `OPEN` plus common pending aliases; verify against a live GTT.
- GTT table shows only the ENTRY leg; surfacing target/SL in the row (or a tooltip) is a UX enhancement, not a defect.
- Holdings: `t1_quantity` / `collateral_quantity` are not added to the displayed quantity — Upstox semantics for a settled vs T1 position need live verification before changing totals.
- Market-pulse cards keep displaying the last known % when a tick omits `cp`; with no known basis at all they show "—" (see M28).
- Fundamentals: negative-growth factors are clamped to 0..1, which hides “worse than flat” within a factor — intentional (the factor bars are 0–100), documented here.

## Running the suite

```bash
node tests/run-all.js     # 10 suites, 246 assertions, all green after this pass
node tests/deep.js        # batch-3 only (12 of its 18 checks fail on 2440125)
```
