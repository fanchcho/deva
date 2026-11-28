import { emit, genId, notifyPending, pendingMount, timedWait } from './chat-state'

/**
 * 请求用户挂载工作区（mount_workspace）或为成员选文件夹（create_member 的 pick_folder）、暂停循环等其处置。
 * 返回已选目录的绝对路径，或 null（暂不挂载/取消/中止）。路径**只可能**来自用户的选择（系统目录对话框，或
 * 卡片里列出的、用户自己挂过的文件夹）：这里既不接受模型给的目录、也不替用户预选，故它不是一条能被模型诱导的
 * 提权通道。question = 卡片上的问句（模型给的，可空）。
 */
export function requestMount(
  turnId: string,
  sessionId: string,
  question: string,
  member?: string
): Promise<string | null> {
  const key = genId('mount')
  emit(turnId, sessionId, {
    type: 'mount_request',
    key,
    ...(question ? { question } : {}),
    ...(member ? { member } : {})
  })
  notifyPending(turnId, sessionId, { kind: 'mount' })
  return timedWait(turnId, new Promise((resolve) => pendingMount.set(key, { resolve, turnId, sessionId })))
}

