// 債券一鍵重估（v2.7.0）：財政部 CSV 解析、曲線內插、殖利率⇄價格、以隱含利差重估、估算失效規則、行事曆提醒
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('extract failed: ' + a); return html.slice(i, j); }
const T = new Function(
  slice('function parseD(', '/* ════════════════ 資料儲存') +
  slice('const BOND_HIST_MAX', 'const ustCache') +
  'return { parseTreasuryCsv, curveYield, curveOnOrBefore, bondFlows, bondCleanPrice, bondYtm, bondBasis, bondEst, estimateBond, pushMarkHist, BOND_HIST_MAX };')();
const { parseTreasuryCsv, curveYield, curveOnOrBefore, bondFlows, bondCleanPrice, bondYtm, bondBasis, bondEst, estimateBond, pushMarkHist } = T;

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol ?? 1e-6);

// ── 1. CSV 解析 ──
const CSV = 'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"\n' +
  '11/09/2026,4.04,4.13,4.19,4.24,4.20,4.26,4.38,4.56,4.58,4.67,4.76,4.88,5.29,5.26\n' +
  '11/10/2026,4.05,4.16,4.21,4.30,4.28,4.38,4.56,4.73,4.74,4.81,4.89,4.98,5.39,5.35\n' +
  '11/06/2026,4.02,,4.15,4.19,4.19,4.23,4.33,4.51,4.59,4.64,4.74,4.86,5.29,5.26\n';
const cv = parseTreasuryCsv(CSV);
check('三天都解析、新的在前、日期轉 ISO', cv.length === 3 && cv.map(c => c.date).join() === '2026-11-10,2026-11-09,2026-11-06');
check('年期換算（1 Mo＝1/12、1.5 Month＝0.125、10 Yr＝10）', near(cv[0].pts[0][0], 1 / 12) && near(cv[0].pts[1][0], 0.125) && cv[0].pts.some(p => p[0] === 10 && p[1] === 4.98));
check('空欄位略過不當成 0', cv[2].pts.length === 13 && !cv[2].pts.some(p => p[1] === 0));
check('空字串／只有標題／亂碼回空陣列', parseTreasuryCsv('').length === 0 && parseTreasuryCsv('Date,"1 Mo"').length === 0 && parseTreasuryCsv('<html>error</html>\nx').length === 0);

// ── 2. 曲線 ──
check('節點上取原值', curveYield(cv[0], 10) === 4.98 && curveYield(cv[0], 5) === 4.81);
check('節點間線性內插（6 年＝5Y 與 7Y 中點）', near(curveYield(cv[0], 6), (4.81 + 4.89) / 2));
check('超出兩端取端點值', curveYield(cv[0], 0.01) === 4.05 && curveYield(cv[0], 40) === 5.35);
check('取該日或之前最近的交易日', curveOnOrBefore(cv, '2026-11-08').date === '2026-11-06' && curveOnOrBefore(cv, '2026-11-10').date === '2026-11-10');
check('比所有資料都早、或相隔超過 10 天 → null', curveOnOrBefore(cv, '2026-11-01') === null && curveOnOrBefore(cv, '2026-12-25') === null);

// ── 3. 殖利率 ⇄ 價格 ──
const B = { currency: 'USD', rate: 4, freq: 2, maturity: '2032-05-10', buyDate: '2025-12-01', buyPricePct: 98.5, mark: null, markDate: null };
check('配息日當天、殖利率＝票息 → 平價 100', near(bondCleanPrice(B, 4, '2026-05-10'), 100, 1e-9));
check('殖利率高於票息 → 折價；低於 → 溢價', bondCleanPrice(B, 5, '2026-05-10') < 100 && bondCleanPrice(B, 3, '2026-05-10') > 100);
check('兩個配息日之間、殖利率＝票息 → 除息價仍接近 100', near(bondCleanPrice(B, 4, '2026-08-01'), 100, 0.05));
check('價格 → 殖利率 → 價格 來回一致', near(bondCleanPrice(B, bondYtm(B, 97.3, '2026-08-01'), '2026-08-01'), 97.3, 1e-6));
check('剩餘期數與距下次配息比例', bondFlows(B, '2026-05-10').n === 12 && near(bondFlows(B, '2026-05-10').w, 1) && bondFlows(B, '2032-05-09').n === 1);
check('已到期 → 無現金流、算不出價格與殖利率', bondFlows(B, '2032-05-10') === null && bondCleanPrice(B, 4, '2032-05-10') === null && bondYtm(B, 99, '2033-01-01') === null);
const Z = { ...B, rate: 0, freq: 1, maturity: '2031-11-10' };
check('零息債：5 年、4% → 100/1.04^5', near(bondCleanPrice(Z, 4, '2026-11-10'), 100 / Math.pow(1.04, 5), 1e-9));

// ── 4. 重估 ──
const flat = (date, y) => ({ date, pts: [[1, y], [30, y]] });
const bm = { ...B, mark: 98.65, markDate: '2026-09-28' };
const r0 = estimateBond(bm, [flat('2026-11-10', 4.2), flat('2026-09-28', 4.2)]);
check('曲線沒動 → 利差不變、價格只因時間經過小幅變動', r0.ok && Math.abs(r0.est.pct - 98.65) < 0.1);
const rDown = estimateBond(bm, [flat('2026-11-10', 3.7), flat('2026-09-28', 4.2)]);
const rUp = estimateBond(bm, [flat('2026-11-10', 4.7), flat('2026-09-28', 4.2)]);
check('利率下降 → 估算價上升；上升 → 下降', rDown.est.pct > r0.est.pct + 1.5 && rUp.est.pct < r0.est.pct - 1.5);
check('利差＝基準殖利率 − 當時美債殖利率，且重估殖利率＝最新美債＋利差', near(rDown.est.baseYtm - rDown.est.baseTsy, rDown.est.spreadBp / 100, 0.006) && near(rDown.est.ytm, 3.7 + (rDown.est.baseYtm - 4.2), 1e-9));
check('估算結果記下基準與曲線日期、四捨五入到 2 位', rDown.est.baseSrc === 'manual' && rDown.est.basePct === 98.65 && rDown.est.baseDate === '2026-09-28' && rDown.est.asOf === '2026-11-10' && near(rDown.est.pct * 100, Math.round(rDown.est.pct * 100), 1e-9));
const rBuy = estimateBond(B, [flat('2026-11-10', 4.0), flat('2025-12-01', 4.0)]);
check('沒有手動報價 → 以買進價為基準', rBuy.ok && rBuy.est.baseSrc === 'buy' && rBuy.est.baseDate === '2025-12-01');
check('沒有曲線', estimateBond(bm, []).why === 'nocurve');
check('非美元債不估', estimateBond({ ...bm, currency: 'TWD' }, [flat('2026-11-10', 4)]).why === 'ccy');
check('已到期不估', estimateBond({ ...bm, maturity: '2026-11-01' }, [flat('2026-11-10', 4)]).why === 'matured');
check('手動報價比最新曲線新 → 不估', estimateBond({ ...bm, markDate: '2026-11-11' }, [flat('2026-11-10', 4)]).why === 'fresh');
check('查不到基準日的曲線 → 不估', estimateBond(bm, [flat('2026-11-10', 4)]).why === 'nobase');

// ── 5. 估算何時有效 ──
const withEst = { ...bm, est: rDown.est };
check('基準沒變 → 估算有效', bondEst(withEst) === rDown.est);
check('手動改過市價（基準變了）→ 估算失效', bondEst({ ...withEst, mark: 99.05, markDate: '2026-11-12' }) === null);
check('沒有估算 → null', bondEst(bm) === null && bondBasis(bm).src === 'manual' && bondBasis(B).src === 'buy');

// ── 6. 報價紀錄 ──
const hb = {};
pushMarkHist(hb, { date: '2026-09-28', src: 'manual', pct: 98.65 });
pushMarkHist(hb, { date: '2026-11-10', src: 'est', pct: 99.31, spreadBp: 46 });
pushMarkHist(hb, { date: '2026-11-10', src: 'est', pct: 99.4, spreadBp: 46 });
pushMarkHist(hb, { date: '2026-09-28', src: 'manual', pct: 98.65, spreadBp: 46 });
check('同日同來源覆蓋、新的在前', hb.markHist.length === 2 && hb.markHist[0].pct === 99.4 && hb.markHist[1].spreadBp === 46);
for (let i = 1; i <= 20; i++) pushMarkHist(hb, { date: '2025-01-' + String(i).padStart(2, '0'), src: 'manual', pct: 90 + i });
check('最多保留 12 筆（留新的）', hb.markHist.length === T.BOND_HIST_MAX && hb.markHist[0].date === '2026-11-10');

// ── 7. 接線 ──
check('computeBond 優先用有效的估算價', html.includes('const markPct = matured ? 100 : est ? est.pct : (b.mark ?? b.buyPricePct);'));
check('手動存市價會清掉估算', html.includes('delete p.bond.est;'));
check('有重估按鈕、估算提示列與復原按鈕', html.includes('id="bondRevalBtn"') && html.includes('id="bondEstBar"') && html.includes('id="bondEstUndo"'));
check('AI Prompt 註明市價為估算', html.includes('美債殖利率曲線估算，非實際報價'));

console.log(`\nbondreval: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
