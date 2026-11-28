import { Component, lazy, Suspense, type ReactNode } from 'react'
const settings = () => import('./SettingsPane')
const bots = () => import('./BotsPane')
const tasks = () => import('./TasksPane')
export const DeferredSettings = lazy(() => settings().then(m => ({ default: m.Settings })))
export const DeferredBots = lazy(() => bots().then(m => ({ default: m.BotsPane })))
export const DeferredTaskForm = lazy(() => tasks().then(m => ({ default: m.TaskFormModal })))
export const DeferredTasks = lazy(() => tasks().then(m => ({ default: m.TasksPane })))
export function preloadPanels(): () => void {
  const load = (): void => { void Promise.allSettled([settings(), bots(), tasks()]) }
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(load, { timeout: 5000 })
    return () => window.cancelIdleCallback(id)
  }
  const timer = setTimeout(load, 3000)
  return () => clearTimeout(timer)
}
class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode {
    return this.state.failed ? <button onClick={() => window.location.reload()}>Reload / 重新加载</button> : this.props.children
  }
}
export function DeferredPanel({ children }: { children: ReactNode }): React.JSX.Element {
  return <PanelBoundary><Suspense fallback={<div role="status">Loading… / 加载中…</div>}>{children}</Suspense></PanelBoundary>
}
