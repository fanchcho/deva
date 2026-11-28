function unsupported(code, message) {
  throw Object.assign(new Error(code + ': ' + message), { code })
}

// Native applications and the server's file manager are not the browser's desktop.
export const shell = {
  async openPath() {
    unsupported('WEB_NATIVE_OPEN_UNSUPPORTED', 'Web 无法启动服务器本机应用，请通过交付卡下载文件')
  },
  async openExternal() {
    unsupported('WEB_EXTERNAL_OPEN_UNSUPPORTED', 'Web 后端无法打开客户端标签页，请在浏览器中直接打开链接')
  },
  showItemInFolder() {
    unsupported('WEB_REVEAL_UNSUPPORTED', 'Web 无法显示服务器文件管理器，请使用交付卡的打开按钮下载文件')
  },
  async trashItem() {
    unsupported('WEB_TRASH_UNSUPPORTED', 'Web 不支持移动到服务器回收站')
  }
}
