# Crypto Savings: first-version architecture

## Decision

Build a local, operator-only web app with plain HTML, CSS, and JavaScript. Store its ledger and captured price snapshots in this browser, with JSON export and import for backup. There is no server, exchange connection, or real order placement.

## Accounting model

- A contribution records stakeholder, receipt timestamp, PHP amount, captured PHP-per-USDT quote, resulting simulated USDT, first buy day, and number of buy days.
- Each contribution reserves an equal USDT budget for each buy day. The token target percentages split that day's budget. Changes to targets apply to future days; past lots keep their original quantities and prices.
- The app creates a separate lot for each stakeholder, contribution, day, and token. A later stakeholder never receives any part of an earlier lot.
- A daily market snapshot contains each token's USDT price, USDT/PHP rate, quote time, and provider. Snapshots are stored before buys are generated. Missing snapshots stop catch-up for that day; the app must not invent a price.
- A manually entered executed trade for one day and token replaces its simulated buy. The app allocates its total cost, acquired quantity, and fee across participating stakeholders in proportion to their planned spend for that token and day.
- Each person's current simulated value is unspent USDT plus the sum of their token quantities multiplied by current market prices. Total gain/loss is current value minus credited contributions. Daily gain/loss is the change in value after subtracting contributions newly included in that day's snapshot.
- Pool totals are sums of stakeholder balances. Market prices and PHP values are estimates; manually recorded trades are still not verified against an exchange.

## Price source

CoinGecko's keyless public API supplies current prices for BTC, ETH, SOL, and USDT and daily historical prices. Token prices in USDT are token/USD divided by USDT/USD. The PHP-per-USDT conversion uses USDT/PHP. The app fetches only when opened or refreshed and retains the daily quote used for each simulated buy. If the provider is unavailable or rate limited, the app shows an error and leaves unsimulated days pending.

Daily buy snapshots correspond to 00:00 UTC, or 08:00 in Manila. CoinGecko says the completed daily point becomes available at about 00:10 UTC, so catch-up for the current day begins after 08:10 Manila.

Sources: [CoinGecko keyless API](https://docs.coingecko.com/docs/keyless-public-api), [price endpoint](https://docs.coingecko.com/reference/simple-price), [historical chart endpoint](https://docs.coingecko.com/reference/coins-id-market-chart).

## Boundaries and risks

- Browser storage is tied to one browser profile and can be cleared. Export is the backup path; the app should encourage it after ledger changes.
- Keyless price requests share rate limits and may fail. Stored snapshots keep earlier calculations reproducible, but a missing day cannot be calculated until its quote is obtained.
- A market quote is neither an exchange execution nor the amount of USDT actually obtained from PHP. The UI must call these simulated estimates.
- Historical access and provider availability may limit long catch-up gaps. The app should report the first missing day instead of filling it with today's quote.
- Editing or deleting an old contribution would change later calculations. The first version should use explicit corrections or block destructive edits rather than silently rewrite history.

## Delivery

1. Ledger, daily catch-up, manual trade replacement, and calculation checks.
2. Operator dashboard with per-person token breakdown, daily changes, and report export.
3. Local browser verification of the full flow and failure states.
