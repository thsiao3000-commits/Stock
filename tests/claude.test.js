// Claude（Anthropic Messages API）串流測試（v1.54.0）：請求格式、事件累積、usage、引用、附件、
// 自動後備降級重試、pause_turn 續跑、截斷／拒絕／串流錯誤、下拉選單與價格表同步
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  const j = html.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error('extract failed: ' + startMarker);
  return html.slice(i, j);
}
const src =
  extract('async function readSSE', '// ── 多模態輸入') +
  extract('\nfunction citeBlock', '/* ════════════════ Anthropic Claude') +
  extract('const isClaudeModel', '// ── xAI（Grok）');

let calls = [], responses = [];
function sseBody(events) {
  const enc = new TextEncoder();
  const payload = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  let sent = false;
  return { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: enc.encode(payload) }) }) };
}
const okStream = events => ({ ok: true, status: 200, body: sseBody(events) });
const err = (status, message) => ({ ok: false, status, json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message } }) });
global.fetch = async (url, opts) => {
  calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  if (!responses.length) throw new Error('no scripted response left');
  return responses.shift();
};
// const 宣告在 eval 內不外露 → 用 Function 包起來回傳
const { isClaudeModel, claudeContent, claudeUsage, streamClaude } = new Function(src + '\nreturn { isClaudeModel, claudeContent, claudeUsage, streamClaude };')();

const start = (usage) => ({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [], usage: usage || { input_tokens: 1200, output_tokens: 1 } } });
const bStart = (index, content_block) => ({ type: 'content_block_start', index, content_block });
const bDelta = (index, delta) => ({ type: 'content_block_delta', index, delta });
const bStop = index => ({ type: 'content_block_stop', index });
const mDelta = (stop_reason, usage, extra) => ({ type: 'message_delta', delta: { stop_reason, ...(extra || {}) }, usage });
const NORMAL = [
  start(), { type: 'ping' },
  bStart(0, { type: 'thinking', thinking: '', signature: '' }),
  bDelta(0, { type: 'thinking_delta', thinking: '評估技術面' }), bDelta(0, { type: 'thinking_delta', thinking: '與籌碼面' }),
  bDelta(0, { type: 'signature_delta', signature: 'SIG' }), bStop(0),
  bStart(1, { type: 'text', text: '' }),
  bDelta(1, { type: 'text_delta', text: '## 報告' }), bDelta(1, { type: 'text_delta', text: '內容' }), bStop(1),
  mDelta('end_turn', { output_tokens: 300 }), { type: 'message_stop' },
];

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗ FAIL:', name)); }
const reset = (...r) => { calls = []; responses = r; };

(async () => {
  console.log('A. 模型判斷與請求格式');
  check('claude- 開頭 → Claude', isClaudeModel('claude-fable-5-2') && isClaudeModel('claude-opus-5-5') && isClaudeModel('claude-sonnet-5-5'));
  check('其他模型 → 非 Claude', !isClaudeModel('gpt-6.1-sol') && !isClaudeModel('grok-4.3') && !isClaudeModel('') && !isClaudeModel(null));
  reset(okStream(NORMAL));
  const deltas = [], thinks = [];
  let r = await streamClaude('sk-ant-x', 'claude-opus-5-5', 'PROMPT', 'medium', t => deltas.push(t), false, null, d => thinks.push(d), []);
  const c = calls[0];
  check('打 api.anthropic.com/v1/messages', c.url === 'https://api.anthropic.com/v1/messages');
  check('標頭：x-api-key／anthropic-version／瀏覽器直連', c.headers['x-api-key'] === 'sk-ant-x' && c.headers['anthropic-version'] === '2026-10-21' && c.headers['anthropic-dangerous-direct-browser-access'] === 'true');
  check('不送 Authorization（那是 OpenAI 的格式）', !('Authorization' in c.headers));
  check('model／stream／max_tokens', c.body.model === 'claude-opus-5-5' && c.body.stream === true && c.body.max_tokens === 64000);
  check('thinking＝adaptive＋summarized（保活）、不送 budget_tokens', c.body.thinking.type === 'adaptive' && c.body.thinking.display === 'summarized' && !('budget_tokens' in c.body.thinking));
  check('effort 放在 output_config', c.body.output_config.effort === 'medium' && !('effort' in c.body));
  check('不送取樣參數（temperature／top_p／top_k）', !('temperature' in c.body) && !('top_p' in c.body) && !('top_k' in c.body));
  check('無附件 → content 為純字串', c.body.messages.length === 1 && c.body.messages[0].role === 'user' && c.body.messages[0].content === 'PROMPT');
  check('未開 web search → 不帶 tools、不帶 tool_choice', !('tools' in c.body) && !('tool_choice' in c.body));
  check('預設帶自動後備（fallbacks＋beta 標頭）', c.body.fallbacks === 'default' && c.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01');

  console.log('B. 串流累積與 usage');
  check('正文逐段累積', deltas.join('|') === '## 報告|## 報告內容' && r.text === '## 報告內容');
  check('思考摘要送進 onThink', thinks.join('') === '評估技術面與籌碼面');
  check('usage：input 取 message_start、output 取 message_delta', r.usage.input_tokens === 1200 && r.usage.output_tokens === 300);
  check('正常結束不算截斷', r.truncated === null);
  check('claudeUsage 併入快取 tokens', claudeUsage({ input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 }).input_tokens === 150);
  check('claudeUsage 缺欄位 → null', claudeUsage(null) === null && claudeUsage({ output_tokens: 5 }) === null);
  reset(okStream(NORMAL));
  r = await streamClaude('k', 'claude-fable-5-2', 'P', '', () => {}, false, null, null, []);
  check('effort 未指定 → 不送 output_config（用模型預設）', !('output_config' in calls[0].body));

  reset(okStream(NORMAL));
  r = await streamClaude('k', 'claude-haiku-5-5', 'P', 'low', () => {}, false, null, null, []);
  check('Haiku 5.5：不送 fallbacks 與 beta 標頭（無伺服器端後備）、其餘照舊', !('fallbacks' in calls[0].body) && !('anthropic-beta' in calls[0].headers) && calls[0].body.thinking.type === 'adaptive' && calls[0].body.output_config.effort === 'low' && r.text === '## 報告內容');

  console.log('C. web search 與引用');
  const cite = (url, title) => ({ type: 'web_search_result_location', url, title, cited_text: 'x' });
  reset(okStream([
    start(),
    bStart(0, { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} }),
    bDelta(0, { type: 'input_json_delta', partial_json: '{"query":"台積電' }), bDelta(0, { type: 'input_json_delta', partial_json: ' 法說"}' }), bStop(0),
    bStart(1, { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://a.example/1', title: 'A' }] }), bStop(1),
    bStart(2, { type: 'text', text: '' }),
    bDelta(2, { type: 'text_delta', text: '營收創高' }),
    bDelta(2, { type: 'citations_delta', citation: cite('https://a.example/1', '新聞 A') }),
    bDelta(2, { type: 'citations_delta', citation: cite('https://a.example/1', '新聞 A') }),
    bDelta(2, { type: 'citations_delta', citation: cite('https://b.example/2', '新聞 [B]') }), bStop(2),
    mDelta('end_turn', { input_tokens: 9000, output_tokens: 700, server_tool_use: { web_search_requests: 1 } }),
  ]));
  let searches = 0;
  r = await streamClaude('k', 'claude-sonnet-5-5', 'P', 'low', () => {}, true, () => searches++, null, []);
  check('tools＝web_search_20260209／name web_search', calls[0].body.tools.length === 1 && calls[0].body.tools[0].type === 'web_search_20260209' && calls[0].body.tools[0].name === 'web_search');
  check('搜尋時觸發 onSearch、回報 searched', searches === 1 && r.searched === true);
  check('引用去重後附文末', r.text.startsWith('營收創高') && r.text.includes('**📎 引用來源（web search）**') && r.text.includes('1. [新聞 A](https://a.example/1)') && r.text.includes('2. [新聞  B](https://b.example/2)') && !r.text.includes('3. ['));
  check('message_delta 的累計 usage 覆蓋 message_start', r.usage.input_tokens === 9000 && r.usage.output_tokens === 700);
  check('回報搜尋次數（server_tool_use.web_search_requests）', r.webSearches === 1);

  console.log('D. 附件（圖片／PDF）');
  const atts = [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }, { name: 'b.pdf', kind: 'pdf', dataUrl: 'data:application/pdf;base64,BBBB' }];
  const parts = claudeContent('問題', atts);
  check('圖片 → image／base64（去掉 data URL 前綴）', parts[0].type === 'image' && parts[0].source.type === 'base64' && parts[0].source.media_type === 'image/png' && parts[0].source.data === 'AAAA');
  check('PDF → document／application/pdf', parts[1].type === 'document' && parts[1].source.media_type === 'application/pdf' && parts[1].source.data === 'BBBB');
  check('文字放在附件之後', parts.length === 3 && parts[2].type === 'text' && parts[2].text === '問題');
  check('無附件 → 純字串', claudeContent('問題', []) === '問題' && claudeContent('問題') === '問題');

  console.log('E. 自動後備（beta）不可用 → 拿掉重試');
  reset(err(400, 'fallbacks: Extra inputs are not permitted'), okStream(NORMAL));
  r = await streamClaude('k', 'claude-opus-5-5', 'P', 'high', () => {}, false, null, null, []);
  check('重試一次且成功', calls.length === 2 && r.text === '## 報告內容');
  check('重試時拿掉 fallbacks 與 beta 標頭、其餘不變', !('fallbacks' in calls[1].body) && !('anthropic-beta' in calls[1].headers) && calls[1].body.output_config.effort === 'high');
  reset(err(400, 'max_tokens: too large'));
  let thrown = null;
  try { await streamClaude('k', 'claude-opus-5-5', 'P', '', () => {}, false, null, null, []); } catch (e) { thrown = e; }
  check('其他 400 不重試、照常拋錯（帶 status）', calls.length === 1 && thrown && thrown.status === 400 && /max_tokens/.test(thrown.message));
  reset(err(401, 'invalid x-api-key'));
  thrown = null;
  try { await streamClaude('bad', 'claude-opus-5-5', 'P', '', () => {}, false, null, null, []); } catch (e) { thrown = e; }
  check('401 金鑰錯誤拋出原訊息', thrown && thrown.status === 401 && thrown.message === 'invalid x-api-key');

  console.log('F. pause_turn 續跑');
  reset(
    okStream([
      start({ input_tokens: 1000, output_tokens: 1 }),
      bStart(0, { type: 'thinking', thinking: '', signature: '' }), bDelta(0, { type: 'thinking_delta', thinking: '想' }), bDelta(0, { type: 'signature_delta', signature: 'S1' }), bStop(0),
      bStart(1, { type: 'text', text: '' }), bDelta(1, { type: 'text_delta', text: '前半' }), bStop(1),
      bStart(2, { type: 'server_tool_use', id: 'srvtoolu_9', name: 'web_search', input: {} }), bDelta(2, { type: 'input_json_delta', partial_json: '{"query":"q"}' }), bStop(2),
      mDelta('pause_turn', { output_tokens: 200 }),
    ]),
    okStream([
      start({ input_tokens: 1500, output_tokens: 1 }),
      bStart(0, { type: 'text', text: '' }), bDelta(0, { type: 'text_delta', text: '後半' }), bStop(0),
      mDelta('end_turn', { output_tokens: 100 }),
    ]));
  const seen = [];
  r = await streamClaude('k', 'claude-fable-5-2', 'P', '', t => seen.push(t), true, null, null, []);
  const m2 = calls[1].body.messages;
  check('第二次請求＝原 user＋assistant（已產生內容），不另加 user', calls.length === 2 && m2.length === 2 && m2[0].role === 'user' && m2[0].content === 'P' && m2[1].role === 'assistant');
  check('thinking 區塊原封送回（含 signature）', m2[1].content[0].type === 'thinking' && m2[1].content[0].thinking === '想' && m2[1].content[0].signature === 'S1');
  check('server_tool_use 的 input 由 JSON 片段還原', m2[1].content[2].type === 'server_tool_use' && m2[1].content[2].id === 'srvtoolu_9' && m2[1].content[2].input.query === 'q');
  check('正文跨回合接續', r.text === '前半後半' && seen[seen.length - 1] === '前半後半');
  check('usage 跨回合加總', r.usage.input_tokens === 2500 && r.usage.output_tokens === 300);
  check('沒回報搜尋次數 → 0', r.webSearches === 0);
  const paused = () => okStream([start(), bStart(0, { type: 'text', text: '' }), bDelta(0, { type: 'text_delta', text: 'x' }), bStop(0), mDelta('pause_turn', { output_tokens: 1 })]);
  reset(paused(), paused(), paused(), paused(), paused(), paused(), paused());
  r = await streamClaude('k', 'claude-fable-5-2', 'P', '', () => {}, true, null, null, []);
  check('續跑有上限（1＋5 次）、超過回報截斷', calls.length === 6 && r.truncated === 'pause_turn' && r.text === 'xxxxxx');

  console.log('G. 截斷／拒絕／串流錯誤');
  reset(okStream([start(), bStart(0, { type: 'text', text: '' }), bDelta(0, { type: 'text_delta', text: '半份' }), bStop(0), mDelta('max_tokens', { output_tokens: 64000 })]));
  r = await streamClaude('k', 'claude-opus-5-5', 'P', '', () => {}, false, null, null, []);
  check('max_tokens → truncated', r.truncated === 'max_tokens' && r.text === '半份');
  reset(okStream([start(), mDelta('refusal', { output_tokens: 0 }, { stop_details: { type: 'refusal', category: 'cyber', explanation: 'blocked' } })]));
  thrown = null;
  try { await streamClaude('k', 'claude-fable-5-2', 'P', '', () => {}, false, null, null, []); } catch (e) { thrown = e; }
  check('refusal → 拋錯並帶分類與說明', thrown && /拒絕/.test(thrown.message) && /cyber/.test(thrown.message) && /blocked/.test(thrown.message));
  reset(okStream([start(), bStart(0, { type: 'text', text: '' }), bDelta(0, { type: 'text_delta', text: '寫到一半' }), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]));
  thrown = null;
  try { await streamClaude('k', 'claude-opus-5-5', 'P', '', () => {}, false, null, null, []); } catch (e) { thrown = e; }
  check('串流中的 error 事件 → 拋錯', thrown && thrown.message === 'Overloaded');

  console.log('H. 下拉選單／金鑰欄位／價格表同步');
  const sel = extract('<select id="modelSel">', '</select>');
  const ids = [...sel.matchAll(/<option value="(claude-[^"]+)"/g)].map(m => m[1]);
  check('下拉含 Fable 5.2／Opus 5.5／Sonnet 5.5／Haiku 5.5', ids.join() === 'claude-fable-5-2,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5');
  const fb = extract('const PRICING_FALLBACK', '} };');
  check('下拉的 Claude 模型都在內嵌價格後備表', ids.every(id => fb.includes(`'${id}'`)));
  check('有 Claude API Key 欄位（password）', /<input id="anthropicKey" type="password"/.test(html));
  check('金鑰存 db.settings.anthropicKey、匯出預設清掉', html.includes("db.settings.anthropicKey = e.target.value.trim()") && html.includes("settings.anthropicKey = '';"));
  check('runAI 依模型選供應商', html.includes('const claude = isClaudeModel(model);') && html.includes('if (claude) r = await streamClaude('));

  console.log(fail === 0 ? `ALL ${pass} TESTS PASSED` : `${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
