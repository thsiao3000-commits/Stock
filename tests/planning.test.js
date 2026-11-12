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

// ── 股息行事曆與提醒 ──
{
  const { calendarEvents, checkAlerts, alertMet, extractPlanLevels, isoDayDiff, isoAddDays, BOND_STALE_DAYS } = T;
  check('日期工具', isoDayDiff('2026-07-01', '2026-07-31') === 30 && isoAddDays('2026-12-31', 1) === '2027-01-01');
  const today = '2026-07-07';
  const base = {
    stocks: [{ market: 'tw', symbol: '2330', qty: 2000, lastPrice: 1085 }, { market: 'us', symbol: 'AAPL', qty: 20, lastPrice: 310 }],
    bonds: [{ symbol: 'Apple 4.3% 2032', ccy: 'USD', couponAmt: 215, face: 10000, rate: 4.3, freq: 2,
      dates: ['2026-05-10', '2026-11-10', '2027-05-10', '2027-11-10'], lastMark: '2026-06-01', matured: false }],
    divCache: { 2330: { events: [{ exDate: '2026-09-17', payDate: '2026-10-15', cash: 5 }, { exDate: '2026-06-12', payDate: '2026-07-16', cash: 4.5 }] } },
    alerts: [{ id: 'a1', market: 'tw', symbol: '2330', dir: 'below', price: 1000, note: '減碼條件', hit: null }],
    today,
  };
  const rows = calendarEvents(base);
  const kinds = rows.map(r => r.kind).join();
  check('列的順序：有日期的事件（由近到遠）→ 到價 → 系統提醒', kinds === 'pay,div,coupon,coupon,alert,sys');
  const div = rows.find(r => r.kind === 'div');
  check('除息列：日期、金額＝股數 × 每股現金股利', div.date === '2026-09-17' && div.label === '09-17' && div.amount === 10000 && div.ccy === 'TWD' && /2,000 股 × NT\$5/.test(div.desc) && /10-15 發放/.test(div.desc));
  const pay = rows.find(r => r.kind === 'pay');
  check('已除息但尚未發放 → 以發放日列出', pay.date === '2026-07-16' && pay.amount === 9000 && pay.title === '2330 股息發放');
  const cps = rows.filter(r => r.kind === 'coupon');
  check('債券配息：只列未來、每檔最多 2 次', cps.map(r => r.date).join() === '2026-11-10,2027-05-10' && cps[0].amount === 215 && cps[0].ccy === 'USD');
  const al = rows.find(r => r.kind === 'alert');
  check('到價列：標題與現價', al.title === '2330 跌破 1,000' && al.last === 1085 && al.label === '到價' && al.id === 'a1');
  const sys = rows.find(r => r.kind === 'sys');
  check(`債券市價超過 ${BOND_STALE_DAYS} 天未更新 → 提醒`, /超過 30 天未更新/.test(sys.title) && /2026-06-01/.test(sys.desc));
  check('30 天內更新過 → 不提醒', !calendarEvents({ ...base, bonds: [{ ...base.bonds[0], lastMark: '2026-06-20' }] }).some(r => r.kind === 'sys'));
  const estB = { ...base.bonds[0], estimated: true };   // 現價為殖利率曲線估算（v2.7.0）：放寬到 90 天才提醒校準
  check('估算中的債券：手動報價 90 天內 → 不提醒', !calendarEvents({ ...base, bonds: [estB] }).some(r => r.kind === 'sys'));
  check('估算中的債券：手動報價超過 90 天 → 提醒校準', calendarEvents({ ...base, bonds: [{ ...estB, lastMark: '2026-03-01' }] }).some(r => r.kind === 'sys' && /超過 90 天未用對帳單報價校準/.test(r.title)));
  check('從未更新市價 → 提醒', calendarEvents({ ...base, bonds: [{ ...base.bonds[0], lastMark: null }] }).some(r => r.kind === 'sys'));
  check('已到期債券不列配息與提醒', !calendarEvents({ ...base, bonds: [{ ...base.bonds[0], matured: true }] }).some(r => r.kind === 'coupon' || r.kind === 'sys'));
  check('已出清（股數 0）不列除息', !calendarEvents({ ...base, stocks: [{ market: 'tw', symbol: '2330', qty: 0, lastPrice: 1085 }] }).some(r => r.kind === 'div'));
  check('空資料 → 空清單', calendarEvents({ stocks: [], bonds: [], divCache: {}, alerts: [], today }).length === 0);
  const hitRows = calendarEvents({ ...base, alerts: [{ ...base.alerts[0], hit: '2026-07-06' }] });
  check('已觸發的提醒排最前面並標示', hitRows[0].kind === 'alert' && hitRows[0].label === '已到價' && /2026-07-06 觸發/.test(hitRows[0].desc));

  check('alertMet：跌破／漲破含等於；無報價不觸發', alertMet({ dir: 'below', price: 1000 }, 1000) && !alertMet({ dir: 'below', price: 1000 }, 1001) &&
    alertMet({ dir: 'above', price: 50 }, 50.5) && !alertMet({ dir: 'above', price: 50 }, null));
  const alerts = [{ id: 'x', market: 'tw', symbol: '2330', dir: 'below', price: 1000, hit: null }, { id: 'y', market: 'us', symbol: 'AAPL', dir: 'above', price: 300, hit: null },
    { id: 'z', market: 'us', symbol: 'NVDA', dir: 'above', price: 1, hit: null }];
  const priceOf = (m, s2) => ({ 2330: 1085, AAPL: 310 })[s2] ?? null;
  const fresh = checkAlerts(alerts, priceOf, today);
  check('checkAlerts：只觸發條件成立者並記下日期', fresh.length === 1 && fresh[0].id === 'y' && alerts[1].hit === today && alerts[0].hit === null && alerts[2].hit === null);
  check('checkAlerts：已觸發的不重複回報', checkAlerts(alerts, priceOf, '2026-07-08').length === 0 && alerts[1].hit === today);

  const md = `## 9. 操作計畫表
| 動作 | 觸發條件與具體價位 | 依據 |
|---|---|---|
| **續抱** | 1,050 之上 | 趨勢未破壞 |
| 加碼 | 回測 1,000～1,020 有守 | 分批、勿一次到位 |
| 減碼 | 跌破 1,000（MA60） | 先減 1/3 控風險 |
| 停損 | 收盤跌破 950，或 3 日內未站回 | 約 -8% |
| 停利 | 突破 1,150 後分批 | 52 週高 |

## 10. 結論
股價 1,085，RSI 61。`;
  const lv = extractPlanLevels(md, 1085);
  const sig = lv.map(l => `${l.dir}:${l.price}:${l.action}`).join(' ');
  check('extractPlanLevels：抓出各列價位與方向' + `（${sig}）`, sig === 'below:1050:續抱 below:1000:加碼 below:1020:加碼 below:950:停損 above:1150:停利');
  check('MA60、百分比、「3 日」「1/3」不被當成價位', !lv.some(l => [60, 3, 8, 1].includes(l.price)));
  check('表格外的數字（1,085、RSI 61）不被抓', !lv.some(l => l.price === 1085 || l.price === 61));
  check('沒有現價時以文字與動作判斷方向', extractPlanLevels('| 停利 | 突破 1,150 | x |\n| 減碼 | 980 | y |', null).map(l => l.dir).join() === 'above,below');
  check('沒有表格 → 空陣列', extractPlanLevels('只有文字 1,000', 100).length === 0 && extractPlanLevels(null).length === 0);
}

// ── 再平衡試算 ──
{
  const { rebalance, normTargets, REB_DEFAULT } = T;
  const cur = { tw: 2170000, us: 201929, bond: 322400 }, total = 2694329;
  let r = rebalance(cur, { tw: 60, us: 25, bond: 15 }, false);
  const d = Object.fromEntries(r.rows.map(x => [x.market, Math.round(x.delta)]));
  check('一般再平衡：台股賣 553,403、美股買 471,653、債券買 81,749', r.ok && d.tw === -553403 && d.us === 471653 && d.bond === 81749);
  check('買賣金額相抵為 0、不需新資金', Math.abs(r.rows.reduce((s, x) => s + x.delta, 0)) < 1e-6 && r.newCash === 0);
  check('目前占比', r.rows.map(x => x.curPct.toFixed(1)).join() === '80.5,7.5,12.0');
  r = rebalance(cur, { tw: 60, us: 25, bond: 15 }, true);
  const need = 2170000 / 0.6 - total;
  check('只用新資金：需投入＝最超配市場回到目標所需', r.ok && near(r.newCash, need) && near(r.rows[0].delta, 0));
  check('只用新資金：沒有任何賣出、買進合計＝新資金', r.rows.every(x => x.delta >= 0) && near(r.rows.reduce((s, x) => s + x.delta, 0), need, 1e-3));
  check('只用新資金：調整後比例符合目標', r.rows.every(x => near((x.cur + x.delta) / (total + r.newCash) * 100, x.tgtPct, 1e-6)));
  r = rebalance(cur, { tw: 50, us: 30, bond: 30 }, false);
  check('目標合計不是 100% → 不試算並回報合計', !r.ok && r.reason === 'sum' && r.sumT === 110 && r.rows[0].delta === null);
  r = rebalance(cur, { tw: 100, us: 0, bond: 0 }, true);
  check('不賣出但目標 0% 的市場有部位 → 無法達成', !r.ok && r.reason === 'nosell' && r.market === 'us');
  r = rebalance({ tw: 0, us: 0, bond: 0 }, REB_DEFAULT, false);
  check('無持倉 → empty', !r.ok && r.reason === 'empty');
  r = rebalance({ tw: 100, us: 0, bond: 0 }, { tw: 50, us: 50, bond: 0 }, false);
  check('目前沒有的市場也能設目標（買進）', r.ok && r.rows[1].delta === 50 && r.rows[0].delta === -50 && r.rows[2].delta === 0);
  r = rebalance({ tw: 60, us: 25, bond: 15 }, REB_DEFAULT, true);
  check('已符合目標 → 全部不需調整', r.ok && r.newCash === 0 && r.rows.every(x => x.delta === 0));
  check('normTargets：缺值／負值／非數字用預設', JSON.stringify(normTargets({ tw: 70, us: -5, bond: 'x' })) === JSON.stringify({ tw: 70, us: 25, bond: 15 }) && JSON.stringify(normTargets(undefined)) === JSON.stringify(REB_DEFAULT));
}

// ── 稅務／二代健保試算 ──
{
  const { taxEstimate, normTax, TAX_DEFAULT, TAX_LABELS } = T;
  check('預設參數：2.11%／2 萬／1,000 萬／8.5%／8 萬／28%／100 萬／750 萬／20%', JSON.stringify(TAX_DEFAULT) ===
    JSON.stringify({ nhiRate: 2.11, nhiMin: 20000, nhiMax: 10000000, creditRate: 8.5, creditCap: 80000, sepRate: 28, osThreshold: 1000000, amtExempt: 7500000, amtRate: 20 }));
  check('每個參數都有中文標籤', Object.keys(TAX_DEFAULT).every(k => TAX_LABELS[k]));
  let r = taxEstimate({ twDivs: [4500], osDiv: 0, osInterest: 6175, osGain: 0, marginalRate: null });
  check('單筆未達 2 萬 → 補充保費 0', r.twDivTotal === 4500 && r.nhi === 0 && r.nhiCount === 0);
  check('合併抵減 8.5% ＝ 382.5、分開 28% ＝ 1,260', near(r.credit, 382.5) && near(r.sepTax, 1260));
  check('未填綜所稅率 → 不下結論', r.combineTax === null && r.better === null);
  check('海外所得未達 100 萬 → 免計入', r.osTotal === 6175 && r.osReport === false);
  r = taxEstimate({ twDivs: [20000, 19999, 100000], marginalRate: 12 });
  check('補充保費逐筆計：只有達 2 萬的兩筆（422 + 2,110）', r.nhi === 422 + 2110 && r.nhiCount === 2 && r.twDivCount === 3);
  check('稅率 12%：合併 = 股利 × 12% − 抵減，較有利', near(r.combineTax, 139999 * 0.12 - 139999 * 0.085) && r.better === 'combine');
  r = taxEstimate({ twDivs: [2000000], marginalRate: 40 });
  check('抵減上限 8 萬', r.credit === 80000);
  check('高稅率大額股利 → 分開計稅較有利', near(r.combineTax, 800000 - 80000) && near(r.sepTax, 560000) && r.better === 'separate');
  r = taxEstimate({ twDivs: [50000], marginalRate: 5 });
  check('低稅率：抵減大於稅額 → 合併計稅為負（退稅）', r.combineTax < 0 && r.better === 'combine');
  r = taxEstimate({ twDivs: [20000000] });
  check('補充保費單次上限 1,000 萬', r.nhi === Math.round(10000000 * 0.0211));
  r = taxEstimate({ osDiv: 300000, osInterest: 200000, osGain: 600000 });
  check('海外所得合計達 100 萬 → 需計入', r.osTotal === 1100000 && r.osReport === true && r.osOverExempt === false);
  r = taxEstimate({ osDiv: 300000, osInterest: 200000, osGain: -900000 });
  check('海外交易損失不抵股息與債息', r.osGain === 0 && r.osTotal === 500000 && r.osReport === false);
  r = taxEstimate({ twDivs: [30000], params: { nhiRate: 3, nhiMin: 50000, creditRate: 10 } });
  check('參數可調：費率、門檻、抵減率', r.nhi === 0 && near(r.credit, 3000));
  check('normTax：缺值／負值／空字串用預設', normTax({ nhiRate: -1, sepRate: '', creditCap: 90000 }).nhiRate === 2.11 && normTax({ sepRate: '' }).sepRate === 28 && normTax({ creditCap: 90000 }).creditCap === 90000);
  check('沒有任何資料 → 全為 0', (() => { const z = taxEstimate({}); return z.twDivTotal === 0 && z.nhi === 0 && z.osTotal === 0 && z.better === null; })());
}

console.log(`\nplanning: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
