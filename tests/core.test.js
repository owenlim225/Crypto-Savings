import test from "node:test";
import assert from "node:assert/strict";
import { firstBuyDay, latestCompleteDay, replay, manilaLocalValue,
  receiptTimeToIso, orphanedRecordedExecutions } from "../dist/core.js";

const targets = [{ assetId: "bitcoin", weight: 100 }];
const snapshot = (day, price) => ({
  day, at: day + "T00:00:00.000Z", provider: "fixture", usdtPhp: 58,
  tokenUsdt: { bitcoin: price },
});
const contribution = (id, stakeholderId, usdt, firstDay, days = 1) => ({
  id, stakeholderId, usdt, php: usdt * 58, firstBuyDay: firstDay,
  receivedAt: firstDay + "T00:00:00.000Z", days, phpPerUsdt: 58,
});
const base = () => ({
  stakeholders: [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }],
  contributions: [],
  targetsHistory: [{ effectiveDay: "0000-01-01", targets }],
  manualTrades: [],
  priceDays: {},
  latestQuote: { at: "2026-10-13T05:00:00.000Z",
    usdtPhp: 58, tokenUsdt: { bitcoin: 20 }, provider: "fixture" },
});

test("buy cutoff is 08:10 Manila and catch-up waits for the daily point", () => {
  assert.equal(firstBuyDay("2026-10-12T00:09:00.000Z"), "2026-10-12");
  assert.equal(firstBuyDay("2026-10-12T00:10:00.000Z"), "2026-10-13");
  assert.equal(firstBuyDay("2026-10-11T20:00:00.000Z"), "2026-10-12");
  assert.equal(latestCompleteDay("2026-10-12T00:09:00.000Z"), "2026-10-11");
  assert.equal(latestCompleteDay("2026-10-12T00:10:00.000Z"), "2026-10-12");
});

test("Philippine receipt time converts exactly and rejects impossible or future times", () => {
  const now = new Date("2026-10-12T01:00:00.000Z");
  assert.equal(manilaLocalValue(now), "2026-10-12T09:00");
  assert.equal(receiptTimeToIso("2026-10-12T08:09", now),
    "2026-10-12T00:09:00.000Z");
  assert.equal(firstBuyDay(receiptTimeToIso("2026-10-12T08:10", now)),
    "2026-10-13");
  assert.throws(() => receiptTimeToIso("2026-02-30T08:00", now), /valid/);
  assert.throws(() => receiptTimeToIso("2026-10-12T09:01", now), /future/);
});

test("voided contribution leaves an audit record while replacement drives replay", () => {
  const state = base();
  state.contributions.push({ ...contribution("old", "a", 100, "2026-10-12"),
    voidedAt: "2026-10-13T00:00:00.000Z", voidReason: "Wrong amount",
    replacedById: "new" });
  state.contributions.push({ ...contribution("new", "a", 200, "2026-10-12"),
    correctsId: "old" });
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  const result = replay(state, "2026-10-12");
  assert.equal(result.error, null);
  assert.equal(result.contributedUsdt, 200);
  assert.equal(result.balances.a.tokens.bitcoin.quantity, 20);
  assert.equal(state.contributions.length, 2);
});

test("correction preflight identifies a recorded execution with no remaining planned buy", () => {
  const state = base();
  state.contributions.push(contribution("old", "a", 100, "2026-10-12"));
  state.manualTrades.push({ day: "2026-10-12", assetId: "bitcoin",
    costUsdt: 100, quantity: 10, feeUsdt: 0 });
  assert.equal(orphanedRecordedExecutions(state).length, 0);
  state.contributions[0].voidedAt = "2026-10-13T00:00:00.000Z";
  state.contributions.push(contribution("new", "a", 100, "2026-10-13"));
  assert.equal(orphanedRecordedExecutions(state)[0].day, "2026-10-12");
  assert.match(replay(state, "2026-10-12").error, /no planned buy/);
});

test("reducing a contribution cannot silently drop a later recorded execution", () => {
  const state = base();
  state.contributions.push(contribution("old", "a", 200, "2026-10-12", 2));
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  state.priceDays["2026-10-13"] = snapshot("2026-10-13", 10);
  state.manualTrades.push(
    { day: "2026-10-12", assetId: "bitcoin", costUsdt: 150, quantity: 15, feeUsdt: 0 },
    { day: "2026-10-13", assetId: "bitcoin", costUsdt: 50, quantity: 5, feeUsdt: 0 },
  );
  assert.equal(orphanedRecordedExecutions(state).length, 0);
  assert.equal(replay(state, "2026-10-13").lots.length, 2);

  state.contributions[0].voidedAt = "2026-10-14T00:00:00.000Z";
  state.contributions.push(contribution("replacement", "a", 150, "2026-10-12", 2));
  assert.deepEqual(orphanedRecordedExecutions(state).map((trade) => trade.day),
    ["2026-10-13"]);
  const result = replay(state, "2026-10-13");
  assert.match(result.error, /2026-10-13.*no planned buy/);
  assert.equal(result.lots.length, 0);
});

test("later stakeholder receives only later lots and earlier gains stay with the first", () => {
  const state = base();
  state.contributions.push(
    contribution("c1", "a", 100, "2026-10-12"),
    contribution("c2", "b", 100, "2026-10-13"),
  );
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  state.priceDays["2026-10-13"] = snapshot("2026-10-13", 20);
  const result = replay(state, "2026-10-13");
  assert.equal(result.error, null);
  assert.equal(result.balances.a.tokens.bitcoin.quantity, 10);
  assert.equal(result.balances.b.tokens.bitcoin.quantity, 5);
  assert.equal(result.balances.a.gainUsdt, 100);
  assert.equal(result.balances.b.gainUsdt, 0);
  assert.equal(result.history[1].poolChangeUsdt, 100);
});

test("manual execution replaces one simulated buy and splits cost and quantity", () => {
  const state = base();
  state.contributions.push(
    contribution("c1", "a", 100, "2026-10-12"),
    contribution("c2", "b", 100, "2026-10-12"),
  );
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  state.manualTrades.push({ day: "2026-10-12", assetId: "bitcoin",
    costUsdt: 200, quantity: 18, feeUsdt: 2 });
  const result = replay(state, "2026-10-12");
  assert.equal(result.lots.length, 2);
  assert.equal(result.lots[0].kind, "recorded");
  assert.equal(result.lots[0].quantity, 9);
  assert.equal(result.lots[1].quantity, 9);
  assert.equal(result.lots[0].feeUsdt, 1);
  assert.equal(result.balances.a.cashUsdt, 0);
});

test("missing daily price leaves funds unspent and the day pending", () => {
  const state = base();
  state.contributions.push(contribution("c1", "a", 100, "2026-10-12", 2));
  const result = replay(state, "2026-10-13");
  assert.equal(result.pendingDay, "2026-10-12");
  assert.equal(result.balances.a.cashUsdt, 100);
  assert.equal(result.lots.length, 0);
});

test("an invalid recorded cost never leaves partial buys in that day", () => {
  const state = base();
  state.contributions.push(contribution("c1", "a", 100, "2026-10-12"));
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  state.manualTrades.push({ day: "2026-10-12", assetId: "bitcoin",
    costUsdt: 101, quantity: 10, feeUsdt: 1 });
  const result = replay(state, "2026-10-12");
  assert.match(result.error, /exceeds/);
  assert.equal(result.lots.length, 0);
  assert.equal(result.balances.a.cashUsdt, 100);
});

test("an earlier recorded overspend reduces later buys without spending cash twice", () => {
  const state = base();
  state.contributions.push(contribution("c1", "a", 100, "2026-10-12", 2));
  state.priceDays["2026-10-12"] = snapshot("2026-10-12", 10);
  state.priceDays["2026-10-13"] = snapshot("2026-10-13", 10);
  state.manualTrades.push({ day: "2026-10-12", assetId: "bitcoin",
    costUsdt: 80, quantity: 8, feeUsdt: 0 });
  const result = replay(state, "2026-10-13");
  assert.equal(result.error, null);
  assert.equal(result.balances.a.cashUsdt, 0);
  assert.equal(result.lots[1].costUsdt, 20);
});
