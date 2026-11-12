// 新版偵測（v2.6.0）：從線上 index.html 讀版本號、比較版本、提示條與觸發時機
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('function parseAppVersion'), j = html.indexOf('const UPD_INTERVAL', i);
if (i < 0 || j < 0) throw new Error('extract failed: update');
const { parseAppVersion, cmpVersion } = new Function(html.slice(i, j) + 'return { parseAppVersion, cmpVersion };')();

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

check('從 index.html 本身讀得出版本號', /^v\d+\.\d+\.\d+$/.test(parseAppVersion(html) || ''));
check('讀出指定版本', parseAppVersion("x\nconst APP_VERSION = 'v12.3.45';   // 註解") === 'v12.3.45');
check('找不到／空值回 null', parseAppVersion('<html></html>') === null && parseAppVersion('') === null && parseAppVersion(undefined) === null);
check('較新為正、較舊為負、相同為 0', cmpVersion('v2.6.0', 'v2.5.0') > 0 && cmpVersion('v2.5.0', 'v2.6.0') < 0 && cmpVersion('v2.5.0', 'v2.5.0') === 0);
check('以數字比較而非字串（v2.10.0 > v2.9.0）', cmpVersion('v2.10.0', 'v2.9.0') > 0 && cmpVersion('v10.0.0', 'v9.9.9') > 0);
check('PATCH／MAJOR 都比得出來', cmpVersion('v2.5.1', 'v2.5.0') > 0 && cmpVersion('v3.0.0', 'v2.99.99') > 0);
check('格式不對視為 0.0.0（不會誤報新版）', cmpVersion('abc', 'v2.5.0') < 0 && cmpVersion(null, 'v0.0.1') < 0 && cmpVersion('', '') === 0);
check('有提示條與兩顆按鈕', html.includes('id="updBar"') && html.includes('id="updBtn"') && html.includes('id="updLater"'));
check('檢查時不走快取', html.includes("{ cache: 'no-store' }"));
check('更新前先刷新瀏覽器快取', html.includes("{ cache: 'reload' }"));
check('開頁、切回前景、往返快取還原時都會檢查', html.includes('setTimeout(checkForUpdate, 3000)') && html.includes("'visibilitychange'") && html.includes("'pageshow'"));
check('file:// 不檢查', html.includes("if (!/^https?:$/.test(location.protocol)) return;"));
check('列印時隱藏提示條', /#appBar, #tabBar, #updBar/.test(html));

console.log(`\nupdate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
