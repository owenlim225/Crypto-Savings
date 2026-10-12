export const ASSETS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
];

export const DEFAULT_TARGETS = [
  { assetId: "bitcoin", weight: 34 },
  { assetId: "ethereum", weight: 33 },
  { assetId: "solana", weight: 33 },
];

const DAY_MS = 86_400_000;
const EPS = 1e-8;

export function round(value, places = 10) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function addDays(day, count) {
  return new Date(Date.parse(day + "T00:00:00Z") + count * DAY_MS)
    .toISOString().slice(0, 10);
}

export function daysBetween(first, last) {
  return Math.round((Date.parse(last + "T00:00:00Z") -
    Date.parse(first + "T00:00:00Z")) / DAY_MS);
}

export function firstBuyDay(receivedAt) {
  const time = new Date(receivedAt);
  const utcDay = time.toISOString().slice(0, 10);
  const minute = time.getUTCHours() * 60 + time.getUTCMinutes();
  return addDays(utcDay, minute >= 10 ? 1 : 0);
}

export function latestCompleteDay(now = new Date()) {
  const time = new Date(now);
  const utcDay = time.toISOString().slice(0, 10);
  const minute = time.getUTCHours() * 60 + time.getUTCMinutes();
  return addDays(utcDay, minute >= 10 ? 0 : -1);
}

export function validTargets(targets) {
  if (!Array.isArray(targets) || !targets.length) return false;
  const ids = new Set();
  let total = 0;
  for (const target of targets) {
    if (!ASSETS.some((asset) => asset.id === target.assetId) ||
        ids.has(target.assetId) ||
        !Number.isFinite(target.weight) ||
        target.weight <= 0) return false;
    ids.add(target.assetId);
    total += target.weight;
  }
  return Math.abs(total - 100) < 0.001;
}

export function targetsForDay(history, day) {
  return [...history]
    .filter((version) => version.effectiveDay <= day)
    .sort((a, b) => b.effectiveDay.localeCompare(a.effectiveDay))[0]?.targets ?? [];
}

export function quoteFromSimplePrice(data, assetIds) {
  const tether = data?.tether;
  if (!Number.isFinite(tether?.usd) || tether.usd <= 0 ||
      !Number.isFinite(tether?.php) || tether.php <= 0) {
    throw new Error("The USDT exchange quote is missing.");
  }
  const tokenUsdt = {};
  let oldest = tether.last_updated_at;
  for (const id of assetIds) {
    const entry = data[id];
    if (!Number.isFinite(entry?.usd) || entry.usd <= 0) {
      throw new Error("The market quote for " + id + " is missing.");
    }
    tokenUsdt[id] = entry.usd / tether.usd;
    oldest = Math.min(oldest, entry.last_updated_at);
  }
  if (!Number.isFinite(oldest)) throw new Error("The quote time is missing.");
  return {
    at: new Date(oldest * 1000).toISOString(),
    usdtPhp: tether.php,
    tokenUsdt,
    provider: "CoinGecko",
  };
}

export function dailyPricesFromCharts(charts, assetIds) {
  const byDay = new Map();
  const makeMap = (chart) => new Map((chart?.prices ?? [])
    .filter(([time, price]) => Number.isFinite(price) && price > 0 &&
      new Date(time).getUTCHours() === 0 &&
      new Date(time).getUTCMinutes() === 0)
    .map(([time, price]) => [new Date(time).toISOString().slice(0, 10), price]));
  const tetherUsd = makeMap(charts.tetherUsd);
  const tetherPhp = makeMap(charts.tetherPhp);
  const assets = Object.fromEntries(assetIds.map((id) => [id, makeMap(charts[id])]));
  for (const [day, usd] of tetherUsd) {
    const php = tetherPhp.get(day);
    if (!php) continue;
    const tokenUsdt = {};
    let complete = true;
    for (const id of assetIds) {
      const tokenUsd = assets[id].get(day);
      if (!tokenUsd) {
        complete = false;
        break;
      }
      tokenUsdt[id] = tokenUsd / usd;
    }
    if (complete) byDay.set(day, {
      day,
      at: day + "T00:00:00.000Z",
      usdtPhp: php,
      tokenUsdt,
      provider: "CoinGecko",
    });
  }
  return byDay;
}

function emptyBalance(stakeholderId) {
  return { stakeholderId, cashUsdt: 0, contributedUsdt: 0, lots: [],
    tokens: {}, valueUsdt: 0, gainUsdt: 0 };
}

function addLot(balance, lot) {
  balance.cashUsdt -= lot.costUsdt;
  balance.lots.push(lot);
  const token = balance.tokens[lot.assetId] ?? { quantity: 0, costUsdt: 0, feeUsdt: 0 };
  token.quantity += lot.quantity;
  token.costUsdt += lot.costUsdt;
  token.feeUsdt += lot.feeUsdt;
  balance.tokens[lot.assetId] = token;
}

function markBalance(balance, quote) {
  let value = balance.cashUsdt;
  for (const [assetId, token] of Object.entries(balance.tokens)) {
    const price = quote?.tokenUsdt?.[assetId];
    if (!Number.isFinite(price) || price <= 0) return null;
    value += token.quantity * price;
  }
  return value;
}

export function replay(state, throughDay = latestCompleteDay()) {
  const contributions = (state.contributions ?? []).filter((item) => !item.voidedAt);
  const balances = Object.fromEntries((state.stakeholders ?? [])
    .map((person) => [person.id, emptyBalance(person.id)]));
  const activated = new Set();
  const lots = [];
  const history = [];
  const priceDays = state.priceDays ?? {};
  const manualTrades = state.manualTrades ?? [];
  const firstDay = contributions.length
    ? contributions.map((item) => item.firstBuyDay).sort()[0]
    : null;
  let pendingDay = null;
  let error = null;
  let processedThrough = null;
  let previousValues = {};

  if (firstDay && firstDay <= throughDay) {
    for (let day = firstDay; day <= throughDay; day = addDays(day, 1)) {
      const snapshot = priceDays[day];
      if (!snapshot) {
        pendingDay = day;
        break;
      }
      const arriving = contributions.filter((item) => item.firstBuyDay === day);
      for (const item of arriving) {
        const balance = balances[item.stakeholderId];
        if (!balance) { error = "A contribution refers to a missing stakeholder."; break; }
        balance.cashUsdt += item.usdt;
        balance.contributedUsdt += item.usdt;
        activated.add(item.id);
      }
      if (error) break;

      const targets = targetsForDay(state.targetsHistory ?? [], day);
      if (!validTargets(targets)) { error = "Token targets are missing for " + day + "."; break; }
      const plans = new Map();
      const available = Object.fromEntries(Object.entries(balances)
        .map(([id, balance]) => [id, balance.cashUsdt]));
      for (const item of contributions) {
        const index = daysBetween(item.firstBuyDay, day);
        if (index < 0 || index >= item.days) continue;
        const budget = Math.min(available[item.stakeholderId], item.usdt / item.days);
        if (budget <= EPS) continue;
        available[item.stakeholderId] -= budget;
        let assigned = 0;
        targets.forEach((target, targetIndex) => {
          const planned = targetIndex === targets.length - 1
            ? budget - assigned : budget * target.weight / 100;
          assigned += planned;
          if (!plans.has(target.assetId)) plans.set(target.assetId, []);
          plans.get(target.assetId).push({
            stakeholderId: item.stakeholderId,
            contributionId: item.id,
            planned,
          });
        });
      }
      const staged = [];
      for (const [assetId, participants] of plans) {
        const override = manualTrades.find((trade) => trade.day === day &&
          trade.assetId === assetId);
        const plannedTotal = participants.reduce((sum, part) => sum + part.planned, 0);
        const price = snapshot.tokenUsdt?.[assetId];
        if (!Number.isFinite(price) || price <= 0) {
          error = "A token price is missing for " + day + ".";
          break;
        }
        for (const part of participants) {
          const share = part.planned / plannedTotal;
          const costUsdt = override ? override.costUsdt * share : part.planned;
          const quantity = override ? override.quantity * share : costUsdt / price;
          const feeUsdt = override ? override.feeUsdt * share : 0;
          const lot = { day, assetId, stakeholderId: part.stakeholderId,
            contributionId: part.contributionId, costUsdt, quantity, feeUsdt,
            kind: override ? "recorded" : "simulated",
            priceUsdt: override ? costUsdt / quantity : price };
          staged.push(lot);
        }
      }
      if (error) break;
      for (const [id, balance] of Object.entries(balances)) {
        const spent = staged.filter((lot) => lot.stakeholderId === id)
          .reduce((sum, lot) => sum + lot.costUsdt, 0);
        if (spent - balance.cashUsdt > EPS) {
          error = "Recorded execution on " + day + " exceeds a stakeholder's available USDT.";
          break;
        }
        for (const assetId of Object.keys(balance.tokens)) {
          if (!Number.isFinite(snapshot.tokenUsdt?.[assetId]) ||
              snapshot.tokenUsdt[assetId] <= 0) {
            error = "A valuation price is missing for " + day + ".";
            break;
          }
        }
        if (error) break;
      }
      if (error) break;
      for (const lot of staged) {
        addLot(balances[lot.stakeholderId], lot);
        lots.push(lot);
      }

      const values = {};
      let poolValue = 0;
      let poolChange = 0;
      for (const [id, balance] of Object.entries(balances)) {
        if (balance.contributedUsdt <= 0) continue;
        const value = markBalance(balance, snapshot);
        if (value === null) {
          error = "A valuation price is missing for " + day + ".";
          break;
        }
        const newContributions = arriving
          .filter((item) => item.stakeholderId === id)
          .reduce((sum, item) => sum + item.usdt, 0);
        const change = value - (previousValues[id] ?? 0) - newContributions;
        values[id] = { valueUsdt: value, changeUsdt: change,
          contributedUsdt: balance.contributedUsdt };
        poolValue += value;
        poolChange += change;
      }
      if (error) break;
      history.push({ day, values, poolValueUsdt: poolValue,
        poolChangeUsdt: poolChange, usdtPhp: snapshot.usdtPhp });
      previousValues = Object.fromEntries(Object.entries(values)
        .map(([id, row]) => [id, row.valueUsdt]));
      processedThrough = day;
    }
  }

  for (const item of contributions) {
    if (activated.has(item.id)) continue;
    const balance = balances[item.stakeholderId];
    if (balance) {
      balance.cashUsdt += item.usdt;
      balance.contributedUsdt += item.usdt;
    }
  }
  const quote = state.latestQuote ?? (processedThrough ? priceDays[processedThrough] : null);
  for (const balance of Object.values(balances)) {
    const value = markBalance(balance, quote);
    balance.valueUsdt = value;
    balance.gainUsdt = value === null ? null : value - balance.contributedUsdt;
  }
  const poolValueUsdt = Object.values(balances).reduce((sum, item) =>
    sum + (item.valueUsdt ?? 0), 0);
  const contributedUsdt = contributions.reduce((sum, item) => sum + item.usdt, 0);
  return { balances, lots, history, quote, poolValueUsdt,
    contributedUsdt, gainUsdt: poolValueUsdt - contributedUsdt,
    pendingDay, processedThrough, error };
}
