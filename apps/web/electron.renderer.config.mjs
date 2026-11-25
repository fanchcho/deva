// 复用桌面 renderer 配置；Docker 不编译 Electron main/preload 和手机端。
import config from '../desktop/electron.vite.config.ts'
export default { renderer: config.renderer }
