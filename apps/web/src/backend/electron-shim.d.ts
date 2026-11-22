/**
 * Web 后端 electron 兼容层的类型增补。
 *
 * build.mjs 用 esbuild alias 把 `electron` 指向 `electron-shim.mjs`，但 tsc 看不到
 * 这个 alias，只会读到 node_modules/electron 的类型。shim 在兼容 Electron 常规 API
 * 之外还多导出了几个 Web 运行时专有成员（事件出口与 IPC 反查），这里把它们补进
 * `electron` 模块声明，使 `src/backend/index.ts` 能被真实静态检查而不是报 TS2305。
 *
 * 声明必须与 electron-shim.mjs 的实现保持一致：
 *   - setEventSink(fn)      → __events.sink = fn
 *   - __invoke(channel, args) → 调用 ipcMain.handle 注册的处理函数
 *   - __send(channel, args)   → 触发 ipcMain.on 注册的监听
 *   - __listChannels()        → 已注册通道名（排序后）
 */
declare module 'electron' {
  /** 注入事件出口：shim 内所有 webContents.send 都转给它（Web 层用于 SSE 广播）。 */
  export function setEventSink(fn: (channel: string, payload: unknown) => void): void

  /** 按通道名调用已注册的 handle 处理器；未注册时抛出 code='NOT_PORTED' 的错误。 */
  export function __invoke(channel: string, args: unknown[]): Promise<unknown>

  /** 触发已注册的 on 监听（单向消息）；没有监听者时静默返回。 */
  export function __send(channel: string, args: unknown[]): void

  /** 列出已注册的通道名（排序后）。 */
  export function __listChannels(): string[]

  /** 事件出口的持有对象，便于运行期检查是否已注入。 */
  export const __events: { sink: ((channel: string, payload: unknown) => void) | null }
}
