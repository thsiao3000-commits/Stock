// 分頁架構與響應式導覽：結構檢查（既有元素不遺失、各在正確分頁）與 normTab
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

const i = html.indexOf("const TAB_IDS = [");
const j = html.indexOf('let curTab', i);
const { normTab, TAB_IDS } = new Function(html.slice(i, j) + 'return { normTab, TAB_IDS };')();
check('六個分頁：總覽／持倉／AI 分析／觀察清單／績效／設定', JSON.stringify(TAB_IDS) === JSON.stringify(['home', 'holdings', 'ai', 'watch', 'perf', 'settings']));
check('normTab：不認得或空值回總覽', normTab('zzz') === 'home' && normTab(null) === 'home' && normTab('perf') === 'perf');

const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>\n\'use strict\''));
// 依 <div class="tab" data-tab="x"> 切出各分頁內容
const starts = [...body.matchAll(/<div class="tab" data-tab="(\w+)">/g)].map(m => ({ id: m[1], at: m.index }));
check('每個分頁各有一個容器、順序正確', JSON.stringify(starts.map(s => s.id)) === JSON.stringify(TAB_IDS));
const tabHtml = {};
starts.forEach((s, n) => { tabHtml[s.id] = body.slice(s.at, n + 1 < starts.length ? starts[n + 1].at : body.indexOf('</main>')); });
const where = id => Object.keys(tabHtml).filter(t => tabHtml[t].includes(`id="${id}"`));
const expect = {
  home: ['demoBar', 'onboardBox', 'sec1', 'sumCards', 'quoteBtn', 'homeSide'],
  holdings: ['sec2', 'addBox', 'posTable', 'posCards', 'posExpand', 'holdLayout'],
  ai: ['sec3', 'aiTarget', 'chart', 'aiBtn', 'pfBtn', 'aiOutput', 'histSel', 'fuBox', 'aiReportBox'],
  watch: ['sec4', 'wlBody', 'wsOutput', 'kolBox', 'kolOutput'],
  perf: ['sec5', 'perfCards', 'perfChart', 'curveBtn', 'perfSide'],
  settings: ['setupBox', 'apiKey', 'anthropicKey', 'modelSel', 'themeSel', 'exportBtn', 'importBtn', 'costBox', 'costTable', 'helpBox', 'helpQ0'],
};
for (const [tab, ids] of Object.entries(expect)) {
  const bad = ids.filter(id => JSON.stringify(where(id)) !== JSON.stringify([tab]));
  check(`「${tab}」分頁包含：${ids.join('、')}` + (bad.length ? `（不符：${bad.join('、')}）` : ''), bad.length === 0);
}
const ids = [...body.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, n) => ids.indexOf(x) !== n);
check('靜態 HTML 沒有重複的 id' + (dup.length ? '：' + dup.join('、') : ''), dup.length === 0);

const nav = body.match(/<nav id="tabNav"[\s\S]*?<\/nav>/)[0], bar = body.match(/<nav id="tabBar"[\s\S]*?<\/nav>/)[0];
const tabsOf = s => [...s.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
check('頂部分頁列六項', JSON.stringify(tabsOf(nav)) === JSON.stringify(TAB_IDS));
check('底部 Tab Bar 五項（設定在頂列按鈕）', JSON.stringify(tabsOf(bar)) === JSON.stringify(TAB_IDS.slice(0, 5)) && /id="settingsBtn" data-tab="settings"/.test(body));
check('舊的頁首大標與錨點導覽已移除', !/id="topNav"/.test(html) && !/<h1>/.test(body) && !/href="#sec\d"/.test(body));
check('設定、AI 花費統計、KOL 雷達不再是摺疊區', /<section id="setupBox">/.test(body) && /<section id="costBox">/.test(body) && /<section id="kolBox">/.test(body));

const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
check('斷點：手機 <600、平板 600–1023、桌面 ≥1024', /@media \(max-width: 599px\)/.test(css) && /@media \(min-width: 600px\) and \(max-width: 1023px\)/.test(css) && /@media \(min-width: 1024px\)/.test(css));
check('桌面雙欄 1.45fr 1fr、gap 20px', /\.cols\.wide \{ grid-template-columns: minmax\(0, 1\.45fr\) minmax\(0, 1fr\); \}/.test(css) && /\.cols \{[^}]*column-gap: 20px/.test(css));
check('Tab Bar 高 56px 另加 safe-area', /#tabBar \{[^}]*height: calc\(56px \+ env\(safe-area-inset-bottom\)\)/.test(css) && /viewport-fit=cover/.test(html));
check('觸控裝置最小高度 44px', /@media \(pointer: coarse\) \{[^}]*min-height: 44px/.test(css));
check('摺疊機：偵測 horizontal-viewport-segments 並左右各一欄', /horizontal-viewport-segments: 2/.test(html) && /:root\.fold \.cols, :root\.fold #holdLayout \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/.test(css));
check('手機：明細取代列表、按鈕為「‹ 返回列表」', /#holdLayout\.hasDetail #sec2 \{ display: none; \}/.test(css) && html.includes('‹ 返回列表'));
check('列印時隱藏導覽', /@media print[\s\S]*#appBar, #tabBar/.test(css));

console.log(`\ntabs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
