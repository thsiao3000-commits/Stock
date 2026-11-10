// KOL 雷達 Grok 直查的搜尋迄日（v1.55.0）：x_search 的 to_date 不含當天、以 UTC 計 → 必須傳 UTC 的明天
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/function kolToDate[^\n]*\n/);
if (!m) { console.log('✗ FAIL: 找不到 kolToDate'); process.exit(1); }
const kolToDate = new Function(m[0] + 'return kolToDate;')();

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

check('一般日 → UTC 明天', kolToDate(new Date('2026-11-10T05:00:00Z')) === '2026-11-11');
check('台灣凌晨（UTC 仍是前一天）→ 以 UTC 計的明天', kolToDate(new Date('2026-11-10T02:00:00+08:00')) === '2026-11-10');
check('跨月', kolToDate(new Date('2026-11-30T12:00:00Z')) === '2026-12-01');
check('跨年', kolToDate(new Date('2026-12-31T23:59:59Z')) === '2027-01-01');
check('迄日一定晚於現在的 UTC 日期', kolToDate() > new Date().toISOString().slice(0, 10));
check('請求用 kolToDate()、不再傳今天', html.includes('to_date: kolToDate() }') && !html.includes('to_date: todayISO()'));

console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
