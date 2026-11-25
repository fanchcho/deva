import { useState } from 'react'

/** 输入中的草稿不是已保存状态；失焦提交，失败则回到上一次确认的值。 */
export function useMcpTextDraft(saved: string, onSave: (value: string) => Promise<boolean>): {
  value: string
  setDraft: (value: string) => void
  commit: () => void
} {
  const [draft, setDraft] = useState<{ value: string } | null>(null)
  return {
    value: draft?.value ?? saved,
    setDraft: (value) => setDraft({ value }),
    commit: () => {
      if (!draft) return
      const done = draft.value === saved ? Promise.resolve(true) : onSave(draft.value)
      void done.finally(() => setDraft((current) => current === draft ? null : current))
    }
  }
}
