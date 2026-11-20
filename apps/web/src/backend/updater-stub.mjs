/** electron-updater 在 Web 模式下不可用：保留接口，调用即失败。 */
const unavailable = () => {
  throw new Error('auto update is not available in web mode')
}

export const autoUpdater = {
  on: () => autoUpdater,
  once: () => autoUpdater,
  removeListener: () => autoUpdater,
  checkForUpdates: unavailable,
  downloadUpdate: unavailable,
  quitAndInstall: unavailable,
  setFeedURL: () => undefined,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  currentVersion: { version: process.env.DEVA_VERSION || '0.0.0' }
}

export default { autoUpdater }
