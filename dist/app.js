import {
  ASSETS, DEFAULT_TARGETS, addDays, daysBetween, firstBuyDay,
  latestCompleteDay, validTargets, targetsForDay, quoteFromSimplePrice,
  dailyPricesFromCharts, replay, round, manilaLocalValue, receiptTimeToIso,
  orphanedRecordedExecutions,
} from "./core.js";

const STORAGE_KEY = "crypto-savings-ledger-v1";
const BACKUP_NEEDED_KEY = "crypto-savings-backup-needed-v1";
const BACKUP_VERIFIED_KEY = "crypto-savings-backup-verified-v1";
const API = "https://api.coingecko.com/api/v3";
const content = document.querySelector("#content");
const pageTitle = document.querySelector("#pageTitle");
const toast = document.querySelector("#toast");
const phpFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
const usdtFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });
let view = "overview";
let selectedPerson = null;
let activityFilter = "all";
let busy = false;
let statusMessage = "";
let toastTimer;

function blankState() {
  return {
    version: 1,
    stakeholders: [],
    contributions: [],
    targetsHistory: [{ effectiveDay: "0000-01-01", targets: DEFAULT_TARGETS }],
    priceDays: {},
    manualTrades: [],
    latestQuote: null,
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : blankState();
  } catch {
    return blankState();
  }
}

let state = loadState();
function hasRecordedData(value) {
  return Boolean(value.stakeholders?.length || value.contributions?.length ||
    value.manualTrades?.length || Object.keys(value.priceDays ?? {}).length ||
    JSON.stringify(value.targetsHistory) !== JSON.stringify(blankState().targetsHistory));
}
function ledgerSignature(value) {
  return JSON.stringify({ version: value.version, stakeholders: value.stakeholders,
    contributions: value.contributions, targetsHistory: value.targetsHistory,
    manualTrades: value.manualTrades, priceDays: value.priceDays,
    latestQuote: value.latestQuote });
}
let lastLedgerSignature = ledgerSignature(state);
let backupNeeded = hasRecordedData(state) &&
  (localStorage.getItem(BACKUP_NEEDED_KEY) === "true" ||
    localStorage.getItem(BACKUP_NEEDED_KEY) === null &&
    lastLedgerSignature !== ledgerSignature(blankState()));
let backupVerifiedAt = localStorage.getItem(BACKUP_VERIFIED_KEY);

function save() {
  const nextSignature = ledgerSignature(state);
  if (nextSignature !== lastLedgerSignature) {
    if (hasRecordedData(state)) {
      backupNeeded = true;
      localStorage.setItem(BACKUP_NEEDED_KEY, "true");
    }
    lastLedgerSignature = nextSignature;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function money(value) { return value == null ? "—" : usdtFormat.format(value) + " USDT"; }
function php(value) { return value == null ? "—" : phpFormat.format(value); }
function signed(value) {
  if (value == null) return "—";
  return (value > 0 ? "+" : "") + money(value);
}
function gainClass(value) { return value > 0.000001 ? "positive" : value < -0.000001 ? "negative" : "muted"; }
function asset(id) { return ASSETS.find((entry) => entry.id === id) ?? { symbol: id.toUpperCase(), name: id }; }
function date(day) { return dateFormat.format(new Date(day + "T00:00:00Z")); }
function dateTime(iso) { return dateFormat.format(new Date(iso)) + " · " +
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}

function allAssetIds() {
  return [...new Set(state.targetsHistory.flatMap((version) =>
    version.targets.map((target) => target.assetId)))];
}

function currentTargets() {
  return targetsForDay(state.targetsHistory, firstBuyDay(new Date().toISOString()));
}

function result() { return replay(state); }
function hasUnpriced(summary) {
  return Object.values(summary.balances).some((balance) =>
    balance.contributedUsdt > 0 && balance.valueUsdt == null);
}

function setStatus(kind, message) {
  document.querySelector("#connectionDot").className = "status-dot " + kind;
  document.querySelector("#connectionText").textContent = message;
}

function chart(rows, key) {
  if (!rows.length) return '<div class="empty-chart"><div><strong>Value history begins after the first daily buy</strong>After 08:10 PHT on the first buy day, refresh prices.</div></div>';
  const values = rows.map(key);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.1, 1);
  const points = values.map((value, index) => {
    const x = 28 + (index / Math.max(values.length - 1, 1)) * 704;
    const y = 183 - ((value - min) / range) * 135;
    return [x, y];
  });
  if (points.length === 1) points.push([732, points[0][1]]);
  const line = points.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
  const area = "28,205 " + line + " 732,205";
  const last = points.at(-1);
  return `<svg class="chart" viewBox="0 0 760 235" role="img" aria-label="Portfolio value over time">
    <line class="gridline" x1="28" y1="48" x2="732" y2="48"/><line class="gridline" x1="28" y1="115" x2="732" y2="115"/><line class="gridline" x1="28" y1="183" x2="732" y2="183"/>
    <polygon class="area" points="${area}"/><polyline class="line" points="${line}"/><circle class="dot" cx="${last[0]}" cy="${last[1]}" r="6"/>
    <text class="chart-label" x="28" y="228">${h(date(rows[0].day))}</text><text class="chart-label" x="732" y="228" text-anchor="end">${h(date(rows.at(-1).day))}</text>
  </svg>`;
}

function metric(label, value, sub = "", className = "") {
  return `<div class="metric"><div class="label">${label}</div><div class="value ${className}">${value}</div><div class="sub">${sub}</div></div>`;
}

function notices(summary) {
  let html = "";
  if (backupNeeded) html += `<div class="notice" role="status"><span>↓</span><div><strong>Backup needed.</strong> Records or prices have changed. Download a JSON backup, then select that file to verify it matches the current data. A download request does not confirm the file was saved. <button class="table-link" type="button" data-action="export-backup">Download backup</button> <button class="table-link" type="button" data-action="verify-backup">Verify file</button></div></div>`;
  if (summary.error) html += `<div class="notice danger"><span>!</span><div><strong>Ledger needs attention.</strong> ${h(summary.error)}</div></div>`;
  if (summary.pendingDay) html += `<div class="notice"><span>◷</span><div><strong>Daily buys waiting since ${h(date(summary.pendingDay))}.</strong> Refresh prices to catch up. No missing day is priced with today's quote.</div></div>`;
  if (statusMessage) html += `<div class="notice danger"><span>!</span><div>${h(statusMessage)}</div></div>`;
  return html;
}

function assetRows(summary, stakeholderId = null) {
  const totals = {};
  const quoteDay = summary.quote ? latestCompleteDay(summary.quote.at) : null;
  const referenceDay = summary.history.slice().reverse()
    .find((row) => row.day < quoteDay)?.day ?? summary.history.at(-1)?.day;
  const previousQuote = referenceDay ? state.priceDays[referenceDay] : null;
  const balances = stakeholderId ? [summary.balances[stakeholderId]] :
    Object.values(summary.balances);
  for (const balance of balances.filter(Boolean)) {
    for (const [id, token] of Object.entries(balance.tokens)) {
      const row = totals[id] ?? { quantity: 0, costUsdt: 0, feeUsdt: 0 };
      row.quantity += token.quantity;
      row.costUsdt += token.costUsdt;
      row.feeUsdt += token.feeUsdt;
      totals[id] = row;
    }
  }
  return Object.entries(totals).map(([id, row]) => ({
    id, ...row,
    priceUsdt: summary.quote?.tokenUsdt?.[id] ?? null,
    priceMovePct: previousQuote?.tokenUsdt?.[id] && summary.quote?.tokenUsdt?.[id]
      ? (summary.quote.tokenUsdt[id] / previousQuote.tokenUsdt[id] - 1) * 100 : null,
    valueUsdt: summary.quote?.tokenUsdt?.[id] == null
      ? null : row.quantity * summary.quote.tokenUsdt[id],
  })).sort((a, b) => (b.valueUsdt ?? 0) - (a.valueUsdt ?? 0));
}

function renderOverview(summary) {
  const hasContribution = state.contributions.some((item) => !item.voidedAt);
  if (!state.stakeholders.length || !hasContribution) {
    const hasStakeholder = state.stakeholders.length > 0;
    const mix = currentTargets().map((target) =>
      target.weight + "% " + asset(target.assetId).symbol).join(" · ");
    content.innerHTML = `<div class="page">
      <div class="page-heading"><div><h1>${hasStakeholder ? "Ready for the first contribution" : "Start your pool"}</h1><p>${hasStakeholder ? "Your stakeholders are in place." : "Track each person's share of a pooled crypto plan."}</p></div></div>
      ${notices(summary)}
      <section class="card settings-card">
        <h2>${hasStakeholder ? "Review the token mix" : "Add a stakeholder"}</h2>
        <p>${hasStakeholder
          ? "The current mix is " + h(mix) + ". Review it before recording money; it will split future daily buys for everyone."
          : "Each person's contributions and token purchases are tracked separately. Unspent cash is shown in USDT, a digital dollar."}</p>
        <div class="settings-actions">${hasStakeholder
          ? '<button class="button primary" data-action="settings">Review token mix</button><button class="button ghost" data-action="new-contribution">Record first contribution</button>'
          : '<button class="button primary" data-action="add-person">Add stakeholder</button>'}</div>
      </section>
    </div>`;
    return;
  }
  const priced = !hasUnpriced(summary);
  const rate = summary.quote?.usdtPhp;
  const last = summary.history.at(-1);
  const assets = assetRows(summary);
  const investedValue = assets.reduce((sum, row) => sum + (row.valueUsdt ?? 0), 0);
  const rows = state.stakeholders.map((person) => {
    const balance = summary.balances[person.id];
    if (!balance) return "";
    return `<tr><td><span class="avatar">${h(initials(person.name))}</span><strong>${h(person.name)}</strong></td>
      <td>${money(balance.contributedUsdt)}</td><td>${money(balance.cashUsdt)}</td>
      <td class="right"><strong>${money(balance.valueUsdt)}</strong></td>
      <td class="right ${gainClass(balance.gainUsdt)}">${signed(balance.gainUsdt)}</td>
      <td class="right"><button class="table-link" data-action="person" data-id="${h(person.id)}" aria-label="View ${h(person.name)}">View →</button></td></tr>`;
  }).join("");
  content.innerHTML = `<div class="page">
    <div class="page-heading"><div><h1>Overview</h1><p>Each purchase lot is one person's portion of a daily buy. Cash and token values use USDT, a digital dollar.</p></div>
      <button class="button ghost" data-action="add-person">＋ Add stakeholder</button></div>
    ${notices(summary)}
    <div class="metric-grid">
      ${metric("CURRENT POOL VALUE", priced ? money(summary.poolValueUsdt) : "—", rate && priced ? php(summary.poolValueUsdt * rate) + " estimated" : "Waiting for a market quote")}
      ${metric("TOTAL CONTRIBUTIONS", money(summary.contributedUsdt), state.contributions.filter((item) => !item.voidedAt).length + " recorded")}
      ${metric("SIMULATED GAIN / LOSS", priced ? signed(summary.gainUsdt) : "—", "Since contributions", gainClass(summary.gainUsdt))}
      ${metric("LAST DAILY CHANGE", last ? signed(last.poolChangeUsdt) : "—", last ? date(last.day) + " · 08:00 PHT snapshot" : "No completed buy day yet", gainClass(last?.poolChangeUsdt))}
    </div>
    <div class="two-col">
      <section class="card"><div class="card-head"><div><h2>Pool value over time</h2><p>USDT, including unspent cash</p></div><span class="mini">${summary.history.length} daily snapshots</span></div><div class="chart-wrap">${chart(summary.history, (row) => row.poolValueUsdt)}</div></section>
      <section class="card"><div class="card-head"><div><h2>Token holdings</h2><p>Current estimated value</p></div><span class="mini">${assets.length} tokens</span></div>
        <div class="asset-list">${assets.length ? assets.map((row) => {
          const pct = investedValue ? (row.valueUsdt ?? 0) / investedValue * 100 : 0;
          return `<div class="asset-row"><div class="coin-mark">${h(asset(row.id).symbol.slice(0, 1))}</div><div><strong>${h(asset(row.id).name)}</strong><small>${quantityFormat.format(row.quantity)} ${h(asset(row.id).symbol)} · ${pct.toFixed(1)}%</small><div class="progress"><span style="width:${pct}%"></span></div></div><div class="amount">${money(row.valueUsdt)}<small>${money(row.priceUsdt)} / token</small><small class="${gainClass(row.priceMovePct)}">${row.priceMovePct == null ? "" : (row.priceMovePct > 0 ? "+" : "") + row.priceMovePct.toFixed(2) + "% vs prior daily price"}</small></div></div>`;
        }).join("") : '<div class="empty-chart"><div><strong>No token lots yet</strong>Daily buys will appear here.</div></div>'}</div></section>
    </div>
    <section class="card table-card"><div class="card-head"><div><h2>Stakeholders</h2><p>Every value is attributed to one person</p></div></div>
      ${rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Contributed</th><th>Unspent</th><th class="right">Current value</th><th class="right">Gain / loss</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="empty-state"><div class="empty-symbol">◎</div><h2>Start with a stakeholder</h2><p>Add the people sharing the pool, then record their PHP contributions.</p><button class="button primary" data-action="add-person">Add stakeholder</button></div>'}
    </section>
    ${summary.quote ? `<p class="help" style="margin-top:16px">Market quote: ${h(summary.quote.provider)} · ${h(dateTime(summary.quote.at))}. The USDT/PHP rate is pesos per 1 USDT. Simulated values are estimates, not exchange balances.</p>` : ""}
  </div>`;
}

function renderPeople(summary) {
  if (selectedPerson && !state.stakeholders.some((person) => person.id === selectedPerson)) selectedPerson = null;
  if (selectedPerson) return renderPersonDetail(summary, selectedPerson);
  content.innerHTML = `<div class="page"><div class="page-heading"><div><span class="eyebrow">INDIVIDUAL OWNERSHIP</span><h1>Stakeholders</h1><p>Each person has their own USDT cash and token lots.</p></div><button class="button ghost" data-action="add-person">＋ Add stakeholder</button></div>
    ${notices(summary)}<div class="person-grid">${state.stakeholders.map((person) => {
      const balance = summary.balances[person.id];
      return `<button class="card person-card" data-action="person" data-id="${h(person.id)}"><div class="person-head"><span class="avatar">${h(initials(person.name))}</span><div><strong>${h(person.name)}</strong><small>${balance?.lots.length ?? 0} token lots</small></div></div>
        <div class="person-value">${money(balance?.valueUsdt)}</div><div class="person-foot"><span>Current value</span><span class="${gainClass(balance?.gainUsdt)}">${signed(balance?.gainUsdt)}</span></div></button>`;
    }).join("") || '<div class="card empty-state"><div class="empty-symbol">◎</div><h2>No stakeholders yet</h2><p>Add a person to begin tracking their share.</p><button class="button primary" data-action="add-person">Add stakeholder</button></div>'}</div></div>`;
}

function renderPersonDetail(summary, id) {
  const person = state.stakeholders.find((entry) => entry.id === id);
  const balance = summary.balances[id];
  const rows = assetRows(summary, id);
  const history = summary.history.filter((row) => row.values[id]);
  const contributions = state.contributions.filter((item) => item.stakeholderId === id && !item.voidedAt);
  content.innerHTML = `<div class="page"><button class="back-link" data-action="back-people">← All stakeholders</button>
    <div class="page-heading"><div><span class="eyebrow">STAKEHOLDER REPORT</span><h1>${h(person.name)}</h1><p>Individually attributed holdings and daily value changes.</p></div>
      <div class="top-actions"><button class="button ghost" data-action="print-report">Print / save PDF</button><button class="button ghost" data-action="export-report" data-id="${h(id)}">↓ Daily CSV</button></div></div>
     ${notices(summary)}<p class="help">USDT is the digital dollar used for unspent cash and token prices here. Current estimated portfolio PHP value uses the latest captured quote. Contribution PHP amounts and their conversion rates remain as recorded.</p><div class="detail-summary">
      ${metric("CURRENT VALUE", money(balance.valueUsdt), balance.valueUsdt != null && summary.quote ? php(balance.valueUsdt * summary.quote.usdtPhp) + " estimated" : "")}
      ${metric("CONTRIBUTED", money(balance.contributedUsdt), contributions.length + " contributions")}
      ${metric("GAIN / LOSS", signed(balance.gainUsdt), "Including unrealized movement", gainClass(balance.gainUsdt))}
    </div>
    <section class="card"><div class="card-head"><div><h2>Value history</h2><p>Daily 08:00 PHT snapshots</p></div><span class="mini">${history.length} days</span></div><div class="chart-wrap">${chart(history, (row) => row.values[id].valueUsdt)}</div></section>
    <section class="card table-card"><div class="card-head"><div><h2>Token breakdown</h2><p>Lots belong only to ${h(person.name)}</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Token</th><th>Quantity</th><th>Cost basis</th><th>Market price</th><th class="right">Value</th><th class="right">Gain / loss</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td><strong>${h(asset(row.id).symbol)}</strong><br><span class="muted">${h(asset(row.id).name)}</span></td><td>${quantityFormat.format(row.quantity)}</td><td>${money(row.costUsdt)}</td><td>${money(row.priceUsdt)}<br><span class="${gainClass(row.priceMovePct)}">${row.priceMovePct == null ? "" : (row.priceMovePct > 0 ? "+" : "") + row.priceMovePct.toFixed(2) + "% vs prior day"}</span></td><td class="right"><strong>${money(row.valueUsdt)}</strong></td><td class="right ${gainClass((row.valueUsdt ?? 0) - row.costUsdt)}">${row.valueUsdt == null ? "—" : signed(row.valueUsdt - row.costUsdt)}</td></tr>`).join("") || '<tr><td colspan="6">No token purchases yet.</td></tr>'}
      </tbody></table></div></section>
    <section class="card table-card"><div class="card-head"><div><h2>Daily change</h2><p>After subtracting newly credited contributions</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Day</th><th>Value</th><th>Contributed by then</th><th class="right">Daily change</th></tr></thead><tbody>${history.slice().reverse().slice(0, 30).map((row) => `<tr><td>${h(date(row.day))}</td><td>${money(row.values[id].valueUsdt)}</td><td>${money(row.values[id].contributedUsdt)}</td><td class="right ${gainClass(row.values[id].changeUsdt)}">${signed(row.values[id].changeUsdt)}</td></tr>`).join("") || '<tr><td colspan="4">No daily snapshots yet.</td></tr>'}</tbody></table></div></section>
    <section class="card table-card"><div class="card-head"><div><h2>Purchase lots</h2><p>A lot is this person's portion of one daily token buy, kept at its purchase cost and quantity.</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Day</th><th>Token</th><th>Type</th><th>Spent</th><th>Quantity</th><th>Effective price</th><th class="right">Fee included</th></tr></thead><tbody>
      ${balance.lots.slice().reverse().map((lot) => `<tr><td>${h(date(lot.day))}</td><td><strong>${h(asset(lot.assetId).symbol)}</strong></td><td><span class="tag ${lot.kind}">${lot.kind === "recorded" ? "Recorded" : "Simulated"}</span></td><td>${money(lot.costUsdt)}</td><td>${quantityFormat.format(lot.quantity)}</td><td>${money(lot.priceUsdt)}</td><td class="right">${money(lot.feeUsdt)}</td></tr>`).join("") || '<tr><td colspan="7">No purchase lots yet.</td></tr>'}
      </tbody></table></div></section>
    <section class="card table-card"><div class="card-head"><div><h2>Contributions</h2><p>PHP per USDT is the captured rate used to estimate how much USDT each PHP contribution represents.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Received</th><th>PHP</th><th>PHP per USDT</th><th>Simulated USDT</th><th>Buy days</th></tr></thead><tbody>
      ${contributions.map((item) => `<tr><td>${h(dateTime(item.receivedAt))}</td><td>${php(item.php)}</td><td>${php(item.phpPerUsdt)}</td><td>${money(item.usdt)}</td><td>${item.days} from ${h(date(item.firstBuyDay))}</td></tr>`).join("") || '<tr><td colspan="5">No contributions yet.</td></tr>'}
      </tbody></table></div></section>
    <p class="help" style="margin-top:17px">Simulated values use market quotes and exclude unrecorded exchange fees. A recorded execution is operator-entered and not exchange-verified.</p>
  </div>`;
}

function tradeGroups(summary) {
  const map = new Map();
  for (const lot of summary.lots) {
    const key = lot.day + "|" + lot.assetId;
    const group = map.get(key) ?? { day: lot.day, assetId: lot.assetId,
      costUsdt: 0, quantity: 0, feeUsdt: 0, kind: lot.kind, stakeholders: new Set() };
    group.costUsdt += lot.costUsdt;
    group.quantity += lot.quantity;
    group.feeUsdt += lot.feeUsdt;
    group.stakeholders.add(lot.stakeholderId);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function contributionQuoteLabel(item) {
  return item.quoteAt && item.quoteProvider
    ? h(item.quoteProvider) + " · " + h(dateTime(item.quoteAt))
    : "Source/time not recorded (legacy entry)";
}

function renderActivity(summary) {
  const buys = tradeGroups(summary);
  const contributions = state.contributions.slice()
    .sort((a, b) => (b.recordedAt ?? b.receivedAt).localeCompare(a.recordedAt ?? a.receivedAt));
  content.innerHTML = `<div class="page"><div class="page-heading"><div><span class="eyebrow">COMPLETE LEDGER</span><h1>Activity</h1><p>Contributions, daily buys, and recorded executions.</p></div></div>
    ${notices(summary)}<div class="activity-filters"><button data-action="filter" data-filter="all" class="${activityFilter === "all" ? "active" : ""}">All activity</button><button data-action="filter" data-filter="buys" class="${activityFilter === "buys" ? "active" : ""}">Daily buys</button><button data-action="filter" data-filter="contributions" class="${activityFilter === "contributions" ? "active" : ""}">Contributions</button></div>
    ${activityFilter !== "contributions" ? `<section class="card"><div class="card-head"><div><h2>Token buys</h2><p>Grouped by day and token across participating people</p></div><span class="mini">${buys.length} entries</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Day</th><th>Token</th><th>Type</th><th>People</th><th>Spent</th><th>Quantity</th><th class="right"></th></tr></thead><tbody>
      ${buys.map((group) => `<tr><td>${h(date(group.day))}</td><td><strong>${h(asset(group.assetId).symbol)}</strong></td><td><span class="tag ${group.kind}">${group.kind === "recorded" ? "Recorded execution" : "Simulated"}</span></td><td>${group.stakeholders.size}</td><td>${money(group.costUsdt)}</td><td>${quantityFormat.format(group.quantity)}</td><td class="right"><button class="table-link" data-action="trade" data-day="${h(group.day)}" data-asset="${h(group.assetId)}" aria-label="${group.kind === "recorded" ? "Edit recorded" : "Replace simulated"} ${h(asset(group.assetId).symbol)} buy on ${h(date(group.day))}">${group.kind === "recorded" ? "Edit" : "Replace"} →</button></td></tr>`).join("") || '<tr><td colspan="7">No buys yet. Daily buys appear after a contribution and price refresh.</td></tr>'}
      </tbody></table></div></section>` : ""}
    ${activityFilter !== "buys" ? `<section class="card table-card"><div class="card-head"><div><h2>Contributions and corrections</h2><p>USDT conversions are simulated estimates from the stated quotes. Voided records remain visible for audit.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Received (PHT)</th><th>Stakeholder</th><th>PHP</th><th>Conversion quote</th><th>Simulated USDT</th><th>Buy plan</th><th>Status / audit</th><th></th></tr></thead><tbody>
      ${contributions.map((item) => `<tr><td>${h(dateTime(item.receivedAt))}<br><span class="muted">Record #${h(item.id.slice(0, 8))}</span></td><td><strong>${h(state.stakeholders.find((person) => person.id === item.stakeholderId)?.name ?? "Unknown")}</strong></td><td>${php(item.php)}</td><td>${php(item.phpPerUsdt)}<br><span class="muted">${contributionQuoteLabel(item)}</span></td><td>${money(item.usdt)}</td><td>${item.days} day${item.days === 1 ? "" : "s"}<br><span class="muted">First buy ${h(date(item.firstBuyDay))}</span></td><td>${item.voidedAt ? `<strong>Voided ${h(dateTime(item.voidedAt))}</strong><br>${h(item.voidReason ?? "Reason not recorded")}<br><span class="muted">Replaced by #${h(item.replacedById?.slice(0, 8) ?? "unknown")}</span>` : "<strong>Active</strong>"}${item.correctsId ? `<br><span class="muted">Corrects #${h(item.correctsId.slice(0, 8))}</span>` : ""}</td><td>${item.voidedAt ? "" : `<button class="table-link" type="button" data-action="correct-contribution" data-id="${h(item.id)}" aria-label="Correct ${h(state.stakeholders.find((person) => person.id === item.stakeholderId)?.name ?? "Unknown")}'s contribution received ${h(dateTime(item.receivedAt))}">Correct →</button>`}</td></tr>`).join("") || '<tr><td colspan="8">No contributions yet.</td></tr>'}</tbody></table></div></section>` : ""}
  </div>`;
}

function renderSettings(summary) {
  const targets = currentTargets();
  const targetMap = Object.fromEntries(targets.map((entry) => [entry.assetId, entry.weight]));
  const row = (coin) => `<div class="target-row"><input id="target-${coin.id}" type="checkbox" data-asset="${coin.id}" aria-label="Include ${coin.name}" ${targetMap[coin.id] != null ? "checked" : ""}><label for="target-${coin.id}">${coin.name} <span class="muted">· ${coin.symbol}</span></label><input type="number" data-weight="${coin.id}" min="0.01" max="100" step="0.01" value="${targetMap[coin.id] ?? 0}" aria-label="${coin.name} weight percent" aria-describedby="targetError" ${targetMap[coin.id] == null ? "disabled" : ""}></div>`;
  const selected = ASSETS.filter((coin) => targetMap[coin.id] != null);
  const additional = ASSETS.filter((coin) => targetMap[coin.id] == null);
  content.innerHTML = `<div class="page"><div class="page-heading"><div><h1>Settings</h1><p>Set the token mix for future daily buys and protect your records.</p></div></div>
    ${notices(summary)}<div class="settings-grid">
      <section class="card settings-card"><h2>Daily token mix</h2><p>Every stakeholder follows this mix. Changes apply to future daily buys; past purchase lots keep their original mix.</p>
        <form id="targetsForm" novalidate>${selected.map(row).join("")}
          ${additional.length ? `<details><summary>Additional tokens (${additional.length})</summary>${additional.map(row).join("")}</details>` : ""}
          <div id="targetError" class="settings-total bad" role="alert" tabindex="-1" hidden></div>
          <div class="settings-actions"><div class="settings-total" id="targetTotal" aria-live="polite"></div><button class="button primary" type="submit">Save token mix</button></div>
          ${state.stakeholders.length && !state.contributions.some((item) => !item.voidedAt) ? '<div class="settings-actions"><button class="button ghost" type="button" data-action="new-contribution">Record first contribution</button></div>' : ""}</form></section>
      <section class="card settings-card"><h2>Back up your records</h2><p>This browser holds the working ledger. Download a JSON backup after changes and keep it somewhere safe; clearing browser data can erase this copy.</p>
        <div class="setting-note">The backup includes contributions, price snapshots, and recorded executions. Restoring one replaces the entire current ledger.</div>
        <p class="backup-status" role="status">${backupNeeded ? "Backup needed for current ledger." : backupVerifiedAt ? "Current ledger verified against a selected backup on " + h(dateTime(backupVerifiedAt)) + "." : "No backup has been verified for this ledger."}</p>
        <div class="settings-actions"><button class="button primary" data-action="export-backup">Download JSON backup</button><button class="button ghost" data-action="verify-backup">Verify saved file</button><button class="button ghost" data-action="import-backup">Restore from backup</button></div>
        <div class="setting-note" style="margin-top:22px">Market data: CoinGecko keyless public API. ${summary.quote ? "Latest quote " + h(dateTime(summary.quote.at)) + "." : "No quote captured yet."}</div>
      </section>
    </div></div>`;
  updateTargetTotal();
}

function render() {
  const summary = result();
  const titles = { overview: "Overview", people: "Stakeholders", activity: "Activity", settings: "Settings" };
  pageTitle.textContent = titles[view];
  document.querySelectorAll(".nav button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "people") renderPeople(summary);
  else if (view === "activity") renderActivity(summary);
  else if (view === "settings") renderSettings(summary);
  else renderOverview(summary);
  for (const table of content.querySelectorAll(".data-table")) {
    table.setAttribute("role", "table");
    table.tHead?.setAttribute("role", "rowgroup");
    table.tBodies[0]?.setAttribute("role", "rowgroup");
    const headers = [...table.querySelectorAll("thead th")];
    headers.forEach((header) => { header.scope = "col"; header.setAttribute("role", "columnheader"); });
    table.querySelector("thead tr")?.setAttribute("role", "row");
    table.querySelectorAll("tbody tr").forEach((row) => {
      row.setAttribute("role", "row");
      [...row.cells].forEach((cell, index) => {
        cell.setAttribute("role", index === 0 && cell.colSpan === 1 ? "rowheader" : "cell");
        if (cell.colSpan !== 1) {
          cell.setAttribute("aria-colspan", String(cell.colSpan));
          return;
        }
        cell.dataset.label = headers[index]?.textContent.trim() || "Action";
        const value = document.createElement("span");
        value.className = "cell-value";
        while (cell.firstChild) value.append(cell.firstChild);
        cell.append(value);
      });
    });
  }
  const quoteAge = state.latestQuote
    ? Date.now() - Date.parse(state.latestQuote.at) : Infinity;
  setStatus(busy ? "" : quoteAge < 30 * 60_000 ? "ok" : "bad",
    busy ? "Refreshing prices…" : quoteAge < 30 * 60_000
      ? "Market quote ready" : "Market quote needs refresh");
  document.querySelector("#refreshButton").disabled = busy;
}

function updateTargetTotal() {
  const form = document.querySelector("#targetsForm");
  if (!form) return;
  const selected = [...form.querySelectorAll("[data-asset]:checked")];
  form.querySelectorAll("[data-asset]").forEach((checkbox) => {
    form.querySelector('[data-weight="' + checkbox.dataset.asset + '"]').disabled = !checkbox.checked;
  });
  form.querySelectorAll("[data-weight]").forEach((input) => input.removeAttribute("aria-invalid"));
  let total = 0;
  let error = "";
  let errorField = null;
  if (!selected.length) {
    error = "Select at least one token.";
    errorField = form.querySelector("[data-asset]");
  }
  for (const checkbox of selected) {
    const input = form.querySelector('[data-weight="' + checkbox.dataset.asset + '"]');
    const weight = Number(input.value);
    const name = asset(checkbox.dataset.asset).name;
    if (!error && (!input.value.trim() || !Number.isFinite(weight) || weight <= 0)) {
      error = "Enter a weight above 0% for " + name + ".";
      errorField = input;
    } else if (!error && weight > 100) {
      error = name + " cannot exceed 100%.";
      errorField = input;
    } else if (!error && input.validity.stepMismatch) {
      error = "Use at most two decimal places for " + name + ".";
      errorField = input;
    }
    if (Number.isFinite(weight)) total += weight;
  }
  if (!error && Math.abs(total - 100) >= 0.001) {
    error = "Selected weights total " + total.toFixed(2) + "%. Adjust them to 100%.";
    errorField = selected[0] && form.querySelector('[data-weight="' + selected[0].dataset.asset + '"]');
  }
  const output = document.querySelector("#targetTotal");
  output.textContent = "Selected total: " + total.toFixed(2) + "% / 100%";
  output.classList.toggle("bad", Boolean(error));
  const message = document.querySelector("#targetError");
  message.textContent = error;
  message.hidden = !error;
  if (errorField) errorField.setAttribute("aria-invalid", "true");
  return { error, errorField };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 429
    ? "CoinGecko is rate limiting requests. Wait a minute and refresh again."
    : "Market data request failed (" + response.status + ").");
  return response.json();
}

async function refreshPrices() {
  if (busy) return;
  busy = true;
  statusMessage = "";
  render();
  try {
    const ids = allAssetIds();
    const params = new URLSearchParams({
      ids: ["tether", ...ids].join(","),
      vs_currencies: "usd,php",
      include_last_updated_at: "true",
      precision: "full",
    });
    const current = await fetchJson(API + "/simple/price?" + params);
    const quote = quoteFromSimplePrice(current, ids);
    if (Date.now() - Date.parse(quote.at) > 30 * 60_000) {
      throw new Error("The market quote is stale. Try refreshing again.");
    }
    state.latestQuote = quote;
    save();

    const active = state.contributions.filter((item) => !item.voidedAt);
    if (active.length) {
      const earliest = active.map((item) => item.firstBuyDay).sort()[0];
      const through = latestCompleteDay();
      if (earliest <= through) {
        const missing = [];
        for (let day = earliest; day <= through; day = addDays(day, 1)) {
          const needed = [...new Set(state.targetsHistory
            .filter((version) => version.effectiveDay <= day)
            .flatMap((version) => version.targets.map((target) => target.assetId)))];
          if (!state.priceDays[day] ||
              needed.some((id) => !state.priceDays[day].tokenUsdt?.[id])) {
            missing.push(day);
          }
        }
        if (missing.length) {
          const oldest = missing[0];
          if (daysBetween(oldest, through) > 364) {
            throw new Error("A missing daily quote is over 365 days old. The keyless price source cannot backfill it automatically.");
          }
          const days = Math.min(365, daysBetween(oldest, through) + 2);
          const chartParams = (currency) => new URLSearchParams({
            vs_currency: currency, days: String(days), interval: "daily",
            precision: "full",
          });
          const charts = {
            tetherUsd: await fetchJson(API + "/coins/tether/market_chart?" + chartParams("usd")),
            tetherPhp: await fetchJson(API + "/coins/tether/market_chart?" + chartParams("php")),
          };
          for (const id of ids) {
            charts[id] = await fetchJson(API + "/coins/" + encodeURIComponent(id) +
              "/market_chart?" + chartParams("usd"));
          }
          const snapshots = dailyPricesFromCharts(charts, ids);
          for (const [day, snapshot] of snapshots) {
            const previous = state.priceDays[day];
            state.priceDays[day] = previous
              ? { ...previous, tokenUsdt: {
                  ...snapshot.tokenUsdt, ...previous.tokenUsdt,
                } }
              : snapshot;
          }
          save();
        }
      }
    }
    notify("Market prices and daily buys are up to date.");
  } catch (error) {
    statusMessage = error.message || "Could not refresh market data.";
    notify(statusMessage);
  } finally {
    busy = false;
    render();
  }
}

function openStakeholder() {
  document.querySelector("#stakeholderForm").reset();
  document.querySelector("#stakeholderDialog").showModal();
}

function openContribution() {
  if (!state.stakeholders.length) {
    notify("Add a stakeholder first.");
    openStakeholder();
    return;
  }
  const form = document.querySelector("#contributionForm");
  form.reset();
  clearContributionError();
  delete form.dataset.correctionId;
  form.elements.days.value = 30;
  form.elements.receivedAt.value = manilaLocalValue();
  form.elements.receivedAt.max = manilaLocalValue();
  form.elements.stakeholderId.innerHTML = state.stakeholders.map((person) =>
    `<option value="${h(person.id)}">${h(person.name)}</option>`).join("");
  document.querySelector("#correctionReasonField").hidden = true;
  form.elements.correctionReason.required = false;
  document.querySelector("#contributionMode").textContent = "NEW CONTRIBUTION";
  document.querySelector("#contributionDialog h2").textContent = "Record money received";
  form.querySelector('button[type="submit"]').textContent = "Record contribution";
  updateContributionPreview();
  document.querySelector("#contributionDialog").showModal();
}

function openCorrection(id) {
  const original = state.contributions.find((item) => item.id === id && !item.voidedAt);
  if (!original) return notify("That contribution is no longer active.");
  const form = document.querySelector("#contributionForm");
  form.reset();
  clearContributionError();
  form.dataset.correctionId = id;
  form.elements.stakeholderId.innerHTML = state.stakeholders.map((person) =>
    `<option value="${h(person.id)}">${h(person.name)}</option>`).join("");
  form.elements.stakeholderId.value = original.stakeholderId;
  form.elements.receivedAt.value = manilaLocalValue(original.receivedAt);
  form.elements.receivedAt.max = manilaLocalValue();
  form.elements.php.value = original.php;
  form.elements.days.value = original.days;
  document.querySelector("#correctionReasonField").hidden = false;
  form.elements.correctionReason.required = true;
  document.querySelector("#contributionMode").textContent = "CONTRIBUTION CORRECTION";
  document.querySelector("#contributionDialog h2").textContent = "Correct contribution";
  form.querySelector('button[type="submit"]').textContent = "Save correction";
  updateContributionPreview();
  document.querySelector("#contributionDialog").showModal();
}

function updateContributionPreview() {
  const form = document.querySelector("#contributionForm");
  const amount = Number(form.elements.php.value);
  const original = state.contributions.find((item) => item.id === form.dataset.correctionId);
  const quote = original ? { usdtPhp: original.phpPerUsdt,
    at: original.quoteAt, provider: original.quoteProvider } : state.latestQuote;
  const fresh = original || quote && Date.now() - Date.parse(quote.at) < 30 * 60_000;
  const preview = document.querySelector("#contributionQuote");
  let firstDay;
  try { firstDay = firstBuyDay(receiptTimeToIso(form.elements.receivedAt.value)); }
  catch (error) { preview.textContent = error.message; return; }
  preview.textContent = fresh
    ? (amount > 0 ? php(amount) + " ≈ " + money(amount / quote.usdtPhp) :
      "1 USDT ≈ " + php(quote.usdtPhp)) + " · first buy " + date(firstDay) +
      " · quote " + (quote.provider ?? "source not recorded") + " at " +
      (quote.at ? dateTime(quote.at) : "time not recorded") +
      ". This is a simulated estimate" +
      (quote.at && Date.parse(form.elements.receivedAt.value + ":00+08:00") < Date.parse(quote.at)
        ? " using a quote captured after receipt." : ".")
    : "Refresh market prices to capture a current USDT/PHP quote.";
}

function clearContributionError() {
  const error = document.querySelector("#contributionError");
  error.textContent = "";
  error.hidden = true;
}

function showContributionError(message) {
  const error = document.querySelector("#contributionError");
  error.textContent = message;
  error.hidden = false;
  error.focus();
}

function openTrade(day, assetId) {
  const group = tradeGroups(result()).find((entry) => entry.day === day &&
    entry.assetId === assetId);
  if (!group) return notify("That daily buy is not available yet.");
  const form = document.querySelector("#tradeForm");
  form.elements.day.value = day;
  form.elements.assetId.value = assetId;
  form.elements.costUsdt.value = round(group.costUsdt, 8);
  form.elements.quantity.value = round(group.quantity, 10);
  form.elements.feeUsdt.value = round(group.feeUsdt, 8);
  document.querySelector("#tradeContext").textContent =
    date(day) + " · " + asset(assetId).symbol + " · " + group.stakeholders.size +
    " stakeholders · " + (group.kind === "recorded" ? "recorded " : "planned ") +
    money(group.costUsdt);
  document.querySelector("#tradeDialog").showModal();
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value ?? "");
  return '"' + (text.startsWith("=") || text.startsWith("+") ||
    text.startsWith("-") || text.startsWith("@") ? "'" : "") +
    text.replaceAll('"', '""') + '"';
}

function exportReport(personId) {
  const summary = result();
  const person = state.stakeholders.find((entry) => entry.id === personId);
  if (!person) return;
  const rows = [["Day", "Stakeholder", "Value USDT", "Daily change USDT",
    "Contributed USDT by then", "PHP per USDT", "Estimated value PHP"]];
  for (const row of summary.history) {
    const value = row.values[personId];
    if (!value) continue;
    rows.push([row.day, person.name, value.valueUsdt, value.changeUsdt,
      value.contributedUsdt, row.usdtPhp, value.valueUsdt * row.usdtPhp]);
  }
  download("crypto-savings-" + person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
    "-daily.csv", rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
  "text/csv;charset=utf-8");
}

function validateBackup(candidate) {
  const validDay = (day) => typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    day >= "2010-01-01" && !Number.isNaN(Date.parse(day + "T00:00:00Z")) &&
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
  const validPrices = (prices) => prices && typeof prices === "object" &&
    Object.entries(prices).every(([id, price]) =>
      ASSETS.some((coin) => coin.id === id) && Number.isFinite(price) && price > 0);
  if (candidate?.version !== 1 ||
      !Array.isArray(candidate.stakeholders) ||
      !Array.isArray(candidate.contributions) ||
      !Array.isArray(candidate.targetsHistory) ||
      !Array.isArray(candidate.manualTrades) ||
      !candidate.priceDays || typeof candidate.priceDays !== "object" ||
      candidate.stakeholders.length > 1000 ||
      candidate.contributions.length > 5000 ||
      candidate.manualTrades.length > 20000 ||
      candidate.targetsHistory.length > 1000 ||
      Object.keys(candidate.priceDays).length > 10000 ||
      !candidate.targetsHistory.every((version) =>
        (version.effectiveDay === "0000-01-01" || validDay(version.effectiveDay)) &&
        validTargets(version.targets))) {
    throw new Error("This is not a valid Crypto Savings backup.");
  }
  const ids = new Set(candidate.stakeholders.map((person) => person.id));
  const contributionIds = new Set(candidate.contributions.map((item) => item.id));
  if (ids.size !== candidate.stakeholders.length ||
      contributionIds.size !== candidate.contributions.length ||
      !candidate.stakeholders.every((person) => typeof person.id === "string" &&
        typeof person.name === "string" && person.name.length > 0 &&
        person.name.length <= 80) ||
      !candidate.contributions.every((item) => ids.has(item.stakeholderId) &&
        typeof item.id === "string" &&
        typeof item.receivedAt === "string" &&
        Number.isFinite(Date.parse(item.receivedAt)) &&
        Number.isFinite(item.usdt) && item.usdt > 0 &&
        Number.isFinite(item.php) && item.php > 0 &&
        Number.isFinite(item.phpPerUsdt) && item.phpPerUsdt > 0 &&
        Number.isInteger(item.days) && item.days >= 1 && item.days <= 365 &&
        validDay(item.firstBuyDay) &&
        (item.quoteAt == null || typeof item.quoteAt === "string" &&
          Number.isFinite(Date.parse(item.quoteAt))) &&
        (item.quoteProvider == null || typeof item.quoteProvider === "string") &&
        (item.recordedAt == null || typeof item.recordedAt === "string" &&
          Number.isFinite(Date.parse(item.recordedAt))) &&
        (item.voidedAt == null || typeof item.voidedAt === "string" &&
          Number.isFinite(Date.parse(item.voidedAt))) &&
        (item.voidReason == null || typeof item.voidReason === "string") &&
        (item.replacedById == null || typeof item.replacedById === "string") &&
        (item.correctsId == null || typeof item.correctsId === "string")) ||
      !candidate.manualTrades.every((trade) => validDay(trade.day) &&
        ASSETS.some((coin) => coin.id === trade.assetId) &&
        Number.isFinite(trade.costUsdt) && trade.costUsdt > 0 &&
        Number.isFinite(trade.quantity) && trade.quantity > 0 &&
        Number.isFinite(trade.feeUsdt) && trade.feeUsdt >= 0 &&
        trade.feeUsdt <= trade.costUsdt) ||
      !Object.entries(candidate.priceDays).every(([day, quote]) =>
        validDay(day) && Number.isFinite(quote.usdtPhp) && quote.usdtPhp > 0 &&
        (quote.at == null || typeof quote.at === "string" &&
          Number.isFinite(Date.parse(quote.at))) &&
        (quote.provider == null || typeof quote.provider === "string") &&
        validPrices(quote.tokenUsdt)) ||
      candidate.latestQuote && (typeof candidate.latestQuote.at !== "string" ||
        !Number.isFinite(Date.parse(candidate.latestQuote.at)) ||
        !Number.isFinite(candidate.latestQuote.usdtPhp) ||
        candidate.latestQuote.usdtPhp <= 0 ||
        typeof candidate.latestQuote.provider !== "string" ||
        !validPrices(candidate.latestQuote.tokenUsdt))) {
    throw new Error("The backup contains invalid ledger entries.");
  }
  if (candidate.contributions.some((item) =>
    item.correctsId && !candidate.contributions.some((original) =>
      original.id === item.correctsId && original.replacedById === item.id &&
      original.voidedAt && original.voidReason) ||
    item.replacedById && !candidate.contributions.some((replacement) =>
      replacement.id === item.replacedById && replacement.correctsId === item.id)) ||
    orphanedRecordedExecutions(candidate).length || replay(candidate).error) {
    throw new Error("The backup contains an invalid correction or recorded execution.");
  }
}

const sidebar = document.querySelector("#primarySidebar");
const mainWrap = document.querySelector(".main-wrap");
const menuButton = document.querySelector("#menuButton");
const closeMenuButton = document.querySelector("#closeMenuButton");
const mobileNav = window.matchMedia("(max-width: 700px)");

function setMenuOpen(open, returnFocus = false) {
  const expanded = mobileNav.matches && open;
  sidebar.classList.toggle("open", expanded);
  sidebar.hidden = mobileNav.matches && !expanded;
  sidebar.inert = mobileNav.matches && !expanded;
  mainWrap.inert = expanded;
  menuButton.setAttribute("aria-expanded", String(expanded));
  menuButton.setAttribute("aria-label", expanded ? "Close navigation menu" : "Open navigation menu");
  menuButton.textContent = expanded ? "Close" : "Menu";
  if (expanded) closeMenuButton.focus();
  else if (returnFocus) menuButton.focus();
}

function focusPageStart() {
  content.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

setMenuOpen(false);
mobileNav.addEventListener("change", () => {
  const focusWasInSidebar = sidebar.contains(document.activeElement);
  setMenuOpen(false);
  if (focusWasInSidebar) {
    if (mobileNav.matches) menuButton.focus();
    else sidebar.querySelector(".nav button.active")?.focus();
  }
});

document.querySelectorAll(".nav button").forEach((button) => button.addEventListener("click", () => {
  view = button.dataset.view;
  if (view !== "people") selectedPerson = null;
  setMenuOpen(false);
  render();
  focusPageStart();
}));
menuButton.addEventListener("click", () => setMenuOpen(!sidebar.classList.contains("open")));
closeMenuButton.addEventListener("click", () => setMenuOpen(false, true));
document.addEventListener("keydown", (event) => {
  if (!sidebar.classList.contains("open")) return;
  if (event.key === "Escape") {
    setMenuOpen(false, true);
    return;
  }
  if (event.key === "Tab") {
    const focusable = [...sidebar.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
document.addEventListener("pointerdown", (event) => {
  if (sidebar.classList.contains("open") && !sidebar.contains(event.target) &&
      !menuButton.contains(event.target)) setMenuOpen(false, true);
});
document.querySelector("#refreshButton").addEventListener("click", refreshPrices);
document.querySelector("#addContributionButton").addEventListener("click", openContribution);
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () =>
  button.closest("dialog").close()));
document.querySelector("#contributionForm").addEventListener("input", () => {
  clearContributionError();
  updateContributionPreview();
});

document.querySelector("#stakeholderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = event.currentTarget.elements.name.value.trim();
  if (!name || state.stakeholders.some((person) =>
    person.name.toLowerCase() === name.toLowerCase())) {
    notify("Enter a unique stakeholder name.");
    return;
  }
  state.stakeholders.push({ id: crypto.randomUUID(), name });
  save();
  document.querySelector("#stakeholderDialog").close();
  notify(name + " added.");
  render();
});

document.querySelector("#contributionForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const original = state.contributions.find((item) => item.id === form.dataset.correctionId && !item.voidedAt);
  if (form.dataset.correctionId && !original) return showContributionError("That contribution is no longer active.");
  const quote = original ? { usdtPhp: original.phpPerUsdt,
    at: original.quoteAt, provider: original.quoteProvider } : state.latestQuote;
  if (!original && (!quote || Date.now() - Date.parse(quote.at) >= 30 * 60_000)) {
    showContributionError("Refresh market prices before recording this contribution.");
    return;
  }
  const phpAmount = Number(form.elements.php.value);
  const days = Number(form.elements.days.value);
  if (!Number.isFinite(phpAmount) || phpAmount <= 0 ||
      !Number.isInteger(days) || days < 1 || days > 365) {
    showContributionError("Enter a positive PHP amount and 1–365 buy days.");
    return;
  }
  let receivedAt;
  try { receivedAt = receiptTimeToIso(form.elements.receivedAt.value); }
  catch (error) { showContributionError(error.message); return; }
  if (!state.stakeholders.some((person) => person.id === form.elements.stakeholderId.value)) {
    showContributionError("Choose a valid stakeholder.");
    return;
  }
  const reason = form.elements.correctionReason.value.trim();
  if (original && !reason) return showContributionError("Explain why this contribution is being corrected.");
  const recordedAt = new Date().toISOString();
  const replacement = {
    id: crypto.randomUUID(),
    stakeholderId: form.elements.stakeholderId.value,
    receivedAt,
    recordedAt,
    php: phpAmount,
    phpPerUsdt: quote.usdtPhp,
    usdt: round(phpAmount / quote.usdtPhp, 8),
    firstBuyDay: firstBuyDay(receivedAt),
    days,
    ...(quote.at ? { quoteAt: quote.at } : {}),
    ...(quote.provider ? { quoteProvider: quote.provider } : {}),
    ...(original ? { correctsId: original.id } : {}),
  };
  if (replacement.usdt <= 0) return showContributionError("The estimated USDT amount is too small to record.");
  const contributions = original
    ? state.contributions.map((item) => item.id === original.id
      ? { ...item, voidedAt: recordedAt, voidReason: reason,
          replacedById: replacement.id } : item).concat(replacement)
    : state.contributions.concat(replacement);
  const proposed = { ...state, contributions };
  const orphaned = orphanedRecordedExecutions(proposed);
  if (orphaned.length) {
    showContributionError("Correction would leave a recorded execution without a planned buy on " +
      orphaned[0].day + ". Adjust that execution first.");
    return;
  }
  const check = replay(proposed);
  if (check.error) return showContributionError(check.error);
  state = proposed;
  save();
  document.querySelector("#contributionDialog").close();
  notify(original ? "Correction recorded. Download and verify a backup." :
    "Contribution recorded. Download and verify a backup.");
  render();
  refreshPrices();
});

document.querySelector("#tradeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const day = form.elements.day.value;
  const assetId = form.elements.assetId.value;
  const costUsdt = Number(form.elements.costUsdt.value);
  const quantity = Number(form.elements.quantity.value);
  const feeUsdt = Number(form.elements.feeUsdt.value);
  if (![costUsdt, quantity, feeUsdt].every(Number.isFinite) ||
      costUsdt <= 0 || quantity <= 0 || feeUsdt < 0 || feeUsdt > costUsdt) {
    notify("Enter positive cost and quantity, with a fee no greater than the cost.");
    return;
  }
  const proposed = { day, assetId, costUsdt, quantity, feeUsdt,
    recordedAt: new Date().toISOString() };
  const previous = state.manualTrades;
  state.manualTrades = previous.filter((trade) => !(trade.day === day &&
    trade.assetId === assetId)).concat(proposed);
  const check = result();
  if (check.error) {
    state.manualTrades = previous;
    notify(check.error);
    return;
  }
  save();
  document.querySelector("#tradeDialog").close();
  notify("Recorded execution replaced the simulated buy.");
  render();
});

content.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "add-person") openStakeholder();
  else if (action === "settings") { view = "settings"; render(); focusPageStart(); }
  else if (action === "new-contribution") openContribution();
  else if (action === "person") { selectedPerson = button.dataset.id; view = "people"; render(); focusPageStart(); }
  else if (action === "back-people") { selectedPerson = null; render(); }
  else if (action === "filter") {
    activityFilter = button.dataset.filter;
    render();
    content.querySelector('[data-action="filter"][data-filter="' + activityFilter + '"]')?.focus({ preventScroll: true });
  }
  else if (action === "correct-contribution") openCorrection(button.dataset.id);
  else if (action === "trade") openTrade(button.dataset.day, button.dataset.asset);
  else if (action === "print-report") window.print();
  else if (action === "export-report") exportReport(button.dataset.id);
  else if (action === "export-backup") {
    download("crypto-savings-backup-" + new Date().toISOString().slice(0, 10) +
      ".json", JSON.stringify(state, null, 2), "application/json");
    notify("Download requested. Select the saved file to verify it matches this ledger.");
  }
  else if (action === "verify-backup") document.querySelector("#verifyInput").click();
  else if (action === "import-backup") document.querySelector("#importInput").click();
});

content.addEventListener("input", (event) => {
  if (event.target.closest("#targetsForm")) updateTargetTotal();
});

content.addEventListener("submit", (event) => {
  if (event.target.id !== "targetsForm") return;
  event.preventDefault();
  const form = event.target;
  const { error, errorField } = updateTargetTotal();
  if (error) {
    errorField?.closest("details")?.setAttribute("open", "");
    errorField?.focus();
    return;
  }
  const targets = [...form.querySelectorAll("[data-asset]:checked")].map((checkbox) => ({
    assetId: checkbox.dataset.asset,
    weight: Number(form.querySelector('[data-weight="' + checkbox.dataset.asset + '"]').value),
  }));
  if (!validTargets(targets)) {
    document.querySelector("#targetError").textContent = "Select tokens with positive weights totaling exactly 100%.";
    document.querySelector("#targetError").hidden = false;
    form.querySelector("[data-weight]:not(:disabled)")?.focus();
    return;
  }
  const effectiveDay = firstBuyDay(new Date().toISOString());
  const targetsHistory = state.targetsHistory
    .filter((version) => version.effectiveDay !== effectiveDay)
    .concat({ effectiveDay, targets })
    .sort((a, b) => a.effectiveDay.localeCompare(b.effectiveDay));
  const candidate = { ...state, targetsHistory };
  const orphaned = orphanedRecordedExecutions(candidate);
  const check = replay(candidate);
  if (orphaned.length || check.error) {
    const message = document.querySelector("#targetError");
    message.textContent = check.error || "This mix would remove a recorded execution on " + orphaned[0].day + ".";
    message.hidden = false;
    message.focus();
    return;
  }
  state = candidate;
  save();
  notify("Token mix saved for future daily buys.");
  render();
  refreshPrices().finally(() => document.querySelector('#targetsForm button[type="submit"]')?.focus());
});

document.querySelector("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const candidate = JSON.parse(await file.text());
    validateBackup(candidate);
    if (!confirm("Replace the current ledger with this backup? Export a copy first if you need it.")) return;
    state = candidate;
    save();
    backupVerifiedAt = null;
    localStorage.removeItem(BACKUP_VERIFIED_KEY);
    if (!hasRecordedData(state)) {
      backupNeeded = false;
      localStorage.setItem(BACKUP_NEEDED_KEY, "false");
    }
    selectedPerson = null;
    notify("Backup imported. Verify the file against this ledger to clear the backup reminder.");
    render();
  } catch (error) {
    notify(error.message || "Could not import backup.");
  }
});

document.querySelector("#verifyInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const candidate = JSON.parse(await file.text());
    validateBackup(candidate);
    if (ledgerSignature(candidate) !== ledgerSignature(state)) {
      throw new Error("This file does not match the current ledger. Download a new backup and verify that file.");
    }
    backupNeeded = false;
    localStorage.setItem(BACKUP_NEEDED_KEY, "false");
    backupVerifiedAt = new Date().toISOString();
    localStorage.setItem(BACKUP_VERIFIED_KEY, backupVerifiedAt);
    notify("Selected backup matches the current ledger.");
    render();
  } catch (error) {
    notify(error.message || "Could not verify this backup file.");
  }
});

render();
refreshPrices();
