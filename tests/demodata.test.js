// 範例資料形狀測試：demoData()/demoReport() 是純靜態函式，直接抽出驗證
// 目的：防止 app 內部資料結構演進後，範例資料悄悄變成壞形狀（載入即壞畫面）
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('function demoData()');
const j = html.indexOf('function loadDemo()', i);
if (i < 0 || j < 0) throw new Error('extract failed: demoData/demoReport');
eval(html.slice(i, j));

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const d = demoData();

// ── 持倉 ──
check('持倉 3 筆（台股＋美股＋債券）', d.positions.length === 3 &&
  ['tw', 'us', 'bond'].every(m => d.positions.some(p => p.market === m)));
check('所有持倉 id 以 demo_ 開頭（清除範例的依據）', d.positions.every(p => String(p.id).startsWith('demo_')));

for (const p of d.positions.filter(x => x.market !== 'bond')) {
  check(`${p.symbol}：有 lastPrice/lastDate（① 總覽與組合總評需要現價）`, p.lastPrice > 0 && ISO.test(p.lastDate));
  check(`${p.symbol}：交易形狀正確`, Array.isArray(p.txs) && p.txs.every(t =>
    String(t.id).startsWith('demo_') && ISO.test(t.date) && (
      (t.type === 'buy' || t.type === 'sell') ? (t.price > 0 && t.qty > 0 && typeof t.fee === 'number')
      : t.type === 'dividend' ? (t.amount > 0)
      : false)));
}

const bond = d.positions.find(p => p.market === 'bond');
const b = bond.bond;
check('債券：欄位齊全（currency/face/buyPricePct/rate/freq/maturity…）',
  !!b && typeof b.currency === 'string' && b.face > 0 && b.buyPricePct > 0 && b.rate >= 0 &&
  [1, 2, 4].includes(b.freq) && ISO.test(b.buyDate) && ISO.test(b.maturity) &&
  typeof b.fee === 'number' && typeof b.accruedPaid === 'number' && 'isin' in b);
check('債券：到期日晚於買進日', b.maturity > b.buyDate);
check('債券：mark 有值且 markDate 為 ISO 日期', b.mark > 0 && ISO.test(b.markDate));

// ── 觀察清單 ──
check('觀察清單 2 筆、id 皆 demo_ 開頭、欄位齊全', d.watchlist.length === 2 &&
  d.watchlist.every(w => String(w.id).startsWith('demo_') && ['tw', 'us'].includes(w.market) && w.symbol));

// ── 範例報告 ──
const r = demoReport();
check('報告：id=demo_report 且 demo 旗標為 true（清除範例的依據）', r.id === 'demo_report' && r.demo === true);
check('報告：ts/title/filename/fullText 齊全', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.ts) &&
  typeof r.title === 'string' && r.filename.endsWith('.md') && r.fullText.length > 300);
check('報告：標題與內文明示為範例', r.title.includes('範例') && r.fullText.includes('範例'));
check('報告：不帶 symbol/market meta（避免「上次建議檢討」誤用虛構內容）', !('symbol' in r) && !('market' in r));
check('報告：內含表格與結論章節（示意完整報告樣貌）', r.fullText.includes('| 動作 |') && r.fullText.includes('## 7. 結論'));

console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
