/** 上下文窗口 / 输出预算 / token 输入解析。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_WINDOW_CAP,
  CONTEXT_WINDOW_RANGE,
  DEFAULT_CONTEXT_WINDOW,
  OUTPUT_BUDGET_SAFE,
  OUTPUT_BUDGET_WIDE,
  autoContextWindow,
  autoOutputBudget,
  builtinContextWindow,
  formatTokens,
  parseContextLimit,
  parseTokens,
  validLimit
} from '../src/shared/context.ts'

test('内置表：Claude 系 / GPT 系命中；表外返回 undefined', () => {
  assert.equal(builtinContextWindow('claude-opus-4-6'), 1_000_000)
  assert.equal(builtinContextWindow('claude-sonnet-4-5'), 200_000)
  assert.ok(builtinContextWindow('gpt-5.2') !== undefined)
  assert.equal(builtinContextWindow('totally-unknown-model'), undefined)
})

test('autoContextWindow：ID 自带 128k / 1m 优先，非 Claude 封顶 256K', () => {
  assert.equal(autoContextWindow('some-model-128k'), 128_000)
  assert.equal(autoContextWindow('some-model-1m'), AUTO_WINDOW_CAP)
  assert.equal(autoContextWindow('claude-sonnet-5-1m'), 1_000_000)
  assert.equal(autoContextWindow('some-model-16k'), 16_000)
})

test('autoContextWindow：表外回落到 fallback（可覆盖默认值）', () => {
  assert.equal(autoContextWindow('who-knows'), DEFAULT_CONTEXT_WINDOW)
  assert.equal(autoContextWindow('who-knows', 64_000), 64_000)
})

test('autoContextWindow：越界的 -Nk / -Nm 视作无效，继续走内置表', () => {
  // 3k 低于下限 4k；20m 高于上限 10m → 都按无效处理，落回 fallback（无内置命中时）
  assert.equal(autoContextWindow('strange-3k'), DEFAULT_CONTEXT_WINDOW)
  assert.equal(autoContextWindow('strange-20m'), DEFAULT_CONTEXT_WINDOW)
  // 合法范围边界：4k 与 10m（1m..10m）都按 ID 取值，非 Claude 再封顶
  assert.equal(autoContextWindow('strange-4k'), 4_000)
  assert.equal(autoContextWindow('strange-10m'), AUTO_WINDOW_CAP)
  // 内置表仍可命中时以表为准（gemini → 1M(1_048_576)，再按非 Claude 封顶 256K）
  assert.equal(autoContextWindow('gemini-pro'), AUTO_WINDOW_CAP)
})

test('autoOutputBudget：Claude 32K；OpenAI Chat 不传；其它协议 8K', () => {
  assert.equal(autoOutputBudget('anthropic', 'claude-sonnet-4-5'), OUTPUT_BUDGET_WIDE)
  assert.equal(autoOutputBudget('openai', 'gpt-5.2'), undefined)
  assert.equal(autoOutputBudget('anthropic', 'some-model'), OUTPUT_BUDGET_SAFE)
  assert.equal(autoOutputBudget('responses', 'some-model'), OUTPUT_BUDGET_SAFE)
})

test('validLimit：整数且落在范围内', () => {
  assert.equal(validLimit(1000, CONTEXT_WINDOW_RANGE), true)
  assert.equal(validLimit(999, CONTEXT_WINDOW_RANGE), false)
  assert.equal(validLimit(20_000_001, CONTEXT_WINDOW_RANGE), false)
  assert.equal(validLimit(1.5, CONTEXT_WINDOW_RANGE), false)
  assert.equal(validLimit('1000', CONTEXT_WINDOW_RANGE), false)
})

test('formatTokens：十进制优先（128000 显示 128K 而非 125K）', () => {
  assert.equal(formatTokens(1_000_000), '1M')
  assert.equal(formatTokens(1_050_000), '1.05M')
  assert.equal(formatTokens(1_048_576), '1M')
  assert.equal(formatTokens(200_000), '200K')
  assert.equal(formatTokens(128_000), '128K')
  assert.equal(formatTokens(8192), '8K')
  assert.equal(formatTokens(1500), '1.5K')
  assert.equal(formatTokens(999), '999')
})

test('parseTokens：支持空格 / 逗号 / 中文逗号 / k / m 与小数', () => {
  assert.equal(parseTokens('200000'), 200_000)
  assert.equal(parseTokens('200,000'), 200_000)
  assert.equal(parseTokens('200，000'), 200_000)
  assert.equal(parseTokens('200k'), 200_000)
  assert.equal(parseTokens('1m'), 1_000_000)
  assert.equal(parseTokens('1.5M'), 1_500_000)
  assert.equal(parseTokens(' 128 k '), 128_000)
})

test('parseTokens：无法解析返回 null', () => {
  for (const bad of ['', 'abc', '1.2.3', 'k', '12x', '-5']) assert.equal(parseTokens(bad), null)
})

test('parseContextLimit：只认上下文上限句式，不把输出上限当窗口', () => {
  assert.equal(parseContextLimit('prompt is too long: 210000 tokens > 200000'), 200_000)
  assert.equal(parseContextLimit('maximum context length is 131072 tokens'), 131_072)
  assert.equal(
    parseContextLimit("This model's maximum context length is 65536 tokens. However, you requested 70000"),
    65_536
  )
  assert.equal(parseContextLimit('model token limit: 262144'), 262_144)
  // 输出上限超限：不能当成窗口
  assert.equal(parseContextLimit('max_tokens: 32000 > 8192'), undefined)
  assert.equal(parseContextLimit('random error'), undefined)
})
