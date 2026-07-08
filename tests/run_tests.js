#!/usr/bin/env node
// 測試入口（純 Node、零相依）：
//   1. 抽出 index.html 內嵌 <script> 做語法檢查（node --check）
//   2. 依序執行本目錄所有 *.test.js（每個套件也可單獨 node tests/xxx.test.js 執行）
// 本地：node tests/run_tests.js　CI：.github/workflows/test.yml 於每次 push 自動執行
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('✗ index.html 找不到 <script> 區塊'); process.exit(1); }
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'twpf-')), 'app.js');
fs.writeFileSync(tmp, m[1]);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
  console.log('✓ index.html 內嵌 JS 語法檢查通過');
} catch (_) {
  console.error('✗ JS 語法錯誤（見上方訊息）');
  process.exit(1);
}

const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of suites) {
  console.log(`\n── ${f} ──`);
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch (_) { failed++; }
}
console.log(failed ? `\n✗ ${failed} 個測試套件失敗` : `\n✓ 全部 ${suites.length} 個測試套件通過`);
process.exit(failed ? 1 : 0);
