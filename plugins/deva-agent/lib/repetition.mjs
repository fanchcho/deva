/**
 * 复读检测：一段模型输出里是否有「同一段内容原样连续重复」的区域。模型退化时会原地打转——反复吐
 * `<|end|>` 之类的模板标记、同一句话或同一段落，具体是什么无从预料，共同点是逐字重复，故这里只看
 * 结构、不看内容。只认逐字符完全相同的周期：带递增序号的列表、每行内容不同的表格都不算，免得误伤
 * 正常输出（Cursor 的复读检测曾把整屏 PASS 的测试状态表误判为打转）。
 *
 * 与桌面端 apps/desktop/src/main/services/repetition.ts 同一套判定阈值与扫描方式；
 * 插件里只有一处用途：lib/loop.mjs 在流式接收正文与思考时实时检查结尾，命中就掐断本步。
 * 插件没有 stream_reset 事件，所以「界面上先丢掉本步已画出的尾部」这一步做不到，只能丢弃/截断后
 * 用最终 content 覆盖预览（见 docs/CONTRACTS.md）。
 */

/**
 * 判为复读的两档门槛（字符数；中文一字一字符，故不能按英文的长度设），满足其一即可：
 *  - 同一段话重复至少 4 遍、连续 250 字符以上（一段几十字的中文段落复读 4 遍即命中）；
 *  - 同一短单元重复至少 10 遍、连续 200 字符以上（同一行、同一个标记反复出现）。
 * 桌面端 2026-11 用约 2.1 万段真实模型输出校准：零命中；带序号的列表、逐行不同的状态表、
 * 64 个 00 的十六进制片段也不命中。
 */
const RULES = [
  { minSpan: 250, minCount: 4 },
  { minSpan: 200, minCount: 10 },
]

/** 认得出的最长重复单元（字符）：段落级复读也在此之内。 */
const MAX_PERIOD = 1000

/** 周期为 period 的重复区域至少多长才算复读（各档门槛取最宽松的那档）。 */
function minSpanFor(period) {
  return Math.min(...RULES.map(rule => Math.max(rule.minSpan, rule.minCount * period)))
}

/**
 * 文本**结尾**是否正在复读：只看收尾于结尾的那段重复区域，周期从小到大试，第一个够格的即返回
 * （区域取满，供调用方截掉）。逐周期从结尾往回比，对不上立刻换下一个周期，正常文本每次只做约
 * MAX_PERIOD 次比较；够格即停，复读中的文本也只比到门槛长度。
 */
export function trailingRepetition(text) {
  const source = String(text ?? '')
  const n = source.length
  const maxPeriod = Math.min(MAX_PERIOD, Math.floor(n / 2))
  for (let p = 1; p <= maxPeriod; p++) {
    const need = minSpanFor(p) - p // 够格所需的 run（span = run + p）
    if (need > n - p) continue
    let run = 0
    while (run < need && source.charCodeAt(n - 1 - run) === source.charCodeAt(n - 1 - run - p)) run++
    if (run < need) continue
    while (run < n - p && source.charCodeAt(n - 1 - run) === source.charCodeAt(n - 1 - run - p)) run++
    return { start: n - run - p, period: p, span: run + p }
  }
  return null
}

/** 流式检测的节流：文本每长出这么多字符才查一次结尾（复读一旦开始就停在结尾，晚几十字发现无妨）。 */
const WATCH_STEP = 32
/**
 * 看守只留结尾这么多字符：够格的区域最长 minSpanFor(MAX_PERIOD) = 4000，结尾整段都在复读时
 * 留够它就能判出。不拿全文查：流式拼出的长串每次读字符都要整串展平，几十万字的输出累计要好几秒。
 */
const WATCH_TAIL = 4096

/**
 * 流式输出的复读看守：逐段传入增量，结尾正在复读时返回命中，否则返回 null。
 * 一个看守只看一路文本（正文与思考各建一个），每步重建。
 */
export function watchRepetition() {
  let tail = ''
  let pending = 0
  return delta => {
    const text = String(delta ?? '')
    tail += text
    pending += text.length
    if (tail.length > WATCH_TAIL * 2) tail = tail.slice(-WATCH_TAIL)
    if (pending < WATCH_STEP) return null
    pending = 0
    return trailingRepetition(tail)
  }
}

/** 截到复读区域的第一份：从 start 起只保留一个 period。没有复读时原样返回。 */
export function cutTrailingRepetition(text) {
  const source = String(text ?? '')
  const hit = trailingRepetition(source)
  return hit ? source.slice(0, hit.start + hit.period) : source
}
