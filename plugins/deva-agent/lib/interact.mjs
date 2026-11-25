/**
 * ask_user 与 todo_write：需要宿主上下文的两个工具。
 *
 * ask_user 走 run.interactions.clarify：把问题真正交回 Studio 用户界面并等待；
 * 用户关闭/超时不会变成「默认同意」，工具结果里如实写明 dismissed/timeout，模型自己决定。
 * todo_write 整份覆盖 state.agentSession 里的清单，下一轮读出来放进系统提示词。
 */

const MAX_TODOS = 50
const STATUSES = new Set(['pending', 'in_progress', 'completed'])

export const ASK_TOOL = {
  name: 'ask_user',
  description: '向用户提一个必须由人回答的问题：缺关键参数、需要在方案间选择、或有风险的操作要确认时使用。questions 按顺序依次询问；每项可带 choices 让用户点选。用户关闭或超时会返回 dismissed/timeout，此时不要假装得到了回答。',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '要依次询问的问题，至少 1 个，最多 5 个',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '问题文本，说清楚为什么需要这个信息' },
            choices: {
              type: 'array',
              description: '可选的候选答案（最多 6 个）；不给则让用户自由输入',
              maxItems: 6,
              items: { type: 'string', description: '一个候选答案' },
            },
          },
          required: ['question'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
}

export const TODO_TOOL = {
  name: 'todo_write',
  description: '整份覆盖当前会话的待办清单（不是增量追加）。多步任务先列出全部步骤，之后每次更新状态都重新提交完整清单；同一时间最多一个 in_progress。清单会出现在下一轮的提示词里。传空数组表示清空。',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '完整的待办清单，顺序即执行顺序',
        maxItems: MAX_TODOS,
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '这一步要做什么，一句话' },
            status: { type: 'string', description: '状态', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
}

/** 校验并规整待办清单：未知状态、空内容直接报错，不静默吞掉。 */
export function normalizeTodos(input) {
  if (!Array.isArray(input)) throw new Error('todos 必须是数组')
  if (input.length > MAX_TODOS) throw new Error(`待办最多 ${MAX_TODOS} 条（收到 ${input.length}）`)
  const todos = input.map((item, index) => {
    const content = String(item?.content ?? '').trim()
    if (!content) throw new Error(`第 ${index + 1} 条待办缺少 content`)
    const status = String(item?.status ?? '')
    if (!STATUSES.has(status)) throw new Error(`第 ${index + 1} 条待办状态无效：${status || '（空）'}`)
    return { ...item, content, status }
  })
  const active = todos.filter(todo => todo.status === 'in_progress').length
  if (active > 1) throw new Error(`同一时间最多一个 in_progress（收到 ${active} 个）`)
  return todos
}

/** 清单 → 提示词片段；空清单返回空字符串。 */
export function formatTodos(todos) {
  if (!Array.isArray(todos) || !todos.length) return ''
  const marks = { pending: '[ ]', in_progress: '[~]', completed: '[x]' }
  return todos.map(todo => `- ${marks[todo.status] || '[ ]'} ${todo.content}`).join('\n')
}

const DISMISSED = {
  dismissed: '用户关闭了提问，没有回答。',
  cancelled: '提问被取消，没有回答。',
  timeout: '用户没有在时限内回答。',
}

/**
 * 依次询问；遇到关闭/超时立即停下，把已问到的答案与中断原因一起返回。
 * ctx = { interactions, signal }
 */
export async function executeAskUser(input, ctx = {}) {
  const interactions = ctx?.interactions
  if (!interactions?.clarify) throw new Error('当前运行环境不支持向用户提问（没有 interactions.clarify）')
  const questions = Array.isArray(input?.questions) ? input.questions : []
  if (!questions.length) throw new Error('questions 不能为空')
  if (questions.length > 5) throw new Error('一次最多问 5 个问题')
  const answers = []
  for (const [index, item] of questions.entries()) {
    const question = String(item?.question ?? '').trim()
    if (!question) throw new Error(`第 ${index + 1} 个问题缺少文本`)
    const choices = Array.isArray(item?.choices)
      ? item.choices.map(choice => String(choice)).filter(Boolean).slice(0, 6)
      : undefined
    if (ctx.signal?.aborted) throw new Error('本轮已被取消')
    const result = await interactions.clarify({ question, ...(choices?.length ? { choices } : {}) })
    if (result?.outcome === 'answered') {
      answers.push(`Q${index + 1}: ${question}\nA${index + 1}: ${result.text}`)
      continue
    }
    const reason = DISMISSED[result?.outcome] || `提问未完成（${result?.outcome || '未知结果'}）。`
    return [...answers, `Q${index + 1}: ${question}\nA${index + 1}: （未回答）${reason}`].join('\n\n')
  }
  return answers.join('\n\n')
}
