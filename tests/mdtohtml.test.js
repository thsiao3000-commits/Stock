// mdToHtml 渲染測試：XSS 跳脫（v1.37.0）＋全形｜表格容錯（v1.37.1）＋既有語法回歸
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('function mdToHtml');
const j = html.indexOf('/* ════════════════ 設定綁定', i);
if (i < 0 || j < 0) throw new Error('extract failed: mdToHtml');
eval(html.slice(i, j));

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

// 1. 雙引號被跳脫
let out = mdToHtml('他說 "test" 一句');
check('文字中的 " 轉為 &quot;', out.includes('&quot;test&quot;') && !out.includes('"test"'));

// 2. 惡意 URL 無法跳出 href 屬性
out = mdToHtml('[點我](https://evil.com/"onmouseover="alert(1))');
check('URL 中的 " 不會產生裸屬性注入', !out.includes('"onmouseover'));
check('注入內容整段留在 href 值內', out.includes('href="https://evil.com/&quot;onmouseover=&quot;alert(1"'));   // URL 正則遇 ) 截斷

// 3. 既有渲染不回歸
out = mdToHtml('# 標題\n**粗體** 與 [連結](https://a.b/c)\n\n- 項目一\n- 項目二\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> 引言');
check('標題', out.includes('<h1>標題</h1>'));
check('粗體', out.includes('<b>粗體</b>'));
check('連結', out.includes('<a href="https://a.b/c" target="_blank" rel="noopener">連結</a>'));
check('清單', out.includes('<li>項目一</li>'));
check('表格', out.includes('<th>A</th>') && out.includes('<td>1</td>'));
check('引言', out.includes('<blockquote><p>引言</p></blockquote>'));

// 4. code block 內的引號照樣安全顯示
out = mdToHtml('```\nconst s = "x";\n```');
check('code block 引號跳脫', out.includes('<pre>') && out.includes('&quot;x&quot;'));

// 5. 全形｜表格（Grok 中文報告實例）正確渲染
out = mdToHtml('｜代號｜公司名稱｜\n｜–––｜–––｜\n｜$AEVA｜Aeva｜');
check('全形｜列被視為表格', out.includes('<table>') && out.includes('<th>代號</th>') && out.includes('<td>$AEVA</td>'));
check('全形破折號分隔列被略過', !out.includes('–––'));

// 6. 列間空行不打斷表格
out = mdToHtml('|a|b|\n|---|---|\n\n|1|2|\n\n|3|4|');
check('空行分隔的列合併為同一張表', (out.match(/<table>/g) || []).length === 1 && out.includes('<td>3</td>'));

// 7. 一般文句中的全形｜不受影響（報告 meta 列的分隔符）
out = mdToHtml('**產生時間：** 2026-07-08　｜　**AI 模型：** grok-4.3');
check('非表格行的全形｜維持原樣', !out.includes('<table>') && out.includes('｜'));

console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
