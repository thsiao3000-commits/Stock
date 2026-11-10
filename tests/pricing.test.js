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
const fresh = () => new Function(src + '\nreturn { PRICING_FALLBACK, loadPricing, effectiveRates, estimateCostUSD, usageOf, usageLabel, usageTail, monthKeyOf, sanitizeUsageLog, addUsageRecord, usageMonthRows, USAGE_MONTHS_MAX, xaiToolFee, XAI_TOOL_RATES, webSearchFee };')();

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

  check('內嵌後備表 claude-opus-5-5 12,000 / 3,000 → 0.108', near(M.estimateCostUSD(M.PRICING_FALLBACK, 'claude-opus-5-5', 12000, 3000), 0.108));
  check('內嵌後備表 claude-fable-5-2 10,000 / 5,000 → 0.28', near(M.estimateCostUSD(M.PRICING_FALLBACK, 'claude-fable-5-2', 10000, 5000), 0.28));
  check('內嵌後備表 claude-sonnet-5-5 10,000 / 5,000 → 0.07', near(M.estimateCostUSD(M.PRICING_FALLBACK, 'claude-sonnet-5-5', 10000, 5000), 0.07));

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
  for (const id of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'grok-4.3', 'grok-4.7'])
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

  console.log('F. AI 花費統計（月份 → 模型累計）');
  check('monthKeyOf 補零', M.monthKeyOf(new Date(2026, 0, 31)) === '2026-01' && M.monthKeyOf(new Date(2026, 10, 10)) === '2026-11');
  const log = {};
  M.addUsageRecord(log, '2026-11', 'gpt-6.1-sol', { input: 10000, output: 5000, reasoning: 0 }, 0.07);
  M.addUsageRecord(log, '2026-11', 'gpt-6.1-sol', { input: 2000, output: 1000, reasoning: 0 }, 0.014);
  M.addUsageRecord(log, '2026-11', 'grok-4.3', { input: 40000, output: 4000, reasoning: 0 }, 0.06);
  M.addUsageRecord(log, '2026-11', 'my-custom', { input: 500, output: 100, reasoning: 0 }, null);
  M.addUsageRecord(log, '2026-11', 'gpt-6.1-sol', null, null);
  M.addUsageRecord(log, '2026-10', 'gpt-6-astra', { input: 1000, output: 1000, reasoning: 0 }, 0.06);
  let mr = M.usageMonthRows(log, '2026-11');
  check('同模型同月累加', mr.rows[0].model === 'gpt-6.1-sol' && mr.rows[0].calls === 3 && mr.rows[0].input === 12000 && mr.rows[0].output === 6000 && near(mr.rows[0].cost, 0.084));
  check('依費用高→低排序', mr.rows.map(x => x.model).join() === 'gpt-6.1-sol,grok-4.3,my-custom');
  check('費率未知／無 usage 計入 unpriced、不計費用', mr.rows[0].unpriced === 1 && mr.rows[2].unpriced === 1 && mr.rows[2].cost === 0 && mr.rows[2].input === 500);
  check('月合計', mr.total.calls === 5 && mr.total.input === 52500 && mr.total.output === 10100 && near(mr.total.cost, 0.144) && mr.total.unpriced === 2);
  check('月份互不混算', M.usageMonthRows(log, '2026-10').total.calls === 1 && near(M.usageMonthRows(log, '2026-10').total.cost, 0.06));
  mr = M.usageMonthRows(log, '2025-01');
  check('無紀錄月份 → 空表、合計為 0', mr.rows.length === 0 && mr.total.calls === 0 && mr.total.cost === 0);
  check('log 為 null 也可', M.usageMonthRows(null, '2026-11').rows.length === 0);
  const big = {};
  for (let i = 0; i < 15; i++) M.addUsageRecord(big, M.monthKeyOf(new Date(2025, i, 1)), 'm', { input: 1, output: 1 }, 0.001);
  check(`只保留最近 ${M.USAGE_MONTHS_MAX} 個月`, Object.keys(big).length === M.USAGE_MONTHS_MAX && !big['2025-03'] && !!big['2025-04'] && !!big['2026-03']);
  const clean = M.sanitizeUsageLog({ '2026-11': { 'gpt-6.1-sol': { calls: 2, input: 100, output: 50, cost: 0.01, unpriced: 0 }, bad: null, neg: { calls: -1, input: 'x', cost: NaN } }, 'not-a-month': { m: { calls: 1 } }, '2026-10': 'junk' });
  check('sanitize 保留合法紀錄', clean['2026-11']['gpt-6.1-sol'].calls === 2 && near(clean['2026-11']['gpt-6.1-sol'].cost, 0.01));
  check('sanitize 丟棄非法月份／紀錄、壞數字歸零', !clean['not-a-month'] && !clean['2026-10'] && !('bad' in clean['2026-11']) && clean['2026-11'].neg.calls === 0 && clean['2026-11'].neg.cost === 0 && clean['2026-11'].neg.input === 0);
  check('sanitize 非物件 → 空表', Object.keys(M.sanitizeUsageLog(null)).length === 0 && Object.keys(M.sanitizeUsageLog([1, 2])).length === 0 && Object.keys(M.sanitizeUsageLog('x')).length === 0);

  console.log('G. xAI x_search 工具費（依抓取項目數）');
  const det = (o) => ({ input_tokens: 1, output_tokens: 1, server_side_tool_usage_details: o });
  let fee = M.xaiToolFee(det({ web_search_calls: 0, x_search_calls: 2, x_posts_fetched: 44, x_users_fetched: 3 }));
  check('官方範例：44 則貼文＋3 個帳號 → 0.22＋0.03＝0.25', near(fee.cost, 0.25));
  check('註記列出則數與帳號數（不列呼叫次數）', fee.note === '44 則貼文、3 個帳號檔案');
  fee = M.xaiToolFee(det({ x_search_calls: 5, x_posts_fetched: 1200, x_users_fetched: 0 }));
  check('1,200 則貼文 → 6.00、千分位', near(fee.cost, 6) && fee.note === '1,200 則貼文');
  fee = M.xaiToolFee(det({ x_search_calls: 1, x_posts_fetched: 0, x_users_fetched: 0 }));
  check('搜尋了但抓到 0 則 → 費用 0（已知，不是未知）', fee && fee.cost === 0 && fee.note === '抓取 0 則');
  fee = M.xaiToolFee(det({ web_search_calls: 4, x_posts_fetched: 10 }));
  check('web_search 按次計（4 次 0.02）＋貼文 0.05', near(fee.cost, 0.07) && fee.note === '10 則貼文、4 次 web search');
  check('只有呼叫次數、沒有抓取數（舊格式）→ null', M.xaiToolFee(det({ x_search_calls: 3 })) === null);
  check('無明細／null → null', M.xaiToolFee({ input_tokens: 1, output_tokens: 1 }) === null && M.xaiToolFee(null) === null);
  check('壞數字不計', near(M.xaiToolFee(det({ x_posts_fetched: 20, x_users_fetched: 'x' })).cost, 0.1));
  const ug = { input: 40000, output: 4000, reasoning: 0 };
  check('標籤：總額含工具費並註明', M.usageLabel(ug, 0.06, 'x_search', { cost: 0.25, note: '44 則貼文、3 個帳號檔案' }) === 'tokens 輸入 40,000／輸出 4,000　·　約 US$0.310（含 x_search 工具費 US$0.250：44 則貼文、3 個帳號檔案）');
  check('標籤：tokens 費率未知仍列工具費', M.usageLabel(ug, null, 'x_search', { cost: 0.25, note: '44 則貼文' }) === 'tokens 輸入 40,000／輸出 4,000　·　tokens 費率未知；x_search 工具費 US$0.250：44 則貼文');
  check('標籤：無工具費資料 → 維持「不含 x_search 工具費」', M.usageLabel(ug, 0.06, 'x_search', null).endsWith('約 US$0.060（不含 x_search 工具費）'));
  const tl = {};
  M.addUsageRecord(tl, '2026-11', 'grok-4.3', ug, 0.06, 0.25);
  M.addUsageRecord(tl, '2026-11', 'grok-4.3', ug, 0.06, 0);
  M.addUsageRecord(tl, '2026-11', 'gpt-6.1-sol', { input: 10000, output: 5000 }, 0.07);
  mr = M.usageMonthRows(tl, '2026-11');
  check('統計：工具費併入合計、另記 tool 欄', near(mr.rows[0].cost, 0.37) && near(mr.rows[0].tool, 0.25) && mr.rows[0].model === 'grok-4.3');
  check('統計：無工具費的模型 tool＝0', mr.rows[1].tool === 0 && near(mr.rows[1].cost, 0.07));
  check('統計：月合計含工具費', near(mr.total.cost, 0.44) && near(mr.total.tool, 0.25));
  check('舊紀錄（無 tool 欄）讀入後 tool＝0、合計不變', M.sanitizeUsageLog({ '2026-11': { m: { calls: 1, input: 1, output: 1, cost: 0.5, unpriced: 0 } } })['2026-11'].m.tool === 0 && near(M.usageMonthRows({ '2026-11': { m: { calls: 1, input: 1, output: 1, cost: 0.5, unpriced: 0 } } }, '2026-11').total.tool, 0));

  console.log('H. web search 工具費（OpenAI／Claude，每次搜尋 US$0.01）');
  fee = M.webSearchFee(3);
  check('3 次搜尋 → 0.03', near(fee.cost, 0.03) && fee.note === '3 次搜尋');
  check('1,500 次 → 15、千分位', near(M.webSearchFee(1500).cost, 15) && M.webSearchFee(1500).note === '1,500 次搜尋');
  check('0 次／未知／壞值 → null', M.webSearchFee(0) === null && M.webSearchFee(undefined) === null && M.webSearchFee(null) === null && M.webSearchFee('3') === null && M.webSearchFee(-1) === null);
  check('標籤：含 web search 工具費', M.usageLabel({ input: 12000, output: 3000, reasoning: 0 }, 0.054, 'web search', M.webSearchFee(3)) === 'tokens 輸入 12,000／輸出 3,000　·　約 US$0.084（含 web search 工具費 US$0.030：3 次搜尋）');

  console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
