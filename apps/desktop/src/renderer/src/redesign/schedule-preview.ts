import { useEffect, useState } from 'react'
import type { TaskSchedule } from '../../../preload'
import { useI18n } from '../i18n/i18n'

export function useSchedulePreview(schedule: TaskSchedule): string {
  const { t, locale } = useI18n()
  const [desc, setDesc] = useState('')
  const sig = `${schedule.kind}|${schedule.at ?? ''}|${schedule.cron ?? ''}|${schedule.tz}`
  useEffect(() => {
    let alive = true
    void window.deva.tasks
      .preview(schedule, locale, true)
      .then((res) => {
        if (!alive) return
        setDesc(res.ok ? res.description : t('tasks.previewInvalid'))
      })
      .catch(() => {
        if (alive) setDesc('')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, locale])
  return desc
}

