// 模型定價測試（v1.49.0）：費率選擇（一般／promo／long_context／查無）、費用估算、usage 格式正規化、標籤文字、價格表載入後備
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error('extract failed: ' + startMarker);
  return html.slice(i, j);
}
const src = extract('const PRICING_URL', '/* ════════════════ OpenAI（串流）');
// 每次呼叫得到一組全新的模組（pricingPromise 是快取，測 loadPricing 兩種路徑要各自乾淨）
const fresh = () => new Function(src + '\nreturn { PRICING_FALLBACK, loadPricing, effectiveRates, estimateCostUSD, usageOf, usageLabel, usageTail };')();

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 文章範例表：promo（gemini）、long_context（grok-4.7）、無附加欄位（claude-opus-5-5）
const TABLE = { schema_version: 1, updated_at: '2026-09-25', models: {
  'gemini-3.8-flash': { input: 1.50, output: 7.50, promo: { input: 0.75, output: 3.75, until: '2026-12-31' } },
  'grok-4.7': { input: 2.00, output: 6.00, long_context: { threshold: 200000, input: 4.00, output: 12.00 } },
  'claude-opus-5-5': { input: 4.00, output: 20.00 },
} };

(async () => {
  const M = fresh();

  console.log('A. effectiveRates 費率選擇');
  let r = M.effectiveRates(TABLE, 'grok-4.7', 1000);
  check('一般費率', r.input === 2 && r.output === 6);
  r = M.effectiveRates(TABLE, 'grok-4.7', 200000);
  check('剛好等於 threshold 仍用一般費率（需「超過」）', r.input === 2 && r.output === 6);
  r = M.effectiveRates(TABLE, 'grok-4.7', 200001);
  check('超過 threshold 改用 long_context 費率', r.input === 4 && r.output === 12);
  r = M.effectiveRates(TABLE, 'gemini-3.8-flash', 0, new Date(2026, 9, 1));
  check('promo 期限內用優惠價', r.input === 0.75 && r.output === 3.75);
  r = M.effectiveRates(TABLE, 'gemini-3.8-flash', 0, new Date(2026, 11, 31));
  check('promo until 當天（含）仍用優惠價', r.input === 0.75);
  r = M.effectiveRates(TABLE, 'gemini-3.8-flash', 0, new Date(2027, 0, 1));
  check('promo 過期回一般費率', r.input === 1.5 && r.output === 7.5);
  check('查無模型回 null', M.effectiveRates(TABLE, 'no-such-model') === null);
  check('table 為 null 回 null', M.effectiveRates(null, 'grok-4.7') === null);

  console.log('B. estimateCostUSD 費用估算');
  check('文章範例：claude-opus-5-5 12,000 / 3,000 → 0.108', near(M.estimateCostUSD(TABLE, 'claude-opus-5-5', 12000, 3000), 0.108));
  check('grok-4.7 一般：100,000 / 10,000 → 0.26', near(M.estimateCostUSD(TABLE, 'grok-4.7', 100000, 10000), 0.26));
  check('grok-4.7 長上下文：300,000 / 10,000 → 1.32（整筆翻倍）', near(M.estimateCostUSD(TABLE, 'grok-4.7', 300000, 10000), 1.32));
  check('查無模型回 null', M.estimateCostUSD(TABLE, 'no-such-model', 100, 100) === null);
  check('內嵌後備表 grok-4.7：100,000 / 10,000 → 0.26', near(M.estimateCostUSD(M.PRICING_FALLBACK, 'grok-4.7', 100000, 10000), 0.26));
  check('內嵌後備表已移除 grok-4.5', !M.PRICING_FALLBACK.models['grok-4.5']);
  check('內嵌後備表 gpt-6.1-sol 10,000 / 5,000 → 0.07', near(M.estimateCostUSD(M.PRICING_FALLBACK, 'gpt-6.1-sol', 10000, 5000), 0.07));

  console.log('C. usageOf 格式正規化');
  let u = M.usageOf({ input_tokens: 1200, output_tokens: 300, total_tokens: 1500, output_tokens_details: { reasoning_tokens: 120 } });
  check('Responses API 格式', u.input === 1200 && u.output === 300 && u.reasoning === 120);
  u = M.usageOf({ prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 });
  check('chat/completions 格式', u.input === 800 && u.output === 200 && u.reasoning === 0);
  u = M.usageOf({ input_tokens: 1000, output_tokens: 500, total_tokens: 1800 });
  check('total 大於 input＋output → 差額併入輸出計費', u.output === 800);
  u = M.usageOf({ input_tokens: 1000, output_tokens: 500 });
  check('無 total_tokens 也可', u.input === 1000 && u.output === 500);
  check('null → null', M.usageOf(null) === null);
  check('缺欄位 → null', M.usageOf({ foo: 1 }) === null);

  console.log('D. usageLabel／usageTail 文字');
  const usage = { input: 12000, output: 3000, reasoning: 0 };
  let s = M.usageLabel(usage, 0.108, '');
  check('含千分位 tokens 與 US$ 費用', s === 'tokens 輸入 12,000／輸出 3,000　·　約 US$0.108');
  s = M.usageLabel({ input: 12000, output: 3000, reasoning: 1200 }, 0.108, 'web search');
  check('含推理 tokens 與工具費註記', s.includes('（含推理 1,200）') && s.endsWith('（不含 web search 工具費）'));
  check('費率未知（cost=null）', M.usageLabel(usage, null, '') === 'tokens 輸入 12,000／輸出 3,000　·　費率未知');
  check('小額費用顯示 4 位小數', M.usageLabel(usage, 0.0045, '').includes('US$0.0045'));
  check('usage=null → 空字串', M.usageLabel(null, 0.1, '') === '');
  check('usageTail 有字才加分隔', M.usageTail('') === '' && M.usageTail('x') === '　·　x');

  console.log('E. loadPricing 線上表／內嵌後備');
  const M1 = fresh();
  global.fetch = async () => { throw new Error('offline'); };
  let t = await M1.loadPricing();
  check('fetch 失敗 → 退回內嵌後備表', t === M1.PRICING_FALLBACK);
  for (const id of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.6-terra', 'grok-4.3', 'grok-4.7'])
    check(`後備表含下拉選單模型 ${id}`, !!t.models[id]);
  const M2 = fresh();
  global.fetch = async (url, opts) => ({ ok: true, json: async () => ({ schema_version: 1, updated_at: '2099-01-01', models: { 'x': { input: 1, output: 2 } } }) });
  t = await M2.loadPricing();
  check('fetch 成功 → 用線上表', t.updated_at === '2099-01-01');
  check('同一模組第二次呼叫回同一個 promise（只抓一次）', M2.loadPricing() === M2.loadPricing());
  const M3 = fresh();
  global.fetch = async () => ({ ok: false, status: 404 });
  t = await M3.loadPricing();
  check('HTTP 404 → 退回內嵌後備表', t === M3.PRICING_FALLBACK);
  const M4 = fresh();
  global.fetch = async () => ({ ok: true, json: async () => ({ garbage: true }) });
  t = await M4.loadPricing();
  check('JSON 缺 models → 退回內嵌後備表', t === M4.PRICING_FALLBACK);

  console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
