// 追問 AI 測試（v1.51.0）：Prompt 組裝、報告末尾附加格式、追問計數、報告類型判斷、
// saveReports 空間不足時先丟 srcPrompt、附加段落經 mdToHtml 正確渲染
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error('extract failed: ' + startMarker);
  return html.slice(i, j);
}
// 純函式區：FU_RE／fuCount／buildFollowupPrompt／followupSection／FU_CHIPS／fuKind（到 fuEntry 為止，之後開始碰 DOM）
const FU_CHIPS = eval(extract('const FU_RE', 'function fuEntry') + ';FU_CHIPS');   // eval 內的 const 不外洩，取最後一個表達式值拿到快速追問表
eval(extract('function mdToHtml', '/* ════════════════ 設定綁定'));

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

// ── 1. fuCount：只數「## 💬 追問 N」標題 ──
const REPORT = '# 台股個股分析 — 2330\n\n**產生時間：** 2026-11-08 21:00\n\n---\n\n## 1. 趨勢研判\n\n多頭排列。\n';
check('純報告追問數為 0', fuCount(REPORT) === 0);
check('空字串／undefined 不炸', fuCount('') === 0 && fuCount(undefined) === 0);
const sec1 = followupSection(1, '支撐在哪？', '支撐 1,000。', 'gpt-6.1-sol', '2026-11-08 21:10', 'tokens 輸入 12,000／輸出 800　·　約 US$0.032');
const sec2 = followupSection(2, '壓力呢？', '壓力 1,100。', 'gpt-6.1-sol', '2026-11-08 21:15', '');
check('兩輪追問後計數為 2', fuCount(REPORT + sec1 + sec2) === 2);
check('內文提到「追問」字樣不誤計（需為 ## 標題）', fuCount(REPORT + '\n我想追問 3 個問題\n### 💬 追問 9：x\n') === 0);
check('連續呼叫（RegExp g flag）結果穩定', fuCount(REPORT + sec1 + sec2) === 2 && fuCount(REPORT + sec1) === 1);

// ── 2. followupSection：格式 ──
check('以分隔線＋標題開頭', sec1.startsWith('\n\n---\n\n## 💬 追問 1：支撐在哪？\n\n'));
check('引言列時間戳、模型、用量', sec1.includes('> 🕒 2026-11-08 21:10　｜　AI 模型：gpt-6.1-sol　｜　用量：tokens 輸入 12,000／輸出 800　·　約 US$0.032'));
check('無用量時不列「用量」', sec2.includes('> 🕒 2026-11-08 21:15　｜　AI 模型：gpt-6.1-sol\n') && !sec2.includes('用量'));
check('回答內容接在引言後、結尾換行', sec1.endsWith('\n\n支撐 1,000。\n'));
check('短問題不另列「問題全文」', !sec1.includes('問題全文'));
const longQ = '如果未來一週跌破 MA60 且外資連續賣超三天以上，\n我應該怎麼處理手上的部位？要不要先減碼一半再觀察，還是直接停損出場？';
const secLong = followupSection(3, longQ, '答。', 'm', 'ts', '');
check('長問題標題截 60 字加 …', /^\n\n---\n\n## 💬 追問 3：.{60}…\n/.test(secLong));
check('長問題另列「問題全文」且換行壓成空格', secLong.includes('**問題全文：** 如果未來一週跌破 MA60 且外資連續賣超三天以上， 我應該怎麼處理手上的部位？'));
check('answer／question 為空不炸', followupSection(1, '', null, 'm', 'ts', null).includes('## 💬 追問 1：'));

// ── 3. buildFollowupPrompt：內容與後備 ──
const entryWithSrc = { id: 'a', title: '台股個股分析 — 2330', symbol: '2330', fullText: REPORT + sec1, srcPrompt: '【技術指標】RSI=55\n【日線】2026-11-07,1000,1010,990,1005,20000' };
let p = buildFollowupPrompt(entryWithSrc, '為什麼支撐是 1,000？');
check('含原始數據區塊與 srcPrompt 內容', p.includes('【產生這份報告時提供給 AI 的原始數據與指示') && p.includes('RSI=55'));
check('含報告全文（連先前追問）', p.includes('## 1. 趨勢研判') && p.includes('## 💬 追問 1：支撐在哪？'));
check('本次追問置於最後', p.trimEnd().endsWith('【本次追問】\n為什麼支撐是 1,000？'));
check('指示要求繁體中文、不複述、不編造、僅供參考', p.includes('繁體中文') && p.includes('不要重寫或整段複述') && p.includes('不要編造') && p.includes('不構成投資建議'));
check('原始數據區塊在報告全文之前', p.indexOf('【產生這份報告時') < p.indexOf('【報告全文'));
p = buildFollowupPrompt({ id: 'b', title: 'KOL 選股雷達', fullText: REPORT }, 'Q');
check('無 srcPrompt → 後備說明、禁止臆測數字', p.includes('此報告未保存產生時的原始數據') && p.includes('請勿臆測') && !p.includes('【產生這份報告時'));

// ── 4. fuKind：報告類型 → 快速追問組 ──
check('帶 symbol 的為個股', fuKind(entryWithSrc) === 'stock');
check('投資組合總評（含視角）為 portfolio', fuKind({ title: '投資組合總評（價值存股派）' }) === 'portfolio');
check('快篩／雷達為 other', fuKind({ title: '觀察清單快篩總評' }) === 'other' && fuKind({ title: 'KOL 選股雷達 — X' }) === 'other');
check('每種類型都有快速追問且不重複', ['stock', 'portfolio', 'other'].every(k => FU_CHIPS[k].length >= 3 && new Set(FU_CHIPS[k]).size === FU_CHIPS[k].length));

// ── 5. 附加段落經 mdToHtml 渲染 ──
const out = mdToHtml(REPORT + sec1);
check('追問標題渲染為 h2', out.includes('<h2>💬 追問 1：支撐在哪？</h2>'));
check('時間戳引言渲染為 blockquote', out.includes('<blockquote><p>🕒 2026-11-08 21:10　｜　AI 模型：gpt-6.1-sol　｜　用量：tokens 輸入 12,000／輸出 800　·　約 US$0.032</p></blockquote>'));
check('分隔線渲染為 hr、回答為段落', out.includes('<hr>') && out.includes('<p>支撐 1,000。</p>'));

// ── 6. saveReports：空間不足先丟最舊的 srcPrompt，再丟整份報告 ──
const REPORTS_KEY = 'twpf_reports';
let reportHist = [
  { id: 'new', fullText: 'N'.repeat(100), srcPrompt: 'S'.repeat(500) },
  { id: 'mid', fullText: 'M'.repeat(100) },
  { id: 'old', fullText: 'O'.repeat(100), srcPrompt: 'S'.repeat(500) },
];
let store = null, limit = Infinity;
global.localStorage = { setItem: (k, v) => { if (v.length > limit) throw new Error('QuotaExceededError'); store = v; } };
eval(extract('function saveReports', 'function renderHistSel'));
limit = 1100;   // 三份＋兩個 500 字 prompt 超過；丟掉最舊的 srcPrompt 後約 760 字可過
saveReports();
check('先丟最舊報告的 srcPrompt、三份報告都保留', reportHist.length === 3 && !reportHist[2].srcPrompt && reportHist[0].srcPrompt && store && JSON.parse(store).length === 3);
limit = 300;    // 再縮：丟掉最新的 srcPrompt（三份約 390 字）仍不夠 → 開始丟最舊報告（兩份約 260 字可過）
saveReports();
check('srcPrompt 全丟後才丟整份報告，且最舊的先丟', reportHist.every(r => !r.srcPrompt) && reportHist.length === 2 && reportHist[0].id === 'new' && reportHist[1].id === 'mid');
limit = 10;     // 只剩一份仍塞不下 → 放棄保存但不丟最後一份
saveReports();
check('只剩一份塞不下就放棄，不清空', reportHist.length === 1 && reportHist[0].id === 'new');

// ── 7. UI 綁定／接線存在性（純文字檢查）──
check('③ 有追問區與輸入／按鈕', html.includes('id="fuBox"') && html.includes('id="fuInput"') && html.includes('id="fuBtn"') && html.includes('id="fuCopyBtn"'));
check('setReport／setPanelReport 多收 srcPrompt', html.includes('function setReport(title, model, markdown, filenameBase, meta, usageText, srcPrompt)') && html.includes('function setPanelReport(prefix, title, model, markdown, filenameBase, usageText, srcPrompt)'));
check('個股／組合／快篩／雷達四處都把 prompt 存進報告', (html.match(/usageText, prompt\);/g) || []).length === 5);
check('runAI／runGrok 寫 ③ 時收起追問區', (html.match(/\$\('fuBox'\)\.style\.display = 'none'/g) || []).length >= 2);
check('showReport 顯示追問數並渲染追問區', html.includes('renderFuBox(r);') && html.includes('含 ${nq} 則追問'));
check('範例報告不提供追問', html.includes('if (!r || r.demo) { box.style.display = \'none\'; return; }'));

console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
