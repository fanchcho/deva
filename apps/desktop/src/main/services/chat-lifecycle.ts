import { createBackgroundTasksService } from './background-tasks-core'
import { createChatTaskHandoffService } from './chat-task-handoff-core'
import { createChatMembersService } from './chat-members-core'
import { createChatTurnsService } from './chat-turns-core'

export const { pendingNotices, cancelBackground, takeNotices, enqueueNotice, wakeForNotices } = createBackgroundTasksService(Object.freeze({
  get commitHandoffs() { return commitHandoffs },
  get commitMemberReports() { return commitMemberReports },
  get emitTurnStart() { return emitTurnStart },
  get runTurn() { return runTurn },
}))

export const { pendingHandoffs, commitHandoffs, deliverResult, finishInform, taskAsks, ownedTasks, findOwnedTask, taskItem, taskStatusBlock, askTask, stopTask, reportTaskAsk } = createChatTaskHandoffService(Object.freeze({
  get enqueueNotice() { return enqueueNotice },
  get emitTurnStart() { return emitTurnStart },
  get runTurn() { return runTurn },
  get abortTurn() { return abortTurn },
}))

export const { memberDispatches, setOpenTasks, markDispatchesDelivered, deliveredDispatchIds, memberToMain, memberGroupDone, pendingMemberReports, commitMemberReports, memberListing, resumeMemberTask, noteMemberDirectTask, markMemberSetting, mainMemberTool, memberSideTool, reportMemberTurn, handleMentions } = createChatMembersService(Object.freeze({
  get pendingNotices() { return pendingNotices },
  get enqueueNotice() { return enqueueNotice },
  get ownedTasks() { return ownedTasks },
  get findOwnedTask() { return findOwnedTask },
  get taskItem() { return taskItem },
  get taskStatusBlock() { return taskStatusBlock },
  get askTask() { return askTask },
  get stopTask() { return stopTask },
  get emitTurnStart() { return emitTurnStart },
  get insertMessage() { return insertMessage },
  get runTurn() { return runTurn },
  get abortTurn() { return abortTurn },
}))

export const { emitTurnStart, insertMessage, takeInserts, compactWithStatus, runTurn, runScheduledTurn, sendMessage, abortTurn } = createChatTurnsService(Object.freeze({
  get pendingNotices() { return pendingNotices },
  get takeNotices() { return takeNotices },
  get wakeForNotices() { return wakeForNotices },
  get enqueueNotice() { return enqueueNotice },
  get pendingHandoffs() { return pendingHandoffs },
  get deliverResult() { return deliverResult },
  get finishInform() { return finishInform },
  get taskAsks() { return taskAsks },
  get reportTaskAsk() { return reportTaskAsk },
  get memberDispatches() { return memberDispatches },
  get markDispatchesDelivered() { return markDispatchesDelivered },
  get deliveredDispatchIds() { return deliveredDispatchIds },
  get memberToMain() { return memberToMain },
  get pendingMemberReports() { return pendingMemberReports },
  get commitMemberReports() { return commitMemberReports },
  get memberListing() { return memberListing },
  get resumeMemberTask() { return resumeMemberTask },
  get noteMemberDirectTask() { return noteMemberDirectTask },
  get mainMemberTool() { return mainMemberTool },
  get memberSideTool() { return memberSideTool },
  get reportMemberTurn() { return reportMemberTurn },
  get handleMentions() { return handleMentions },
}))
