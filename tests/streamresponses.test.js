// streamResponses 測試：reasoning summary 保活（v1.36.0）＋ 400 降級重試 ＋ 截斷回報
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error('extract failed: ' + startMarker);
  return html.slice(i, j);
}
const src =
  extract('async function readSSE', 'async function streamResponses') +
  extract('async function streamResponses', '\nfunction citeBlock') +
  extract('\nfunction citeBlock', '// ── xAI（Grok）');

// ── fetch stub：可編程回應序列 ──
let calls = [];      // 每次 fetch 收到的 body（已 parse）
let responses = [];  // 依序回傳的回應
function sseBody(events) {
  const enc = new TextEncoder();
  const payload = events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('');
  let sent = false;
  return {
    getReader: () => ({
      read: async () => sent ? { done: true } : (sent = true, { done: false, value: enc.encode(payload) }),
    }),
  };
}
function okStream(events) { return { ok: true, status: 200, body: sseBody(events) }; }
function err(status, message) { return { ok: false, status, json: async () => ({ error: { message } }) }; }

global.fetch = async (url, opts) => {
  calls.push(JSON.parse(opts.body));
  if (!responses.length) throw new Error('no scripted response left');
  return responses.shift();
};

eval(src);   // 定義 readSSE / streamResponses / citeBlock

const NORMAL_EVENTS = [
  { type: 'response.created' },
  { type: 'response.reasoning_summary_text.delta', delta: '評估技術面' },
  { type: 'response.reasoning_summary_text.delta', delta: '與籌碼面' },
  { type: 'response.output_text.delta', delta: '## 報告' },
  { type: 'response.output_text.delta', delta: '內容' },
  { type: 'response.completed' },
];

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }

(async () => {
  // ── A. 正常流程：帶 effort → body 有 {effort, summary}，onThink 收到思考摘要 ──
  console.log('A. 正常流程（effort=medium）');
  calls = []; responses = [okStream(NORMAL_EVENTS)];
  let thinks = [];
  let r = await streamResponses('k', 'gpt-5.4', 'p', 'medium', () => {}, false, null, d => thinks.push(d));
  check('body.reasoning = {effort, summary:auto}', calls[0].reasoning.effort === 'medium' && calls[0].reasoning.summary === 'auto');
  check('onThink 收到 2 段思考摘要', thinks.join('') === '評估技術面與籌碼面');
  check('正文組裝正確', r.text === '## 報告內容');
  check('未截斷', r.truncated === null);

  // ── B. 組織未驗證（400 verified）→ 只拿掉 summary、保留 effort，原路重試成功 ──
  console.log('B. 組織未驗證 → 拿掉 summary 重試');
  calls = []; responses = [err(400, 'Your organization must be verified to generate reasoning summaries.'), okStream(NORMAL_EVENTS)];
  r = await streamResponses('k', 'gpt-5.4', 'p', 'high', () => {}, false, null, null);
  check('重試了一次（共 2 次請求）', calls.length === 2);
  check('第 2 次仍保留 effort', calls[1].reasoning && calls[1].reasoning.effort === 'high');
  check('第 2 次已無 summary', calls[1].reasoning.summary === undefined);
  check('重試後成功取得正文', r.text === '## 報告內容');

  // ── B2. 未驗證且 effort 未指定 → reasoning 整個拿掉 ──
  console.log('B2. 未驗證＋effort 未指定');
  calls = []; responses = [err(400, 'must be verified to stream summaries'), okStream(NORMAL_EVENTS)];
  r = await streamResponses('k', 'gpt-5.4', 'p', '', () => {}, false, null, null);
  check('第 2 次 body 無 reasoning', calls[1].reasoning === undefined);
  check('成功', r.text === '## 報告內容');

  // ── C. 模型不支援 reasoning 參數 → 整個拿掉重試 ──
  console.log('C. 模型不支援 reasoning');
  calls = []; responses = [err(400, "Unsupported parameter: 'reasoning' is not supported with this model."), okStream(NORMAL_EVENTS)];
  r = await streamResponses('k', 'gpt-4o', 'p', 'medium', () => {}, false, null, null);
  check('第 2 次 body 無 reasoning', calls[1].reasoning === undefined);
  check('成功', r.text === '## 報告內容');

  // ── D. 其他 400（如模型名錯誤）→ 照舊拋出 status 400（讓 runAI 退 chat/completions）──
  console.log('D. 其他 400 照舊拋錯');
  calls = []; responses = [err(400, 'The requested model does not exist.')];
  try { await streamResponses('k', 'bad-model', 'p', 'medium', () => {}, false, null, null); check('應拋錯', false); }
  catch (e) { check('拋出 status=400 與原訊息', e.status === 400 && /does not exist/.test(e.message)); }
  check('未重試（僅 1 次請求）', calls.length === 1);

  // ── E. 非 400 錯誤照舊 ──
  console.log('E. 500 錯誤照舊拋出');
  calls = []; responses = [err(500, 'server error')];
  try { await streamResponses('k', 'gpt-5.4', 'p', 'medium', () => {}, false, null, null); check('應拋錯', false); }
  catch (e) { check('status=500', e.status === 500); }

  // ── F. 截斷（response.incomplete）仍正確回報 ──
  console.log('F. incomplete 截斷回報');
  calls = []; responses = [okStream([
    { type: 'response.output_text.delta', delta: '部分' },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
  ])];
  r = await streamResponses('k', 'gpt-5.4', 'p', 'medium', () => {}, false, null, null);
  check('truncated=max_output_tokens', r.truncated === 'max_output_tokens');

  console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
