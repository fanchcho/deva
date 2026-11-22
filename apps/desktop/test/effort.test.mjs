/** 思考等级：规则匹配、收敛、请求参数格式、服务地址判定。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  THINK_LEVELS,
  clampEffort,
  effortRequest,
  isEffortLevel,
  isToggleEffort,
  supportedEffortLevels
} from '../src/shared/effort.ts'

test('isEffortLevel 只认六个值', () => {
  for (const v of ['default', ...THINK_LEVELS]) assert.equal(isEffortLevel(v), true)
  for (const v of ['', 'LOW', 'none', null, 1]) assert.equal(isEffortLevel(v), false)
})

test('Claude 新模型支持完整五档；旧 Claude 不支持调档', () => {
  assert.deepEqual(supportedEffortLevels('anthropic', 'claude-opus-4-6'), ['low', 'medium', 'high', 'max'])
  assert.deepEqual(supportedEffortLevels('anthropic', 'claude-sonnet-4-5'), [])
  assert.deepEqual(supportedEffortLevels('anthropic', 'anthropic/claude-sonnet-5-5'), THINK_LEVELS)
})

test('DeepSeek：flash 支持 low/high/max，且要求回放带 reasoning_content', () => {
  assert.deepEqual(supportedEffortLevels('openai', 'deepseek-v4.1-flash'), ['low', 'high', 'max'])
  const req = effortRequest('openai', 'deepseek-v4.1-flash', undefined, 'high')
  assert.deepEqual(req, { format: 'deepseek', effort: 'high', reasoningField: true })
})

test('只能开不能调的模型：唯一一档以 high 表示，不发档位值', () => {
  assert.deepEqual(supportedEffortLevels('openai', 'deepseek-chat'), ['high'])
  assert.equal(isToggleEffort('openai', 'deepseek-chat'), true)
  assert.equal(isToggleEffort('openai', 'deepseek-v4.1-flash'), false)
  assert.deepEqual(effortRequest('openai', 'deepseek-chat', undefined, 'high'), {
    format: 'deepseek',
    reasoningField: true
  })
})

test('表外模型回落到低/中/高', () => {
  assert.deepEqual(supportedEffortLevels('openai', 'some-custom-model'), ['low', 'medium', 'high'])
})

test('clampEffort：支持则原样；不支持往低找最近，低处没有再往高；不支持思考 → default', () => {
  assert.equal(clampEffort('openai', 'deepseek-v4.1-flash', 'max'), 'max')
  assert.equal(clampEffort('openai', 'deepseek-v4.1-flash', 'medium'), 'low')
  // xhigh 不受支持：低处没有更近的档（low 更远也优先于高端），实际落到 high
  assert.equal(clampEffort('openai', 'deepseek-v4.1-flash', 'xhigh'), 'high')
  assert.equal(clampEffort('anthropic', 'claude-sonnet-4-5', 'high'), 'default')
  assert.equal(clampEffort('anthropic', 'claude-sonnet-4-5', 'default'), 'default')
})

test('effortRequest：default 与不支持的档不发参数', () => {
  assert.equal(effortRequest('openai', 'deepseek-v4.1-flash', undefined, 'default'), undefined)
  assert.equal(effortRequest('openai', 'deepseek-v4.1-flash', undefined, 'medium'), undefined)
  assert.equal(effortRequest('anthropic', 'claude-sonnet-4-5', undefined, 'high'), undefined)
})

test('Responses 协议一律 standard，toggle 模型发 reasoning.effort=high', () => {
  assert.deepEqual(effortRequest('responses', 'deepseek-chat', undefined, 'high'), {
    format: 'standard',
    effort: 'high'
  })
  assert.deepEqual(supportedEffortLevels('responses', 'deepseek-chat'), ['high'])
})

test('国产模型走 Anthropic 兼容端点用 compat；Claude 原生用 standard', () => {
  assert.deepEqual(effortRequest('anthropic', 'kimi-k3', undefined, 'high'), {
    format: 'compat',
    effort: 'high'
  })
  assert.deepEqual(effortRequest('anthropic', 'claude-opus-4-6', undefined, 'high'), {
    format: 'standard',
    effort: 'high'
  })
  // MiniMax M3 默认不思考，须 thinking.type=adaptive 打开
  assert.deepEqual(effortRequest('anthropic', 'minimax-m3', undefined, 'high'), {
    format: 'compat',
    effort: 'high',
    thinking: 'adaptive'
  })
})

test('服务地址优先决定私有格式（同一模型换了端点就用该端点的开关）', () => {
  const viaDashscope = effortRequest('openai', 'qwen-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'high')
  assert.equal(viaDashscope?.format, 'qwen')
  // qwen-plus 是 toggle：只开思考、不发档位
  assert.equal(viaDashscope?.effort, undefined)

  const deepseekHost = effortRequest('openai', 'some-model', 'https://api.deepseek.com/v1', 'low')
  assert.equal(deepseekHost?.format, 'deepseek')

  const zai = effortRequest('openai', 'some-model', 'https://open.bigmodel.cn/api/paas/v4', 'low')
  assert.equal(zai?.format, 'zai')

  // 认不出的地址落回模型家族
  const unknownHost = effortRequest('openai', 'deepseek-v4.1-flash', 'https://example.com/v1', 'high')
  assert.equal(unknownHost?.format, 'deepseek')
})

test('无效 baseURL 不抛错，按模型家族判定', () => {
  const req = effortRequest('openai', 'deepseek-v4.1-flash', 'not a url', 'high')
  assert.equal(req?.format, 'deepseek')
})

test('miniMax / doubao 只在 anthropic / responses 协议下支持（OpenAI Chat 未核实）', () => {
  // 规则带 adapters: ['anthropic','responses']，OpenAI Chat 跳过它，落到末尾「其余国产」= 不支持
  assert.deepEqual(supportedEffortLevels('openai', 'minimax-m3'), [])
  assert.deepEqual(supportedEffortLevels('anthropic', 'minimax-m3'), THINK_LEVELS)
  assert.deepEqual(supportedEffortLevels('responses', 'doubao-seed-3'), THINK_LEVELS)
})
