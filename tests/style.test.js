// 方向 C 視覺規則：字型、圓角、按鈕／標題／導覽不含 emoji 與 ①–⑤ 編號
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2460}-\u{2473}\u{2B50}\u{FE0F}]/u;
// 靜態 HTML 與 JS 樣板裡的按鈕、標題、summary、導覽連結
const tags = [...html.matchAll(/<(button|h1|h2|summary|title)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => m[2]);
const bad = tags.filter(t => EMOJI.test(t));
check('按鈕／標題／summary 不含 emoji 與 ①–⑤' + (bad.length ? '：' + bad[0].slice(0, 40) : ''), tags.length > 40 && bad.length === 0);
const flash = [...html.matchAll(/flashBtn\('[^']+',\s*'([^']+)'/g)].map(m => m[1]);
check('複製按鈕還原文字不含 emoji', flash.length >= 3 && flash.every(t => !EMOJI.test(t)));
check('使用者可見文字不再用 ①–⑤ 指稱區塊', !/[①②③④⑤]/.test(html.replace(/^\s*\/\/.*$/gm, '')));
check('載入三套 Google Fonts', /fonts\.googleapis\.com\/css2\?[^"]*IBM\+Plex\+Mono[^"]*Noto\+Sans\+TC[^"]*Noto\+Serif\+TC/.test(html));
check('字型變數都有系統字型後備', /--font-sans:[^;]*sans-serif;/.test(css) && /--font-serif:[^;]*serif;/.test(css) && /--font-mono:[^;]*monospace;/.test(css));
check('標題用襯線體、表格儲存格用等寬字', /h1, h2 \{ font-family: var\(--font-serif\)/.test(css) && /\btd,[^{]*\{ font-family: var\(--font-mono\)/.test(css));
check('section 圓角 6px', /section, details\.box \{[^}]*border-radius: 6px/.test(css));
const radii = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map(m => +m[1]);
check('其餘圓角不超過 6px（膠囊形 99px 以上除外）', radii.every(r => r <= 6 || r >= 99));
check('追問標題與引用來源標記保留（已存報告的解析依賴它）', html.includes('## 💬 追問') && html.includes('📎 引用來源'));

console.log(`\nstyle: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
