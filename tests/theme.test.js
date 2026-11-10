// 佈景主題：預設值規則（新使用者淺色、既有使用者深色）與 auto 解析；並檢查 CSS 不再有寫死的深色值
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf("const THEMES = ['auto'");
const j = html.indexOf('let db = {', i);
if (i < 0 || j < 0) throw new Error('extract failed: theme');
const { storedTheme, resolveTheme } = new Function(html.slice(i, j) + 'return { storedTheme, resolveTheme };')();

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

check('新使用者（無資料）預設淺色', storedTheme(null) === 'light');
check('既有使用者（資料無 theme 欄位）維持深色', storedTheme({ positions: [], settings: { twFee: 0.1425 } }) === 'dark');
check('既有使用者連 settings 都沒有 → 深色', storedTheme({ positions: [] }) === 'dark');
check('已存的設定照用', ['auto', 'dark', 'light'].every(t => storedTheme({ settings: { theme: t } }) === t));
check('不認得的值 → 深色', storedTheme({ settings: { theme: 'pink' } }) === 'dark');
check('resolveTheme：dark／light 直接採用', resolveTheme('dark', false) === 'dark' && resolveTheme('light', true) === 'light');
check('resolveTheme：auto 跟隨系統', resolveTheme('auto', true) === 'dark' && resolveTheme('auto', false) === 'light');

// 先行套用的小段 script 與主程式規則一致
const boot = html.match(/<script id="themeBoot">([\s\S]*?)<\/script>/)[1];
function runBoot(stored, sysDark) {
  let attr = null;
  new Function('localStorage', 'window', 'matchMedia', 'document', boot)(
    { getItem: () => stored == null ? null : JSON.stringify(stored) },
    { matchMedia: true }, () => ({ matches: sysDark }),
    { documentElement: { setAttribute: (k, v) => { attr = v; } } });
  return attr;
}
const cases = [[null, false], [null, true], [{ positions: [] }, false], [{ settings: { theme: 'auto' } }, true],
  [{ settings: { theme: 'auto' } }, false], [{ settings: { theme: 'light' } }, true], [{ settings: { theme: 'dark' } }, false]];
check('themeBoot 與 storedTheme＋resolveTheme 結果一致', cases.every(([st, sd]) => runBoot(st, sd) === resolveTheme(storedTheme(st), sd)));

// CSS：螢幕樣式不得再有寫死的色碼（:root 變數定義與 @media print 除外）
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const screenCss = css.slice(0, css.indexOf('@media print'));
const bad = screenCss.split('\n').filter(l => !/^\s*(--[\w-]+:|\/\*)/.test(l) && /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(l.replace(/--[\w-]+:\s*[^;]+;/g, '')));
check('螢幕 CSS 無寫死色碼（都走變數）' + (bad.length ? '：' + bad[0].trim().slice(0, 80) : ''), bad.length === 0);
const light = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/)[1];
const darkVars = [...css.match(/:root\s*\{([\s\S]*?)\n  \}/)[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
check('淺色佈景覆寫了每一個顏色變數', darkVars.every(v => light.includes(v + ':')));
check('紅漲綠跌未對調（淺色 --up 偏紅、--down 偏綠）', /--up:\s*#c0392b/.test(light) && /--down:\s*#1e8e5a/.test(light));
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
check('<canvas> 不再用寫死色碼', !/ctx\.(fill|stroke)Style\s*=\s*'(#|rgb)/.test(js));
check('設定有佈景主題下拉（auto／dark／light）', /id="themeSel"/.test(html) && ['auto', 'dark', 'light'].every(v => html.includes(`<option value="${v}">`)));

console.log(`\ntheme: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
