import type { ChatModelConfig } from '../../shared/chat-protocol'
import type { StoredSession } from './chat-store'
import type { ChatTurnsService, TurnOutcome } from './chat-turns-core'
import type { BackgroundTasksService } from './background-tasks-core'
import type { ChatMembersService } from './chat-members-core'
import type { ChatTaskHandoffService } from './chat-task-handoff-core'
import { notifyReplyDone } from './reply-notify'
import { getWindow, notifyTitle } from './chat-state'

/** Executor result: data only. The scheduler owns completion effects and subsequent turns. */
export interface TurnCompletion {
  kind: 'turn-completed'
  sessionId: string
  turnId: string
  session: StoredSession
  turnModel: ChatModelConfig
  outcome: TurnOutcome
  isMember: boolean
  taskAsk: boolean
  memberDelivered: Set<string> | null
  notificationPolicy: { fromRemote: boolean; unattended: boolean; shuttingDown: boolean; continues: boolean; awaitsFollowUp: boolean }
}

type CompletionPorts = Pick<BackgroundTasksService, 'wakeForNotices'> &
  Pick<ChatMembersService, 'commitMemberReports' | 'reportMemberTurn' | 'memberToMain'> &
  Pick<ChatTaskHandoffService, 'reportTaskAsk' | 'taskAsks' | 'finishInform'>

/** No event registry: typed result -> synchronous ordered effects -> public outcome. */
export function createTurnScheduler(
  execute: (...args: Parameters<ChatTurnsService['runTurn']>) => Promise<TurnCompletion>,
  release: (completion: TurnCompletion) => void,
  flushInserts: (sessionId: string, reason: TurnOutcome['stopReason']) => boolean,
  ports: CompletionPorts
): ChatTurnsService['runTurn'] {
  function advance(completion: TurnCompletion): TurnOutcome {
    const { sessionId, turnId, session, turnModel, isMember, taskAsk, memberDelivered, outcome } = completion
    const { stopReason, text, errorMessage, abortCause } = outcome
    // Busy ownership spans the executor's result handoff, closing the promise microtask gap.
    release(completion)
    const policy = completion.notificationPolicy
    if (stopReason !== 'aborted' && !policy.fromRemote && !policy.unattended && !isMember &&
      !policy.shuttingDown && !policy.continues && !policy.awaitsFollowUp) {
      notifyReplyDone(getWindow, {
        sessionId, title: notifyTitle(sessionId), text,
        error: stopReason === 'error' ? (errorMessage ?? '') : undefined
      })
    }
    const continued = flushInserts(sessionId, stopReason)
    if (!continued) ports.commitMemberReports(sessionId)
    if (stopReason !== 'aborted' && !continued) ports.wakeForNotices(sessionId)
    if (isMember && !continued) {
      if (abortCause !== 'deleted') ports.reportMemberTurn(session, stopReason, text, errorMessage, turnModel)
      else ports.memberToMain.delete(sessionId)
    } else if (isMember && memberDelivered?.size) {
      ports.reportMemberTurn(session, stopReason, text, errorMessage, turnModel, memberDelivered)
    }
    if (taskAsk && !continued) {
      if (abortCause !== 'deleted') ports.reportTaskAsk(session, stopReason, text, errorMessage)
      else ports.taskAsks.delete(sessionId)
    }
    return { ...outcome, handoff: ports.finishInform(turnId, stopReason, text) }
  }

  function runTurn(...args: Parameters<ChatTurnsService['runTurn']>): Promise<TurnOutcome> {
    // Calling execute immediately preserves synchronous reservation before the first await.
    return execute(...args).then(advance)
  }
  return runTurn
}
