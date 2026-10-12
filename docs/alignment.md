# Crypto Savings: product alignment draft

## Goal

Build a small web app for a shared crypto investment pool. An operator records each stakeholder's PHP contribution. The app records when it arrived, the PHP amount, the USDT amount credited after conversion, and the evidence for that conversion. The pool makes daily token purchases. Stakeholders can see their share of the pool, the tokens behind it, and how its value has changed over time.

This brief defines the agreed first version. All buys and holdings start as simulations, and the operator can replace a simulated buy with a manually recorded execution.

## Shared terms

- **Stakeholder:** a person with a recorded claim on the pool.
- **Contribution:** money received from a stakeholder, with a receipt time and PHP amount.
- **Simulated USDT:** PHP contribution converted at a captured live PHP/USDT quote. It is an estimate, not proof of an exchange conversion.
- **Simulated buy:** a dated allocation calculated from a market price and the person's daily budget. It does not place an exchange order.
- **Recorded execution:** a trade the operator enters after buying externally. It replaces that day's simulated buy for the relevant token and records actual quantity, cost, and fees.
- **Pool value:** the marked value of all token balances plus unspent cash, less any recorded liabilities, at a stated price time.
- **Stakeholder allocation:** the person's unspent USDT and individually attributed token lots, valued at a stated price time. Contributions on different dates must not assign earlier gains to later contributors.
- **Daily value change:** change in a stakeholder's marked claim for a day after accounting for contributions and withdrawals. It can include unrealized price movement and must not be presented as guaranteed or realized income.

## Intended first release

1. An operator records a PHP contribution. The app captures a live PHP/USDT quote, shows the estimated USDT, and stores the quote and its time.
2. The app simulates buys for each contribution in equal daily amounts over the chosen number of days, split by the current token targets.
3. The app calculates each person's cash and token balances from recorded transactions, then reconciles their sum to the shared pool.
4. Each stakeholder sees their current claim in USDT and PHP, its token breakdown, and a dated history of value changes.
5. Every displayed valuation shows its price source and timestamp. Historical figures remain reproducible from stored transactions and price snapshots.
6. The app shows missing trade or price data clearly instead of silently treating planned buys as completed or using a current price for a past valuation.

## Decisions made

- Each stakeholder has separate token lots. A later contribution does not buy into earlier gains or losses.
- Everyone follows the same target token mix, entered as editable percentages totaling 100%.
- The app simulates daily buys at market prices. It does not place real orders or connect to an exchange.
- The operator may enter a real execution to replace a simulated buy for a day and token.
- Each contribution is invested in equal daily amounts over a number of days chosen when entered.
- Daily catch-up runs when the operator opens the app. The app does not need to run while closed.
- One operator uses the first version in one browser and shares reports manually.
- The first version starts with new contributions; there is no historical import.

## Decisions needed

- The initial token percentages and number of daily buys are set by the operator in the app.
- Whether withdrawals are needed in the next release.
- Whether a later cloud version should sync data across devices and give stakeholders their own logins.

## Boundary

The first release calculates stakeholder-attributed simulated holdings and marks them with market quotes. A quote can value a holding or price a simulated buy, but does not prove that a real trade occurred. The interface must keep simulated values visibly distinct from manually recorded executions. Real order placement, exchange custody, tax reports, withdrawals, and transfers of crypto to stakeholders are outside this release.

## Next step

Define the data model and calculation rules, then build the local first version.
