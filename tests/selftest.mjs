#!/usr/bin/env node
/**
 * dsh-web-sub self-test — no network, no credentials.
 *
 *   node tests/selftest.mjs
 *
 * Covers:
 *   1. the PoW solver against a real DeepSeek challenge/answer pair,
 *   2. prompt flattening for both providers,
 *   3. the bridge's /health, /v1/models and unbound-provider error path,
 *   4. the on-disk account store round-trip,
 *   5. Gemini model resolution and the model-selection header shape.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LIB = join(ROOT, 'lib')
const WASM = join(ROOT, 'assets', 'sha3_wasm_bg.wasm')
const load = (p) => import(pathToFileURL(join(LIB, p)).href)

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// ---------- 1. PoW ----------
const { getSolver } = await load('pow.js')
const solver = getSolver(WASM)
const header = solver.makeHeader({
  algorithm: 'DeepSeekHashV1',
  challenge: 'cc5f4b1580e64350147977b073834ae8c28e695cb5a6d563f7da2deb0a7fc067',
  salt: '3eeb544efdf116c66fa2',
  difficulty: 144000,
  expire_at: 1778173072575,
  signature: '52537ee1b0eaf451fdec223636267a2b7c5299f81976adf9e553e08d05a74509',
  target_path: '/api/v0/chat/completion',
})
const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
console.log('1. PoW solver')
check('answer matches the reference vector (105336)', decoded.answer === 105336, `got ${decoded.answer}`)
check('payload keeps every field the API expects',
  ['algorithm', 'challenge', 'salt', 'answer', 'signature', 'target_path'].every((key) => key in decoded))

// ---------- 2. prompt flattening ----------
const { promptFromMessages: deepseekPrompt, formatToolsSection: deepseekFormatTools } = await load('providers/deepseek.js')
const { promptFromMessages: geminiPrompt, formatToolsSection: geminiFormatTools } = await load('providers/gemini.js')
console.log('\n2. prompt flattening')
check('a single user message stays bare', deepseekPrompt([{ role: 'user', content: 'oi' }]) === 'oi')
check('system instructions are labelled',
  deepseekPrompt([
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
  ]).includes('[SYSTEM INSTRUCTIONS]\nbe brief'))
check('gemini flattener agrees with deepseek',
  geminiPrompt([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])
  === deepseekPrompt([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]))
check('empty messages are dropped',
  deepseekPrompt([{ role: 'user', content: '   ' }, { role: 'user', content: 'x' }]) === 'x')

const sampleTools = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a bash command',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
]
const promptWithTools = deepseekPrompt([{ role: 'user', content: 'list files' }], sampleTools)
check('prompt with tools includes available tools section',
  promptWithTools.includes('# AVAILABLE TOOLS') && promptWithTools.includes('- bash: Execute a bash command'))
check('prompt with tools includes tool invocation instructions',
  promptWithTools.includes('<tool_call>') && promptWithTools.includes('{"name": "tool_name"'))

const promptWithAssistantCalls = deepseekPrompt([
  {
    role: 'assistant',
    content: 'Running dir',
    tool_calls: [{ function: { name: 'bash', arguments: '{"command":"dir"}' } }],
  },
  {
    role: 'tool',
    name: 'bash',
    content: 'file1.txt\nfile2.txt',
  },
])
check('assistant tool_calls are formatted as <tool_call>',
  promptWithAssistantCalls.includes('<tool_call>\n{"name": "bash", "arguments": {"command":"dir"}}\n</tool_call>'))
check('tool results are labelled with tool name',
  promptWithAssistantCalls.includes('[TOOL RESULT (bash)]\nfile1.txt\nfile2.txt'))

// ---------- 3. bridge ----------
const { startBridge, MODEL_CATALOGUE, catalogueFor, extendedThinkingFor, resolveModel: resolveRoute } = await load('server.js')
console.log('\n3. local bridge')
const bridge = await startBridge({
  preferredPort: 19431,
  getAccount: () => null,
  wasmPath: WASM,
  log: () => {},
})
try {
  const health = await (await fetch(`http://127.0.0.1:${bridge.port}/health`)).json()
  check('health reports both providers unbound',
    health.ok === true && health.providers['deepseek-web'] === false && health.providers['gemini-web'] === false)

  const models = await (await fetch(`http://127.0.0.1:${bridge.port}/v1/models`)).json()
  check('models endpoint lists the whole catalogue',
    models.object === 'list' && models.data.length === MODEL_CATALOGUE.length,
    `got ${models.data?.length}`)
  check('every advertised model has an owner',
    models.data.every((model) => typeof model.owned_by === 'string' && model.owned_by !== ''))

  // A streaming client reads SSE until `finish_reason`; answering JSON here used
  // to hide the real error as "Stream ended without finish_reason".
  const sse = await (await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-web-chat', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  })).text()
  const frames = sse.split('\n\n').filter((block) => block.startsWith('data: '))
    .map((block) => block.slice(6)).filter((raw) => raw !== '[DONE]').map((raw) => JSON.parse(raw))
  const text = frames.map((frame) => frame.choices?.[0]?.delta?.content ?? '').join('')
  check('an unbound provider streams an actionable error',
    /not connected/i.test(text), text)
  check('the error stream still closes with finish_reason',
    frames.at(-1)?.choices?.[0]?.finish_reason === 'stop')

  const buffered = await (await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-web-chat', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
  })).json()
  check('a buffered request still gets a JSON error envelope',
    typeof buffered.error?.message === 'string' && /not connected/i.test(buffered.error.message),
    buffered.error?.message)
} finally {
  await bridge.close()
}

// ---------- 3b. thinking levels ----------
console.log('\n3b. thinking levels')
check('high effort turns extended thinking on', extendedThinkingFor({ reasoning_effort: 'high' }) === true)
check('low effort leaves standard thinking', extendedThinkingFor({ reasoning_effort: 'low' }) === false)
check('the nested reasoning object is understood',
  extendedThinkingFor({ reasoning: { effort: 'high' } }) === true)
check('a bare thinking boolean is honoured', extendedThinkingFor({ thinking: false }) === false)
check('silence means "use the model default"', extendedThinkingFor({}) === undefined)
check('an empty string is not a level', extendedThinkingFor({ reasoning_effort: '  ' }) === undefined)

const discoveredRoutes = catalogueFor({
  models: [
    { modelId: '8c46e95b1a07cecc', modelName: 'gemini-flash-lite', displayName: '3.5 Flash-Lite' },
    { modelId: '95a4c0abcba24364', modelName: 'gemini-argon', displayName: '4 Argon' },
  ],
})
const geminiRoutes = discoveredRoutes.filter((model) => model.provider === 'gemini-web')
check('one picker row per discovered model, no duplicate "thinking" model',
  geminiRoutes.length === 2, geminiRoutes.map((model) => model.id).join(', '))
check('every published level is a real ladder',
  geminiRoutes.every((model) => model.reasoningEfforts?.low === 'low' && model.reasoningEfforts?.high === 'high'))
check('a retired gemini-web-think id still resolves to Gemini',
  resolveRoute('gemini-web-think', discoveredRoutes)?.provider === 'gemini-web')

// ---------- 3c. synthetic tool calling ----------
const { parseToolCallJson, parseSyntheticToolCalls } = await load('server.js')
console.log('\n3c. synthetic tool calling')
const parsedJson = parseToolCallJson('{"name": "bash", "arguments": {"command": "dir"}}')
check('parseToolCallJson parses standard json',
  parsedJson?.[0]?.name === 'bash' && parsedJson?.[0]?.arguments === '{"command":"dir"}')

const mdJson = parseToolCallJson('```json\n{"tool_call": {"name": "read_file", "args": {"path": "a.txt"}}}\n```')
check('parseToolCallJson handles markdown code blocks and wrappers',
  mdJson?.[0]?.name === 'read_file' && mdJson?.[0]?.arguments === '{"path":"a.txt"}')

const toolArray = parseToolCallJson('[{"name": "cmd1", "args": {}}, {"name": "cmd2", "args": {}}]')
check('parseToolCallJson handles json arrays',
  toolArray?.length === 2 && toolArray[0].name === 'cmd1' && toolArray[1].name === 'cmd2')

const syntheticText = 'Vou verificar os arquivos para você:\n<tool_call>\n{"name": "bash", "arguments": {"command": "ls -la"}}\n</tool_call>\nAguarde um momento.'
const extracted = parseSyntheticToolCalls(syntheticText)
check('parseSyntheticToolCalls extracts tool call cleanly',
  extracted.toolCalls.length === 1 && extracted.toolCalls[0].function.name === 'bash' && extracted.toolCalls[0].function.arguments === '{"command":"ls -la"}')
check('cleanContent strips the <tool_call> tags and leaves surrounding text',
  extracted.cleanContent.includes('Vou verificar os arquivos') && extracted.cleanContent.includes('Aguarde um momento.') && !extracted.cleanContent.includes('<tool_call>'))

const unclosedText = 'Tentando comando:\n<tool_call>\n{"name": "exec", "arguments": {"cmd": "whoami"}}'
const extractedUnclosed = parseSyntheticToolCalls(unclosedText)
check('parseSyntheticToolCalls handles unclosed tool call tags at end of text',
  extractedUnclosed.toolCalls.length === 1 && extractedUnclosed.toolCalls[0].function.name === 'exec')

const rawJsonText = 'Vou rodar o comando agora:\n{"name": "shell", "arguments": {"command": "echo hi",}}\nPronto.'
const extractedRawJson = parseSyntheticToolCalls(rawJsonText)
check('parseSyntheticToolCalls intercepts raw JSON tool call with relaxed syntax',
  extractedRawJson.toolCalls.length === 1 && extractedRawJson.toolCalls[0].function.name === 'shell' && !extractedRawJson.cleanContent.includes('shell'))

// Test sample with invalid JSON escapes / Windows paths from real user interaction
const windowsPathJson = '{"name": "shell", "arguments": {"command": "python -c \\"save(\'D:\\producao de video\\locucao.mp3\')\\""}}'
const parsedWindowsPath = parseToolCallJson(windowsPathJson)
check('parseToolCallJson sanitizes invalid backslashes in Windows paths',
  parsedWindowsPath?.[0]?.name === 'shell' && JSON.parse(parsedWindowsPath[0].arguments).command.includes('producao de video'))

// Test multiline raw string inside tool arguments
const multilineToolJson = `{"name": "shell", "arguments": {"command": "python -c \\"import asyncio
import edge_tts
print('ok')\\""}}`
const parsedMultiline = parseToolCallJson(multilineToolJson)
check('parseToolCallJson repairs unescaped newlines in argument strings',
  parsedMultiline?.[0]?.name === 'shell' && parsedMultiline[0].arguments.includes('import edge_tts'))

// Test auto-normalization of flat tool arguments into nested args container
const flatOpJson = '{"name": "alaukcut_fazer", "arguments": {"operacao": "criar_animacao_html", "nome": "teste_qc_6s", "html": "<html>hi</html>"}}'
const parsedFlatOp = parseToolCallJson(flatOpJson)
const flatOpArgs = JSON.parse(parsedFlatOp?.[0]?.arguments ?? '{}')
check('parseToolCallJson auto-normalizes flat operation arguments into nested args',
  flatOpArgs.operacao === 'criar_animacao_html' && flatOpArgs.args?.nome === 'teste_qc_6s' && flatOpArgs.args?.html === '<html>hi</html>')

// Test normalization of execute tool code argument
const executeFallbackJson = '{"name": "execute", "arguments": {"command": "console.log(42)"}}'
const parsedExecute = parseToolCallJson(executeFallbackJson)
const executeArgs = JSON.parse(parsedExecute?.[0]?.arguments ?? '{}')
check('parseToolCallJson auto-maps command to code for execute tool',
  executeArgs.code === 'console.log(42)')

// ---------- 3d. middleware engine ----------
const { MiddlewareEngine } = await load('middleware.js')
console.log('\n3d. middleware engine')
const engine = new MiddlewareEngine(tmpdir())
check('middleware initializes cleanly with no custom file', engine.initialized === false)
const reqCtx = await engine.onRequest({ model: { id: 'test' }, messages: [{ role: 'user', content: 'hi' }], tools: [] })
check('onRequest passes through transparently when no middleware registered', reqCtx.messages[0].content === 'hi')

// Check tool error hint in prompt
const { promptFromMessages: geminiPromptFn } = await load(join('providers', 'gemini.js'))
const promptWithError = geminiPromptFn([
  { role: 'user', content: 'run tool' },
  { role: 'tool', name: 'execute', content: 'Invalid arguments for tool "execute"' },
])
check('tool errors append guidance hint to prompt', promptWithError.includes('Note: The tool reported an error'))

// ---------- 4. store ----------
console.log('\n4. account store')
const temp = mkdtempSync(join(tmpdir(), 'dsh-web-sub-'))
try {
  const store = await load('store.js')
  const file = join(temp, 'accounts.json')
  store.setAccount('deepseek-web', { token: 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop', cookie: 'a=1' }, file)
  const accounts = store.readAccounts(file)
  check('account round-trips', accounts['deepseek-web']?.token?.startsWith('eyJ'))
  const masked = store.maskAccount(accounts['deepseek-web'])
  check('masking never leaks the secret', masked.tokenPreview.includes('…'))
  check('removal works', store.removeAccount('deepseek-web', file) === true && store.readAccounts(file)['deepseek-web'] === undefined)
} finally {
  rmSync(temp, { recursive: true, force: true })
}

// ---------- 5. Gemini model selection ----------
console.log('\n5. gemini model selection')
{
  const { GeminiWebClient, FALLBACK_MODELS } = await load(join('providers', 'gemini.js'))
  const client = new GeminiWebClient({ cookie: '__Secure-1PSID=fake-value-for-shape-tests' })
  client.models = [
    { modelId: 'fbb127bbb056c959', modelName: 'gemini-flash', displayName: 'Gemini Flash', description: '', capacity: 1, capacityField: 12, modelNumber: 1, aliases: ['gemini-flash', 'flash'] },
    { modelId: 'a1b2c3d4e5f60718', modelName: 'gemini-argon', displayName: 'Gemini 4 Argon', description: '', capacity: 2, capacityField: 12, modelNumber: 3, aliases: ['gemini-argon', 'argon'] },
  ]

  check('an exact id resolves', client.resolveModel('fbb127bbb056c959')?.displayName === 'Gemini Flash')
  check('a display name resolves', client.resolveModel('Gemini 4 Argon')?.modelId === 'a1b2c3d4e5f60718')
  check('a loose name resolves', client.resolveModel('argon')?.modelName === 'gemini-argon')
  check('an empty name means "let Google choose"', client.resolveModel('') === undefined)

  const headerValue = client.headerForName('Gemini 4 Argon')
  const header = JSON.parse(headerValue)
  check('the header carries the model id at slot 4', header[4] === 'a1b2c3d4e5f60718')
  check('the header carries the capacity at slot 11', header[11] === 2)
  check('the header carries the model number', header[14] === 3)
  check('the header ends with the thinking flag and the session uuid',
    header[15] === 1 && header[16] === client.sessionUuid)
  const thinking = JSON.parse(client.headerForName('gemini-flash', true))
  check('extended thinking sets the flag to 2', thinking[15] === 2)

  const shifted = client.buildModelHeader({ capacity: 4, capacityField: 13, modelNumber: 1, modelId: 'deadbeefdeadbeef' })
  check('capacityField 13 shifts the capacity one slot right', JSON.parse(shifted)[12] === 4)

  const unlisted = new GeminiWebClient({ cookie: '__Secure-1PSID=fake-value-for-shape-tests' })
  check('with no discovery the fallback list is used',
    unlisted.resolveModel('gemini-flash')?.modelId === FALLBACK_MODELS[0].modelId)
}

// ---------- 6. Co-Pilot engines: Sandbox DOM, Transactions & Visual QC ----------
console.log('\n6. Co-Pilot engines (Sandbox DOM, Transactions & Safe-Area)')
{
  const { VirtualTimeline } = await load('timeline-sandbox.js')
  const { TransactionManager } = await load('transactions.js')
  const { auditKeyframeSafeAreas } = await load('visual-qc.js')

  // VirtualTimeline simulation
  const timeline = new VirtualTimeline({ durationSeconds: 60 })
  const validBatch = [
    { operacao: 'criar_trilha', argumentos: { id: 'v1', type: 'video' } },
    { operacao: 'adicionar_clipe', argumentos: { trackId: 'v1', startTime: 0, duration: 5 } },
    { operacao: 'adicionar_clipe', argumentos: { trackId: 'v1', startTime: 5, duration: 5 } },
  ]
  const simResult = timeline.simulate(validBatch)
  check('sandbox approves valid non-overlapping batch', simResult.ok === true && simResult.errors.length === 0)

  const collisionBatch = [
    { operacao: 'criar_trilha', argumentos: { id: 'v2', type: 'video' } },
    { operacao: 'adicionar_clipe', argumentos: { trackId: 'v2', startTime: 2, duration: 6 } },
    { operacao: 'adicionar_clipe', argumentos: { trackId: 'v2', startTime: 4, duration: 4 } }, // Overlaps [2, 8]
  ]
  const collisionResult = timeline.simulate(collisionBatch)
  check('sandbox rejects track collision deterministically',
    collisionResult.ok === false && collisionResult.errors.some((e) => e.includes('collision')))

  // TransactionManager ACID rollback
  const txManager = new TransactionManager()
  let dummyState = { version: 1, clips: ['a', 'b'] }
  const tx = txManager.begin('test_mutation', dummyState)
  dummyState = { version: 2, clips: ['a', 'b', 'c_broken'] } // corrupted
  const rollbackResult = txManager.rollback(tx.id, 'Asset missing')
  check('rollback restores pre-transaction snapshot',
    rollbackResult.ok && rollbackResult.restoredState.version === 1 && rollbackResult.restoredState.clips.length === 2)
  check('transaction status reflects ROLLED_BACK', rollbackResult.status === 'ROLLED_BACK')

  // Safe-Area 9:16 bounding box audit
  const safeBoxes = [
    { text: 'Centered Title', x: 200, y: 300, width: 680, height: 80 }, // Inside [100, 980] x [180, 1680]
  ]
  const safeCheck = auditKeyframeSafeAreas({ boxes: safeBoxes, resolution: { width: 1080, height: 1920 } })
  check('safe-area audit passes elements within 880px column', safeCheck.passed === true)

  const outsideBoxes = [
    { text: 'Top Cutoff Header', x: 50, y: 100, width: 300, height: 50 }, // y < 180 and x < 100
  ]
  const cutCheck = auditKeyframeSafeAreas({ boxes: outsideBoxes, resolution: { width: 1080, height: 1920 } })
  check('safe-area audit flags elements in danger zones',
    cutCheck.passed === false && cutCheck.violations.length >= 2)
}

// ---------- 7. ChatGPT / OpenAI Codex Subscription ----------
console.log('\n7. chatgpt / openai codex subscription')
{
  const { ChatGPTWebClient, CHATGPT_MODELS, decodeJwtPayload } = await load(join('providers', 'chatgpt.js'))
  check('chatgpt models are registered in catalogue', CHATGPT_MODELS.length >= 4)
  check('gpt-5.6-luna is default flagship codex model', CHATGPT_MODELS.some((m) => m.id === 'gpt-5.6-luna'))

  const client = new ChatGPTWebClient()
  const payload = client.formatPayload([
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'What is the weather?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'getWeather', arguments: '{"city":"Tokyo"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'Rainy, 18C' },
  ], [
    {
      type: 'function',
      function: {
        name: 'getWeather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ])

  check('payload input formats function_call and function_call_output',
    payload.input.some((i) => i.type === 'function_call' && i.name === 'getWeather') &&
    payload.input.some((i) => i.type === 'function_call_output' && i.call_id === 'c1'))
  check('payload tools formats parameters correctly',
    payload.tools.length === 1 && payload.tools[0].name === 'getWeather')

  // Model resolution checks
  const { resolveModel: resolveTestModel } = await load('server.js')
  check('resolveModel resolves chatgpt to gpt-5.6-luna', resolveTestModel('chatgpt')?.id === 'gpt-5.6-luna')
  check('resolveModel resolves gpt-4o to gpt-5.6-luna', resolveTestModel('gpt-4o')?.id === 'gpt-5.6-luna')
  check('resolveModel resolves o1 to gpt-6-luna', resolveTestModel('o1')?.id === 'gpt-6-luna')
  check('resolveModel resolves gpt-6-astra directly', resolveTestModel('gpt-6-astra')?.id === 'gpt-6-astra')

  // JWT decode test
  const fakePayload = { sub: 'user_123', email: 'test@example.com', exp: 1890000000 }
  const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(fakePayload)).toString('base64url')}.sig`
  const decodedPayload = decodeJwtPayload(fakeJwt)
  check('decodeJwtPayload extracts email and exp without verification',
    decodedPayload?.email === 'test@example.com' && decodedPayload?.exp === 1890000000)
}

console.log('')
if (failures === 0) {
  console.log('all checks passed')
} else {
  console.log(`${failures} check(s) failed`)
  process.exitCode = 1
}
