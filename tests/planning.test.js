// 規劃工具純函式：資產配置（之後的股息行事曆、再平衡、稅務試算也加在這裡）
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('/* ════════════════ 規劃工具（純函式');
const j = html.indexOf('/* ════════════════ 規劃工具結束', i);
if (i < 0 || j < 0) throw new Error('extract failed: planning tools');
const src = html.slice(i, j);
const names = [...src.matchAll(/^(?:function|const) (\w+)/gm)].map(m => m[1]);
const T = new Function(src + `return { ${names.join(', ')} };`)();
module.exports = T;

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ── 資產配置 ──
{
  const { allocStats, donutArcs, fmtCompact, CONC_PCT } = T;
  const a = allocStats([
    { market: 'tw', symbol: '2330', mv: 2170000 }, { market: 'us', symbol: 'AAPL', mv: 201929 }, { market: 'bond', symbol: 'Apple 4.3%', mv: 322400 },
  ]);
  check('總市值加總', a.total === 2694329);
  check('各市場占比（台股 80.5%／美股 7.5%／債券 12.0%）', a.byMkt.map(g => g.pct.toFixed(1)).join() === '80.5,7.5,12.0');
  check('占比合計 100%', near(a.byMkt.reduce((s, g) => s + g.pct, 0), 100));
  check('最大單一持股 2330、超過 40% → 警示', a.top.symbol === '2330' && a.top.pct > 80 && a.warn === true && CONC_PCT === 40);
  const b = allocStats([{ market: 'tw', symbol: 'A', mv: 40 }, { market: 'tw', symbol: 'B', mv: 30 }, { market: 'us', symbol: 'C', mv: 30 }]);
  check('同市場合併、剛好 40% 不警示', b.byMkt.length === 2 && near(b.byMkt[0].pct, 70) && b.warn === false);
  check('市場順序固定：台股、美股、債券', allocStats([{ market: 'bond', symbol: 'x', mv: 1 }, { market: 'tw', symbol: 'y', mv: 1 }]).byMkt.map(g => g.market).join() === 'tw,bond');
  const e = allocStats([]);
  check('無持倉 → total 0、不警示', e.total === 0 && e.byMkt.length === 0 && e.top === null && e.warn === false);
  check('市值為 0 或負的項目不計', allocStats([{ market: 'tw', symbol: 'A', mv: 0 }, { market: 'us', symbol: 'B', mv: 5 }]).byMkt.length === 1);
  const arcs = donutArcs(a.byMkt);
  check('環圈各段首尾相接、總長 100', arcs[0].offset === 0 && near(arcs[1].offset, arcs[0].len) && near(arcs[2].offset + arcs[2].len, 100));
  check('fmtCompact', fmtCompact(2694329) === 'NT$2.69M' && fmtCompact(325186) === 'NT$325K' && fmtCompact(980) === 'NT$980' && fmtCompact(0) === 'NT$0');
}

console.log(`\nplanning: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
