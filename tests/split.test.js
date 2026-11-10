// 股票分割／合併與股息預扣稅：損益引擎與分割相關純函式
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('function sortTxs(');
const j = html.indexOf('function couponDates(', i);
if (i < 0 || j < 0) throw new Error('extract failed: split engine');
const api = new Function('db', html.slice(i, j) +
  'return { sortTxs, splitRatio, splitFactorAfter, sharesOnAdj, adjustDaysForSplits, ratioToFraction, detectSplits, pendingSplits, netDividend, txLabel, computeStock, realizedByYear };'
)({ settings: { twFee: 0.1425, twTax: 0.3 } });
const { sortTxs, splitFactorAfter, sharesOnAdj, adjustDaysForSplits, ratioToFraction, detectSplits, pendingSplits, netDividend, txLabel, computeStock } = api;

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ── computeStock：分割 ──
const aapl = { market: 'us', lastPrice: 80, txs: [
  { type: 'buy', date: '2026-02-20', price: 235.10, qty: 20, fee: 1 },
  { type: 'split', date: '2026-06-01', from: 1, to: 4 },
] };
let c = computeStock(aapl);
check('分割 1→4：股數 20 → 80', near(c.qty, 80));
check('分割：總成本不變', near(c.cost, 235.10 * 20 + 1));
check('分割：均價 ÷ 4', near(c.avgCost, (235.10 * 20 + 1) / 80));
check('分割：已實現損益不變（0）', c.realized === 0);
check('分割：市值用分割後股數', near(c.mv, 80 * 80));
const before = computeStock({ ...aapl, txs: aapl.txs.slice(0, 1) });
check('未登錄分割時仍是 20 股（向下相容）', before.qty === 20 && near(before.cost, c.cost));

c = computeStock({ market: 'us', lastPrice: 50, txs: [
  { type: 'buy', date: '2026-01-05', price: 5, qty: 1000, fee: 0 },
  { type: 'split', date: '2026-03-01', from: 10, to: 1 },
] });
check('合併 10→1：1000 → 100 股、均價 5 → 50', near(c.qty, 100) && near(c.avgCost, 50));

c = computeStock({ market: 'us', lastPrice: 30, txs: [
  { type: 'buy', date: '2026-01-05', price: 100, qty: 10, fee: 0 },
  { type: 'split', date: '2026-03-01', from: 1, to: 4 },
  { type: 'sell', date: '2026-04-01', price: 30, qty: 20, fee: 0 },
  { type: 'buy', date: '2026-05-01', price: 20, qty: 10, fee: 0 },
] });
check('分割後賣出：已實現 = 20 ×（30 − 25）', near(c.realized, 100));
check('分割後賣出再買進：剩 30 股、成本 500 + 200', near(c.qty, 30) && near(c.cost, 700));

c = computeStock({ market: 'us', txs: [
  { type: 'buy', date: '2026-03-01', price: 25, qty: 4, fee: 0 },
  { type: 'split', date: '2026-03-01', from: 1, to: 4 },
  { type: 'buy', date: '2026-01-01', price: 100, qty: 1, fee: 0 },
] });
check('同日分割排在買賣之前（當日成交已是分割後價）：1×4 + 4 = 8 股', near(c.qty, 8));
check('sortTxs 不改動原陣列', sortTxs([{ type: 'buy', date: '2026-02-01' }, { type: 'split', date: '2026-01-01' }])[0].type === 'split');

c = computeStock({ market: 'us', txs: [{ type: 'split', date: '2026-01-01', from: 1, to: 4 }, { type: 'buy', date: '2026-02-01', price: 10, qty: 5, fee: 0 }] });
check('買進前的分割不影響股數', c.qty === 5);
c = computeStock({ market: 'us', txs: [{ type: 'buy', date: '2026-02-01', price: 10, qty: 5, fee: 0 }, { type: 'split', date: '2026-03-01', from: 0, to: 4 }] });
check('壞資料（from=0）視為比例 1', c.qty === 5);

c = computeStock({ market: 'tw', lastPrice: 100, txs: [
  { type: 'buy', date: '2026-01-05', price: 1000, qty: 1000, fee: 0 },
  { type: 'split', date: '2026-03-01', from: 1, to: 10 },
] });
check('台股分割同樣適用：1000 → 10000 股、均價 100', near(c.qty, 10000) && near(c.avgCost, 100));

// ── 股息預扣稅 ──
check('預扣 30%：100 → 70', netDividend(100, 30) === 70);
check('預扣 0%：金額不變', netDividend(4500, 0) === 4500);
check('四捨五入到分：5.2 × 0.7 = 3.64', netDividend(5.2, 30) === 3.64);
check('稅率超出範圍被夾住', netDividend(100, 150) === 0 && netDividend(100, -5) === 100);
c = computeStock({ market: 'us', txs: [
  { type: 'buy', date: '2026-01-05', price: 100, qty: 10, fee: 0 },
  { type: 'dividend', date: '2026-02-01', amount: 3.64, gross: 5.2, withholdPct: 30 },
  { type: 'dividend', date: '2026-03-01', amount: 10 },
] });
check('股息以入帳金額（amount）計：3.64 + 舊紀錄 10', near(c.div, 13.64));

// ── 標籤 ──
check('txLabel：分割／合併／股息', txLabel({ type: 'split', from: 1, to: 4 }) === '分割 1→4' &&
  txLabel({ type: 'split', from: 10, to: 1 }) === '合併 10→1' &&
  txLabel({ type: 'dividend', amount: 1 }) === '股息' &&
  txLabel({ type: 'dividend', withholdPct: 30 }) === '股息（預扣 30%）' &&
  txLabel({ type: 'buy' }) === '買進' && txLabel({ type: 'sell' }) === '賣出');

// ── 還原 ──
const txs = [
  { type: 'buy', date: '2026-01-05', price: 100, qty: 10 },
  { type: 'split', date: '2026-03-01', from: 1, to: 4 },
  { type: 'sell', date: '2026-04-01', price: 30, qty: 20 },
  { type: 'split', date: '2026-06-01', from: 1, to: 2 },
];
check('splitFactorAfter：兩次分割前 = 8、中間 = 2、之後 = 1',
  splitFactorAfter(txs, '2026-01-05') === 8 && splitFactorAfter(txs, '2026-04-01') === 2 && splitFactorAfter(txs, '2026-06-01') === 1);
check('sharesOnAdj：以目前股數單位計（80 → 40）', sharesOnAdj(txs, '2026-02-01') === 80 && sharesOnAdj(txs, '2026-05-01') === 40 && sharesOnAdj(txs, '2026-07-01') === 40);
check('sharesOnAdj 與 computeStock 最終股數一致', near(sharesOnAdj(txs, '2027-01-01'), computeStock({ market: 'us', txs }).qty));
const days = [
  { date: '2026-02-27', open: 800, high: 820, low: 790, close: 800, volume: 100 },
  { date: '2026-03-02', open: 201, high: 205, low: 199, close: 200, volume: 400 },
];
const adj = adjustDaysForSplits(days, [{ type: 'split', date: '2026-03-01', from: 1, to: 4 }]);
check('adjustDaysForSplits：分割日前價格 ÷4、量 ×4', adj[0].close === 200 && adj[0].high === 205 && adj[0].volume === 400);
check('adjustDaysForSplits：分割日後不動、原陣列不變', adj[1] === days[1] && days[0].close === 800);
check('無分割時回傳原陣列', adjustDaysForSplits(days, [{ type: 'buy', date: '2026-01-01' }]) === days);

// ── 自動偵測 ──
check('ratioToFraction：4 → 1→4、0.1 → 10→1、1.5 → 2→3', JSON.stringify([ratioToFraction(4), ratioToFraction(0.1), ratioToFraction(1.5)]) ===
  JSON.stringify([{ from: 1, to: 4 }, { from: 10, to: 1 }, { from: 2, to: 3 }]));
const raw = [['2024-06-05', 1224.4], ['2024-06-06', 1209.98], ['2024-06-07', 1208.88], ['2024-06-10', 121.79], ['2024-06-11', 120.91]].map(([date, close]) => ({ date, close }));
const adjd = [['2024-06-05', 122.44], ['2024-06-06', 120.998], ['2024-06-07', 120.888], ['2024-06-10', 121.79], ['2024-06-11', 120.91]].map(([date, close]) => ({ date, close }));
check('detectSplits：NVDA 2024-06-10 分割 1→10', JSON.stringify(detectSplits(raw, adjd)) === JSON.stringify([{ date: '2024-06-10', from: 1, to: 10 }]));
check('detectSplits：兩條線相同 → 無分割', detectSplits(adjd, adjd).length === 0);
check('detectSplits：反向分割 10→1', JSON.stringify(detectSplits(
  [{ date: '2026-01-02', close: 1 }, { date: '2026-01-05', close: 10 }], [{ date: '2026-01-02', close: 10 }, { date: '2026-01-05', close: 10 }])) ===
  JSON.stringify([{ date: '2026-01-05', from: 10, to: 1 }]));
check('detectSplits：空資料不出錯', detectSplits([], []).length === 0 && detectSplits(null, null).length === 0);

const pos = { txs: [{ type: 'buy', date: '2024-05-01', price: 900, qty: 2 }], splitHints: [{ date: '2024-06-10', from: 1, to: 10 }, { date: '2021-07-20', from: 1, to: 4 }] };
check('pendingSplits：只留買進之後的分割', pendingSplits(pos).length === 1 && pendingSplits(pos)[0].date === '2024-06-10');
check('pendingSplits：已略過不再提示', pendingSplits({ ...pos, splitSkip: ['2024-06-10'] }).length === 0);
check('pendingSplits：已登錄（日期相差 5 天內）不再提示', pendingSplits({ ...pos, txs: [...pos.txs, { type: 'split', date: '2024-06-07', from: 1, to: 10 }] }).length === 0);
check('pendingSplits：沒有買進或沒有提示 → 空', pendingSplits({ txs: [] }).length === 0 && pendingSplits({ txs: pos.txs }).length === 0);

// ── 各年度已實現損益（稅務試算用）──
{
  const { realizedByYear } = api;
  const txs2 = [
    { type: 'buy', date: '2025-01-05', price: 100, qty: 10, fee: 0 },
    { type: 'sell', date: '2025-06-01', price: 120, qty: 4, fee: 2 },
    { type: 'split', date: '2026-03-01', from: 1, to: 2 },
    { type: 'sell', date: '2026-04-01', price: 70, qty: 6, fee: 0 },
    { type: 'sell', date: '2026-09-01', price: 40, qty: 6, fee: 0 },
  ];
  const by = realizedByYear(txs2);
  check('realizedByYear：2025 ＝ 4×(120−100)−2', near(by['2025'], 78));
  check('realizedByYear：2026 分割後以新均價 50 計（6×20 − 6×10）', near(by['2026'], 60));
  check('realizedByYear 各年合計＝computeStock 的已實現損益', near(by['2025'] + by['2026'], computeStock({ market: 'us', txs: txs2 }).realized));
  check('沒有賣出 → 空物件', Object.keys(realizedByYear([{ type: 'buy', date: '2026-01-01', price: 1, qty: 1 }])).length === 0);
}

console.log(`\nsplit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
