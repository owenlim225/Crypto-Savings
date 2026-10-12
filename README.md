# Crypto Savings

A local web app for tracking a shared crypto pool. Each stakeholder has separate token lots. Daily buys are simulated from stored market quotes; manually recorded executions can replace a day's simulated buy. The app never places an exchange order.

## Run

1. Install Node.js 20 or newer.
2. From this folder, run `npm start`.
3. Open `http://127.0.0.1:4173/` in a browser.

No package installation or API key is required. An internet connection is needed to refresh prices from CoinGecko.

## Use

1. Add a stakeholder.
2. Review the starting token mix in Settings. Selected percentages must total 100%; changes affect future buys only.
3. Refresh prices, then record the Philippine receipt date and time, PHP amount, and number of days over which to buy. The captured PHP-per-USDT quote estimates the USDT amount.
4. Open the app after 08:10 Manila time to catch up on daily buys. Each day's stored 08:00 market point is used for that day's simulated purchases.
5. If you made a real purchase externally, open Activity and replace the matching day's simulated token buy with its total USDT spent, net quantity received, and fee.
6. Open a stakeholder to see their token breakdown and daily changes. Print or save their detailed report as PDF, or export the daily CSV.
7. Correct a contribution from Activity if its details were wrong. The original remains visible as voided, with a reason and a linked replacement. A correction that would remove a recorded buy is rejected.
8. Download a JSON backup from Settings after recording changes, then select the saved file with **Verify saved file**. This browser's local storage is the only copy until you save one elsewhere. A new quote or ledger change makes the backup reminder reappear.

The PHP-to-USDT conversion is an estimate from a market quote. Simulated buys exclude unrecorded fees and slippage. Current estimated portfolio PHP values use the latest captured USDT/PHP market quote; recorded contribution PHP amounts and conversion rates stay historical. Reports are not exchange statements or tax records.

## Check

Run `npm test` for the ledger calculation checks.

Product decisions and accounting rules are documented in [alignment](docs/alignment.md) and [architecture](docs/architecture.md).
