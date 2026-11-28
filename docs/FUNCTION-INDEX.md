# 函数索引（全量 2505 条 · 100% 行号覆盖）

本文件是 `docs/PROJECT-MAP.md` §3 的**机械索引**：由 TypeScript 编译器 API 解析全部源码文件得到，每条给出 `文件:行号`、名字、形态、是否导出、签名与被调用点数量。逐条的中文作用说明见六个附录 `docs/PROJECT-MAP-FUNCTIONS-*.md`（全量），以及 `docs/PROJECT-MAP.md` §3.4 的紧凑表格（精选阅读版）。

- 源码文件数：**168**
- 函数 / 方法 / IPC 处理器总数：**2505**
- 其中导出：**713**

## 按区域汇总

| 区域 | 文件数 | 条目数 |
|---|---:|---:|
| A1 Web 网关与服务端 | 7 | 103 |
| A2 Web 后端兼容层 | 6 | 164 |
| A3 Web 构建/前端壳/测试 | 3 | 23 |
| B 桌面·主进程 | 84 | 1292 |
| B2 桌面·预加载 | 2 | 15 |
| C 桌面·渲染层 | 49 | 869 |
| D 共享、脚本与配置 | 17 | 39 |
| **合计** | **168** | **2505** |

> 文件顺序与区域顺序一致，便于和 §3 的分批说明对照。

## A1 Web 网关与服务端（7 文件 / 103 条）

### `apps/web/server.mjs`（36 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 110 | userDirs | function |  | `(user)` | 1 |
| 133 | withDirs | function |  | `(user)` | 2 |
| 138 | pickRoots | function |  | `(user)` | 5 |
| 149 | extraRootsFile | function |  | `(user)` | 3 |
| 152 | userExtraRoots | function |  | `(user)` | 3 |
| 167 | rememberRoot | function |  | `(user, dir)` | 1 |
| 183 | browseHidden | function |  | `(user, real)` | 1 |
| 196 | inBrowseScope | function |  | `async (user, real)` | 5 |
| 203 | resolvePickPath | function |  | `async (user, raw)` | 2 |
| 214 | resolveCreatePath | function |  | `async (user, raw)` | 1 |
| 267 | broadcast | function |  | `(userId, channel, payload)` | 9 |
| 309 | sessionOf | function |  | `(req)` | 2 |
| 318 | setCookie | function |  | `(res, value, maxAgeSec)` | 2 |
| 330 | redirect | function |  | `(res, location)` | 5 |
| 335 | html | function |  | `(res, status, body)` | 9 |
| 345 | readConfig | function |  | `(home)` | 4 |
| 353 | bootScript | function |  | `(user, session)` | 1 |
| 361 | injectIndex | function |  | `(source)` | 1 |
| 373 | shellScript | function |  | `(username, role)` | 1 |
| 444 | serveStatic | function |  | `async (req, res, urlPath)` | 2 |
| 537 | isAbsolutePath | function |  | `(value)` | 1 |
| 542 | assertPathInside | function |  | `(roots, value)` | 3 |
| 557 | assertTerminalCwdInside | function |  | `async (user, roots, cwd)` | 1 |
| 570 | jailCheck | function |  | `async (user, channel, args)` | 1 |
| 582 | visit | arrow |  | `(value)` | 2 |
| 604 | handleWorkerPick | function |  | `async (req, res)` | 1 |
| 642 | handleFsList | function |  | `async (req, res, user, url)` | 1 |
| 669 | handlePickResolve | function |  | `async (req, res, user, session, id)` | 1 |
| 705 | safeNext | function |  | `(raw)` | 2 |
| 711 | handleLogin | function |  | `async (req, res)` | 1 |
| 737 | handleInvoke | function |  | `async (req, res, user, session)` | 1 |
| 790 | handleEvents | function |  | `(req, res, user)` | 1 |
| 817 | readForm | function |  | `async (req)` | 2 |
| 830 | handleAdminPost | function |  | `async (req, res, session, user, pathname)` | 1 |
| 836 | back | arrow |  | `(error='', notice='')` | 7 |
| 1090 | shutdown | arrow |  | `(signal)` | 2 |

### `apps/web/src/server/auth.mjs`（24 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 8 | hashPassword | function | export | `(password)` | 2 |
| 19 | verifyPassword | function | export | `(password, stored)` | 1 |
| 39 | UserStore.constructor | ctor |  | `(dataRoot)` | 0 |
| 46 | UserStore.list | method | export | `()` | 16 |
| 56 | UserStore.find | method | export | `(username)` | 153 |
| 61 | UserStore.byId | method | export | `(id)` | 5 |
| 65 | UserStore.adminCount | method | export | `()` | 1 |
| 69 | UserStore.create | method | export | `async ({ username, password, role = 'user' })` | 7 |
| 86 | UserStore.setPassword | method | export | `async (id, password)` | 1 |
| 94 | UserStore.remove | method | export | `async (id)` | 17 |
| 102 | UserStore.save | method | export | `async ()` | 13 |
| 112 | SessionStore.constructor | ctor |  | `(dataRoot, ttlMs)` | 0 |
| 125 | SessionStore.create | method | export | `(user)` | 7 |
| 140 | SessionStore.get | method | export | `(id)` | 255 |
| 151 | SessionStore.destroy | method | export | `(id)` | 7 |
| 155 | SessionStore.destroyUser | method | export | `(userId)` | 2 |
| 166 | SessionStore.sweep | method | export | `()` | 1 |
| 178 | SessionStore.save | method | export | `async ()` | 13 |
| 194 | AuditLog.constructor | ctor |  | `(dataRoot)` | 0 |
| 203 | AuditLog.migrateLegacy | method | export | `()` | 2 |
| 223 | AuditLog.append | method | export | `(userId, event)` | 9 |
| 246 | AuditLog.auth | method | export | `(event)` | 8 |
| 250 | AuditLog.read | method | export | `(userId, limit=200)` | 11 |
| 274 | csrfOk | function | export | `(session, provided)` | 2 |

### `apps/web/src/server/backend-pool.mjs`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | BackendPool.constructor | ctor |  | `({
    idleMs = 30 * 60 * 1000,
    onEvent = () => {},
    onLog = () => {},
    ctlUrl …)` | 0 |
| 30 | BackendPool.entry | method | export | `(user)` | 3 |
| 61 | BackendPool.spawn | method | export | `(user, entry)` | 7 |
| 136 | BackendPool.touch | method | export | `(entry)` | 4 |
| 144 | BackendPool.invoke | method | export | `async (user, channel, args)` | 166 |
| 172 | BackendPool.send | method | export | `async (user, channel, args)` | 50 |
| 179 | BackendPool.channels | method | export | `async (user)` | 2 |
| 185 | BackendPool.stop | method | export | `(userId, reason='manual')` | 11 |
| 212 | BackendPool.stopAll | method | export | `(reason='shutdown')` | 2 |

### `apps/web/src/server/pages.mjs`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 53 | loginPage | function | export | `({ error = '', next = '/' }={})` | 3 |
| 75 | adminPage | function | export | `({ user, users, audit = [], error = '', notice = '', csrf, update = null })` | 2 |
| 189 | errorPage | function | export | `(status, message)` | 4 |

### `apps/web/src/server/updater.mjs`（15 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 16 | shortSha | function | export | `(value)` | 2 |
| 21 | sameCommit | function |  | `(a, b)` | 2 |
| 29 | UpdateChecker.constructor | ctor |  | `({
    repo,
    ref = 'main',
    current = '',
    apiBase = DEFAULT_API,
    token = '…)` | 0 |
| 79 | UpdateChecker.snapshot | method | export | `()` | 10 |
| 83 | UpdateChecker.start | method | export | `()` | 6 |
| 85 | tick | arrow |  | `()` | 1 |
| 95 | UpdateChecker.stop | method | export | `()` | 11 |
| 101 | UpdateChecker.check | method | export | `()` | 19 |
| 110 | UpdateChecker. | method | export | `async ()` | 0 |
| 162 | UpdateChecker. | method | export | `async (latest)` | 0 |
| 190 | UpdateChecker. | method | export | `async (url)` | 0 |
| 205 | UpdateChecker. | method | export | `()` | 0 |
| 218 | UpdateChecker. | method | export | `async ()` | 0 |
| 246 | UpdateChecker. | method | export | `()` | 0 |
| 256 | UpdateChecker. | method | export | `()` | 0 |

### `apps/web/src/server/util.mjs`（14 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 6 | json | function | export | `(res, status, body, headers={})` | 43 |
| 16 | text | function | export | `(res, status, body, headers={})` | 14 |
| 25 | readBody | function | export | `(req, limit=64 * 1024 * 1024)` | 1 |
| 43 | readJsonBody | function | export | `async (req)` | 4 |
| 49 | parseCookies | function | export | `(header)` | 2 |
| 65 | escapeHtml | function | export | `(value)` | 27 |
| 75 | randomId | function | export | `(bytes=24)` | 3 |
| 79 | safeEqual | function | export | `(a, b)` | 1 |
| 86 | readJsonSync | function | export | `(file, fallback)` | 2 |
| 95 | migrateFile | function | export | `(oldPath, newPath)` | 4 |
| 112 | migrateDir | function | export | `(oldPath, newPath)` | 1 |
| 128 | writeJsonAtomic | function | export | `async (file, value, mode=0o600)` | 2 |
| 136 | summarize | function | export | `(value, depth=0)` | 6 |
| 157 | isInside | function | export | `(root, target)` | 8 |

### `apps/web/src/server/worker-host.mjs`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | fail | function |  | `(error)` | 50 |
| 21 | main | function |  | `async ()` | 1 |

## A2 Web 后端兼容层（6 文件 / 164 条）

### `apps/web/src/backend/chromium.mjs`（46 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 14 | findChrome | function |  | `()` | 1 |
| 30 | CdpConnection.constructor | ctor |  | `(ws)` | 0 |
| 45 | CdpConnection._onMessage | method |  | `(raw)` | 1 |
| 69 | CdpConnection.send | method |  | `(method, params={}, sessionId)` | 50 |
| 94 | CdpConnection.onEvent | method |  | `(fn)` | 6 |
| 102 | launch | function |  | `async ()` | 4 |
| 142 | killOnExit | arrow |  | `()` | 0 |
| 205 | ensureBrowser | function | export | `()` | 1 |
| 215 | sleep | arrow |  | `(ms)` | 10 |
| 219 | CDPWebContents.constructor | ctor |  | `(options={})` | 0 |
| 273 | CDPWebContents._init | method | export | `async ()` | 1 |
| 299 | CDPWebContents._send | method | export | `(method, params={})` | 17 |
| 306 | CDPWebContents._onCdpEvent | method | export | `(method, params)` | 1 |
| 379 | CDPWebContents._mainFrameId | method | export | `()` | 3 |
| 383 | CDPWebContents._refreshMeta | method | export | `async ()` | 4 |
| 406 | CDPWebContents._refreshHistory | method | export | `async ()` | 2 |
| 418 | CDPWebContents._gotoOffset | method | export | `async (offset)` | 2 |
| 426 | CDPWebContents.loadURL | method | export | `(url)` | 5 |
| 458 | CDPWebContents.executeJavaScript | method | export | `async (code)` | 13 |
| 475 | CDPWebContents.capturePage | method | export | `async ()` | 1 |
| 482 | CDPWebContents.emit | method | export | `(event, args)` | 86 |
| 487 | CDPWebContents.isDestroyed | method | export | `()` | 42 |
| 491 | CDPWebContents.getURL | method | export | `()` | 8 |
| 495 | CDPWebContents.getTitle | method | export | `()` | 5 |
| 499 | CDPWebContents.isLoading | method | export | `()` | 3 |
| 503 | CDPWebContents.reload | method | export | `()` | 6 |
| 507 | CDPWebContents.stop | method | export | `()` | 11 |
| 512 | CDPWebContents.setWindowOpenHandler | method | export | `(handler)` | 2 |
| 516 | CDPWebContents.setAudioMuted | method | export | `()` | 1 |
| 517 | CDPWebContents.setFrameRate | method | export | `()` | 1 |
| 518 | CDPWebContents.setZoomFactor | method | export | `()` | 0 |
| 519 | CDPWebContents.insertCSS | method | export | `(css)` | 1 |
| 528 | CDPWebContents.removeInsertedCSS | method | export | `(key)` | 0 |
| 534 | CDPWebContents.openDevTools | method | export | `()` | 0 |
| 535 | CDPWebContents.sendToFrame | method | export | `()` | 0 |
| 536 | CDPWebContents.setWindowOpenHandler2 | method | export | `()` | 0 |
| 537 | CDPWebContents.onBeforeInput | method | export | `()` | 0 |
| 539 | CDPWebContents.close | method | export | `async ()` | 28 |
| 551 | closeBrowser | function | export | `async ()` | 0 |
| 557 | imageFromPng | function |  | `(buf)` | 1 |
| 563 | image.isEmpty | objmethod |  | `()` | 6 |
| 564 | image.getSize | objmethod |  | `()` | 3 |
| 565 | image.toPNG | objmethod |  | `()` | 2 |
| 566 | image.toJPEG | objmethod |  | `()` | 2 |
| 567 | image.toDataURL | objmethod |  | `()` | 7 |
| 568 | image.resize | objmethod |  | `()` | 4 |

### `apps/web/src/backend/electron-shim.mjs`（98 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 21 | setEventSink | function | export | `(fn)` | 0 |
| 24 | emitEvent | function |  | `(channel, payload)` | 1 |
| 61 | __listChannels | function | export | `()` | 1 |
| 65 | fakeEvent | arrow |  | `()` | 2 |
| 73 | __invoke | function | export | `async (channel, args)` | 1 |
| 83 | __send | function | export | `(channel, args)` | 1 |
| 97 | DevaApp.constructor | ctor |  | `()` | 0 |
| 107 | DevaApp.getPath | method |  | `(name)` | 5 |
| 123 | DevaApp.getVersion | method |  | `()` | 5 |
| 127 | DevaApp.getName | method |  | `()` | 0 |
| 130 | DevaApp.getLocale | method |  | `()` | 0 |
| 133 | DevaApp.getPreferredSystemLanguages | method |  | `()` | 0 |
| 136 | DevaApp.getAppPath | method |  | `()` | 0 |
| 139 | DevaApp.isReady | method |  | `()` | 1 |
| 142 | DevaApp.whenReady | method |  | `()` | 3 |
| 145 | DevaApp.requestSingleInstanceLock | method |  | `()` | 1 |
| 148 | DevaApp.releaseSingleInstanceLock | method |  | `()` | 0 |
| 149 | DevaApp.setAppUserModelId | method |  | `()` | 1 |
| 150 | DevaApp.setLoginItemSettings | method |  | `()` | 0 |
| 151 | DevaApp.setAsDefaultProtocolClient | method |  | `()` | 0 |
| 154 | DevaApp.disableHardwareAcceleration | method |  | `()` | 0 |
| 155 | DevaApp.focus | method |  | `()` | 14 |
| 156 | DevaApp.quit | method |  | `()` | 4 |
| 159 | DevaApp.exit | method |  | `(code=0)` | 10 |
| 180 | fakeWebContents.executeJavaScript | objmethod | export | `async ()` | 13 |
| 183 | fakeWebContents.getURL | objmethod | export | `()` | 8 |
| 187 | BrowserWindow.constructor | ctor |  | `(options={})` | 0 |
| 197 | BrowserWindow.getAllWindows | method | export | `()` | 1 |
| 200 | BrowserWindow.getFocusedWindow | method | export | `()` | 0 |
| 203 | BrowserWindow.fromWebContents | method | export | `()` | 0 |
| 206 | BrowserWindow.fromId | method | export | `()` | 0 |
| 209 | BrowserWindow.isDestroyed | method | export | `()` | 42 |
| 212 | BrowserWindow.isMinimized | method | export | `()` | 7 |
| 215 | BrowserWindow.isFocused | method | export | `()` | 2 |
| 218 | BrowserWindow.isAlwaysOnTop | method | export | `()` | 0 |
| 221 | BrowserWindow.isMaximizable | method | export | `()` | 0 |
| 224 | BrowserWindow.isMaximized | method | export | `()` | 3 |
| 227 | BrowserWindow.isFullScreen | method | export | `()` | 3 |
| 230 | BrowserWindow.isVisible | method | export | `()` | 1 |
| 233 | BrowserWindow.show | method | export | `()` | 60 |
| 234 | BrowserWindow.hide | method | export | `()` | 4 |
| 235 | BrowserWindow.focus | method | export | `()` | 14 |
| 236 | BrowserWindow.blur | method | export | `()` | 6 |
| 237 | BrowserWindow.close | method | export | `()` | 28 |
| 238 | BrowserWindow.destroy | method | export | `()` | 7 |
| 243 | BrowserWindow.minimize | method | export | `()` | 1 |
| 244 | BrowserWindow.maximize | method | export | `()` | 1 |
| 245 | BrowserWindow.unmaximize | method | export | `()` | 2 |
| 246 | BrowserWindow.restore | method | export | `()` | 5 |
| 247 | BrowserWindow.setTitle | method | export | `()` | 4 |
| 248 | BrowserWindow.setMenuBarVisibility | method | export | `()` | 0 |
| 249 | BrowserWindow.setTitleBarOverlay | method | export | `()` | 3 |
| 250 | BrowserWindow.setBounds | method | export | `()` | 2 |
| 251 | BrowserWindow.setPosition | method | export | `()` | 2 |
| 252 | BrowserWindow.setSize | method | export | `()` | 0 |
| 253 | BrowserWindow.center | method | export | `()` | 0 |
| 254 | BrowserWindow.loadURL | method | export | `async ()` | 5 |
| 255 | BrowserWindow.loadFile | method | export | `async ()` | 2 |
| 256 | BrowserWindow.getBounds | method | export | `()` | 3 |
| 259 | BrowserWindow.getContentBounds | method | export | `()` | 0 |
| 262 | BrowserWindow.getPosition | method | export | `()` | 0 |
| 265 | BrowserWindow.getSize | method | export | `()` | 3 |
| 268 | BrowserWindow.getContentSize | method | export | `()` | 1 |
| 271 | BrowserWindow.scrollBy | method | export | `()` | 0 |
| 272 | BrowserWindow.setAlwaysOnTop | method | export | `()` | 3 |
| 273 | BrowserWindow.setSkipTaskbar | method | export | `()` | 2 |
| 274 | BrowserWindow.setIgnoreMouseEvents | method | export | `()` | 0 |
| 275 | BrowserWindow.addBrowserView | method | export | `()` | 0 |
| 276 | BrowserWindow.removeBrowserView | method | export | `()` | 0 |
| 356 | masterKey | function |  | `()` | 2 |
| 392 | pngSize | function |  | `(buf)` | 1 |
| 403 | image.isEmpty | objmethod |  | `()` | 6 |
| 404 | image.getSize | objmethod |  | `()` | 3 |
| 405 | image.toPNG | objmethod |  | `()` | 2 |
| 406 | image.toJPEG | objmethod |  | `()` | 2 |
| 407 | image.toDataURL | objmethod |  | `()` | 7 |
| 408 | image.resize | objmethod |  | `()` | 4 |
| 435 | Tray.setToolTip | method | export | `()` | 1 |
| 436 | Tray.setContextMenu | method | export | `()` | 1 |
| 437 | Tray.setImage | method | export | `()` | 0 |
| 438 | Tray.popUpContextMenu | method | export | `()` | 0 |
| 439 | Tray.destroy | method | export | `()` | 7 |
| 443 | Menu.buildFromTemplate | objmethod | export | `(template)` | 3 |
| 445 | Menu.getApplicationMenu | objmethod | export | `()` | 0 |
| 449 | Notification.constructor | ctor |  | `(options={})` | 0 |
| 453 | Notification.show | method | export | `()` | 60 |
| 456 | Notification.close | method | export | `()` | 28 |
| 457 | Notification.isSupported | method | export | `()` | 2 |
| 466 | makeSession | function |  | `()` | 2 |
| 486 | ses.clearStorageData | objmethod |  | `async ()` | 0 |
| 495 | ses.fetch | objmethod |  | `(url, init)` | 20 |
| 521 | net.fetch | objmethod | export | `(args)` | 20 |
| 529 | net.isOnline | objmethod | export | `()` | 0 |
| 541 | screen.getPrimaryDisplay | objmethod | export | `()` | 0 |
| 547 | screen.getAllDisplays | objmethod | export | `()` | 1 |
| 548 | screen.getCursorScreenPoint | objmethod | export | `()` | 0 |
| 568 | WebContentsView.constructor | ctor |  | `()` | 0 |
| 571 | WebContentsView.setBounds | method | export | `()` | 2 |

### `apps/web/src/backend/index.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 55 | step | function |  | `(name:string, fn:() => void): void` | 25 |
| 64 | createBackend | function | export | `async (options:BackendOptions): Promise<Backend>` | 1 |
| 71 | getWindow | arrow |  | `()` | 13 |
| 84 | ipc:window:minimize | ipc |  | `()` | 0 |
| 85 | ipc:window:toggle-maximize | ipc |  | `()` | 0 |
| 86 | ipc:window:close | ipc |  | `()` | 0 |
| 87 | ipc:window:is-fullscreen | ipc |  | `()` | 0 |
| 88 | ipc:window:set-overlay | ipc |  | `()` | 0 |
| 89 | ipc:app:get-platform | ipc |  | `()` | 0 |

### `apps/web/src/backend/updater-stub.mjs`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 2 | unavailable | arrow |  | `()` | 0 |
| 7 | autoUpdater.on | objmethod | export | `()` | 90 |
| 8 | autoUpdater.once | objmethod | export | `()` | 11 |
| 9 | autoUpdater.removeListener | objmethod | export | `()` | 15 |
| 13 | autoUpdater.setFeedURL | objmethod | export | `()` | 0 |

### `apps/web/src/electron-shim.js`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 11 | csrf | function |  | `()` | 3 |
| 15 | emit | function |  | `(channel, payload)` | 86 |
| 79 | __devaEmit | function | export | `(channel, payload)` | 0 |

### `apps/web/src/handlers.mjs`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | createHandlers | function | export | `({ devaHome })` | 0 |
| 16 | readConfig | arrow |  | `()` | 4 |
| 24 | writeConfig | arrow |  | `async (patch)` | 1 |

## A3 Web 构建/前端壳/测试（3 文件 / 23 条）

### `apps/web/build.mjs`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 113 | gitInfo | function |  | `()` | 1 |
| 114 | read | arrow |  | `(args)` | 11 |

### `apps/web/src/web/picker.js`（16 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 62 | csrf | function |  | `()` | 3 |
| 66 | baseName | function |  | `(p)` | 2 |
| 73 | build | function |  | `()` | 6 |
| 146 | setHint | function |  | `(text, isError)` | 10 |
| 151 | setBusy | function |  | `(value)` | 23 |
| 159 | renderRoots | function |  | `()` | 1 |
| 175 | render | function |  | `()` | 6 |
| 229 | load | function |  | `(dirPath)` | 5 |
| 258 | post | function |  | `(body)` | 5 |
| 274 | choose | function |  | `()` | 8 |
| 298 | cancel | function |  | `()` | 6 |
| 310 | hide | function |  | `()` | 4 |
| 321 | show | function |  | `(payload)` | 60 |
| 337 | poll | function |  | `()` | 2 |
| 353 | connect | function |  | `()` | 3 |
| 366 | start | function |  | `()` | 6 |

### `apps/web/test/smoke.mjs`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 17 | check | arrow |  | `(name, cond, extra='')` | 19 |
| 27 | login | function |  | `async (username, password)` | 2 |
| 40 | boot | function |  | `async (cookie)` | 2 |
| 45 | client | function |  | `(cookie, csrf)` | 3 |
| 46 | invoke | arrow |  | `async (channel, args=[], extra={})` | 166 |

## B 桌面·主进程（84 文件 / 1292 条）

### `apps/desktop/src/main/http.ts`（16 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 43 | httpFetch | function | export | `async (input:string \| URL, init:RequestInit={}): Promise<Response>` | 7 |
| 69 | viaChromium | function |  | `async (route:Route, url:string, init:RequestInit): Promise<Response>` | 2 |
| 75 | pool | function |  | `(route:Route): Promise<Pool>` | 2 |
| 87 | createPool | function |  | `async (route:Route): Promise<Pool>` | 1 |
| 103 | systemProxied | function |  | `async (url:string): Promise<boolean>` | 1 |
| 113 | envProxy | function |  | `(): { rules: string; bypass: string } \| null` | 2 |
| 115 | get | arrow |  | `(k:string): string` | 255 |
| 126 | proxyUri | function |  | `(v:string): string \| null` | 3 |
| 141 | bypassRules | function |  | `(v:string): string` | 1 |
| 159 | describeNetError | function | export | `(e:unknown): string` | 10 |
| 183 | withCode | function |  | `(text:string, code:string): string` | 2 |
| 221 | explain | function |  | `(code:string): string \| null` | 2 |
| 227 | chromiumCode | function |  | `(e:unknown): string \| undefined` | 2 |
| 231 | isAbort | function |  | `(e:unknown): boolean` | 2 |
| 235 | originOf | function |  | `(url:string): string` | 1 |
| 244 | replayable | function |  | `(body:RequestInit['body']): boolean` | 1 |

### `apps/desktop/src/main/index.ts`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 56 | ensureLinuxPasswordStore | function |  | `(): void` | 1 |
| 86 | overlayOptions | function |  | `(dark:boolean): { color: string; symbolColor?: string;…` | 1 |
| 98 | createWindow | function |  | `(): void` | 3 |
| 133 | revealOnce | arrow |  | `(reason:string): void` | 5 |
| 217 | showMainWindow | function |  | `(): void` | 3 |
| 232 | createTray | function |  | `(): void` | 1 |
| 301 | ipc:window:set-overlay | ipc |  | `(_evt, symbolColor:string)` | 0 |
| 311 | ipc:window:minimize | ipc |  | `()` | 0 |
| 312 | ipc:window:toggle-maximize | ipc |  | `()` | 0 |
| 316 | ipc:window:close | ipc |  | `()` | 0 |
| 317 | ipc:window:is-fullscreen | ipc |  | `()` | 0 |
| 318 | ipc:app:get-platform | ipc |  | `()` | 0 |

### `apps/desktop/src/main/locale.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 7 | isEn | function | export | `(): boolean` | 31 |

### `apps/desktop/src/main/providers/anthropic.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 24 | imageBlock | function |  | `(p:ImagePart): unknown` | 1 |
| 28 | mapContent | function |  | `(content:string \| ContentPart[]): unknown` | 1 |
| 58 | mapMessages | function |  | `(messages:Message[]): unknown[]` | 2 |
| 82 | markCacheTail | function |  | `(messages:unknown[]): void` | 1 |
| 96 | thinkingParam | function |  | `(e:EffortRequest \| undefined): Record<string, unknown> \| undefined` | 1 |
| 113 | mapStopReason | function |  | `(raw:string \| null \| undefined): StopReason` | 1 |
| 131 | streamAnthropic | function | export | `async (cfg:AdapterConfig, req:GenerateRequest): AsyncGenerator<StreamEvent>` | 1 |
| 210 | takeUsage | arrow |  | `(u:AnthropicUsage \| undefined): void` | 5 |

### `apps/desktop/src/main/providers/index.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 16 | toParts | function |  | `(content:string \| ContentPart[]): ContentPart[]` | 2 |
| 28 | normalizeMessages | function | export | `(messages:Message[]): Message[]` | 1 |
| 46 | streamChat | function | export | `async (cfg:StreamChatConfig, req:GenerateRequest): AsyncGenerator<StreamEvent>` | 3 |

### `apps/desktop/src/main/providers/openai-responses.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 51 | mapInput | function |  | `(messages:Message[]): ResponsesInputItem[]` | 1 |
| 113 | streamResponses | function | export | `async (cfg:AdapterConfig, req:GenerateRequest): AsyncGenerator<StreamEvent>` | 1 |
| 183 | takeUsage | arrow |  | `(evt:Record<string, unknown>): void` | 5 |

### `apps/desktop/src/main/providers/openai.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 44 | imageUrlPart | function |  | `(p:ImagePart): OpenAIContentPart` | 2 |
| 49 | mapMessages | function |  | `(system:string \| undefined, messages:Message[]): OpenAIMessage[]` | 2 |
| 115 | thinkingFields | function |  | `(e:EffortRequest \| undefined): Record<string, unknown>` | 1 |
| 134 | outputLimitField | function |  | `(baseURL:string): 'max_tokens' \| 'max_completion_tokens'` | 1 |
| 146 | mapFinishReason | function |  | `(raw:string \| null \| undefined): StopReason` | 1 |
| 169 | streamOpenAI | function | export | `async (cfg:AdapterConfig, req:GenerateRequest): AsyncGenerator<StreamEvent>` | 1 |
| 233 | flushCalls | arrow |  | `(): Generator<StreamEvent>` | 2 |

### `apps/desktop/src/main/providers/opencode.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 21 | isOpencodeInference | function |  | `(baseURL:string): boolean` | 2 |
| 40 | providerHeaders | function | export | `(baseURL:string, sessionId?:string): Record<string, string>` | 2 |
| 54 | opencodeModelsURL | function | export | `(baseURL:string): string \| null` | 1 |

### `apps/desktop/src/main/providers/sse.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | StreamIdleError.constructor | ctor |  | `(ms:number)` | 0 |
| 28 | iterateSSE | function | export | `async (res:Response, idleMs=0): AsyncGenerator<{ event?: string; data:…` | 3 |
| 67 | readWithIdle | function |  | `async (reader:ReadableStreamDefaultReader<Uint8Array>, idleMs:number): Promise<ReadableStreamReadResult<Uint8…` | 1 |

### `apps/desktop/src/main/providers/types.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 213 | toolImagesNote | function | export | `(images:ImagePart[]): string` | 2 |
| 219 | parseToolArgs | function | export | `(raw:string): unknown` | 3 |
| 240 | settleBrokenCalls | function | export | `(broken:{ id: string; name: string; raw: string }[], stopReason:StopReason): Generator<StreamEvent>` | 3 |
| 251 | bodyHint | function |  | `(body:string): string` | 8 |
| 264 | inbandError | function | export | `(text:string, fallback:NormalizedError): NormalizedError` | 4 |
| 273 | parseRetryAfter | function |  | `(v:string \| null \| undefined): number \| undefined` | 2 |
| 285 | isOutputLimitRejection | function | export | `(status:number, body:string): boolean` | 1 |
| 293 | isEffortRejection | function |  | `(status:number, body:string): boolean` | 1 |
| 302 | httpError | function | export | `(status:number, body:string, retryAfter?:string \| null, effortSent?:boolean): NormalizedError` | 6 |

### `apps/desktop/src/main/pty-host.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 39 | post | function |  | `(msg:OutboundMessage): void` | 5 |
| 44 | defaultShell | function |  | `(): string` | 1 |
| 50 | safeCwd | function |  | `(cwd:string \| null): string` | 1 |
| 55 | handleCreate | function |  | `(msg:Extract<InboundMessage, { type: 'create' }>): void` | 1 |

### `apps/desktop/src/main/services/appimage.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 24 | quoteExecArg | function |  | `(arg:string): string` | 1 |
| 29 | integrateAppImage | function | export | `async (): Promise<void>` | 1 |
| 68 | copyIcons | function |  | `async (appDir:string, destRoot:string): Promise<void>` | 1 |

### `apps/desktop/src/main/services/attachments.ts`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 73 | classify | function |  | `(ext:string): AttachmentKind` | 3 |
| 116 | inspect | function |  | `(abs:string, size:number, byPath=true): PickedAttachment` | 4 |
| 137 | pasteName | function |  | `(raw:string, mime:string): string` | 1 |
| 144 | p2 | arrow |  | `(n:number): string` | 5 |
| 149 | registerAttachmentsIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 156 | ipc:fs:paste-attachment | ipc |  | `async (_e, file:{ name: string; mime: string; size: number; data: Uint8Array \| null }): Promise<PickedAttachment>` | 0 |
| 189 | ipc:fs:dropped-entries | ipc |  | `async (_e, paths:unknown): Promise<(DroppedEntry \| null)[]>` | 0 |
| 209 | ipc:fs:attachment-image | ipc |  | `async (_e, path:unknown, full:unknown): Promise<string \| null>` | 0 |
| 223 | ipc:fs:pick-attachments | ipc |  | `async (): Promise<PickedAttachment[]>` | 0 |
| 270 | buildAttachmentPart | function | export | `async (path:string, adapter:'anthropic' \| 'openai' \| 'responses'): Promise<{ part?: ContentPart; note?: s…` | 1 |

### `apps/desktop/src/main/services/avatar-image.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 29 | avatarImagePath | function |  | `(dir:string, name:string): string` | 1 |
| 38 | readAvatarImage | function | export | `(dir:string, name:string): string` | 4 |
| 52 | clearAvatarImage | function | export | `(dir:string, name:string): void` | 5 |
| 63 | writeAvatarImage | function | export | `(dir:string, name:string, dataUri:string): string` | 2 |

### `apps/desktop/src/main/services/browser/host.ts`（55 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 92 | isPageInUse | function | export | `(p:BrowserPage): boolean` | 1 |
| 100 | mainWindowGetter | arrow |  | `()` | 2 |
| 101 | sessionAborter | arrow |  | `()` | 1 |
| 103 | setMainWindowGetter | function | export | `(fn:() => BrowserWindow \| null): void` | 2 |
| 107 | setSessionAborter | function | export | `(fn:(sessionId: string) => boolean): void` | 1 |
| 121 | visibleTabs | function |  | `(): Set<string>` | 1 |
| 131 | uiState | function | export | `(): BrowserUiState` | 3 |
| 172 | push | function |  | `(): void` | 463 |
| 185 | offscreenPoint | function |  | `(): { x: number; y: number }` | 3 |
| 190 | overlay | function |  | `(): Electron.TitleBarOverlay \| undefined` | 2 |
| 201 | destroyWhenEmpty | function |  | `(): void` | 2 |
| 212 | ensureWindow | function |  | `(): BrowserWindow` | 2 |
| 256 | onTheme | arrow |  | `(): void` | 0 |
| 276 | chromeHeight | function |  | `(): number` | 3 |
| 284 | layout | function |  | `(): void` | 10 |
| 294 | repositionIfDocked | function |  | `(): void` | 0 |
| 305 | firstBounds | function |  | `(main:BrowserWindow \| null, w:BrowserWindow): Rectangle` | 1 |
| 310 | size | arrow |  | `(k:'width' \| 'height'): number` | 2 |
| 327 | showWindow | function | export | `(tab?:string \| null, focus=true): void` | 4 |
| 347 | dock | function | export | `(): void` | 3 |
| 367 | setPinned | function | export | `(on:boolean): void` | 1 |
| 373 | activateTab | function | export | `(tab:string): void` | 1 |
| 381 | destroyWindow | function | export | `(): void` | 1 |
| 390 | createWindowPage | function |  | `(id:string, sessionId:string, personaId?:string): BrowserPage` | 0 |
| 432 | beginOperating | function | export | `(page:BrowserPage, action:string, label?:string): boolean` | 1 |
| 445 | updateOperating | function | export | `(page:BrowserPage, label:string): void` | 2 |
| 454 | endOperating | function | export | `(page:BrowserPage, idleMs=6_000): void` | 1 |
| 468 | clearOperating | function | export | `(sessionId:string): void` | 3 |
| 483 | requestHandoff | function | export | `(page:BrowserPage, reason:HandoffReason, message:string, signal?:AbortSignal, opts:{ show…): Promise<HandoffResponse>` | 1 |
| 496 | finish | arrow |  | `(r:HandoffResponse): void` | 11 |
| 506 | onAbort | arrow |  | `(): void` | 0 |
| 519 | hasHandoff | function | export | `(sessionId:string): boolean` | 0 |
| 524 | respondHandoff | function | export | `(sessionId:string, answer:'done' \| 'skip'): void` | 1 |
| 528 | closeSessionHandoff | function | export | `(sessionId:string): void` | 1 |
| 535 | pageById | function |  | `(id:unknown): BrowserPage \| undefined` | 5 |
| 540 | registerBrowserIpc | function | export | `(): void` | 2 |
| 554 | ipc:browser:state | ipc |  | `()` | 0 |
| 556 | ipc:browser:open | ipc |  | `(_e, opts:{ tab?: string; sessionId?: string }={})` | 0 |
| 561 | ipc:browser:dock | ipc |  | `()` | 0 |
| 566 | ipc:browser:close-session | ipc |  | `(_e, sessionId:string)` | 0 |
| 572 | ipc:browser:preview-pinned | ipc |  | `(_e, tab:string \| null)` | 0 |
| 579 | ipc:browser:live-start | ipc |  | `(_e, tab:string)` | 0 |
| 582 | ipc:browser:live-stop | ipc |  | `()` | 0 |
| 586 | ipc:browser:pin | ipc |  | `(_e, on:boolean)` | 0 |
| 590 | ipc:browser:activate | ipc |  | `(_e, tab:string)` | 0 |
| 594 | ipc:browser:close-tab | ipc |  | `(_e, tab:string)` | 0 |
| 598 | ipc:browser:nav | ipc |  | `(_e, tab:string, what:'back' \| 'forward' \| 'reload' \| 'stop')` | 0 |
| 610 | ipc:browser:menu | ipc |  | `(_e, tab:string, labels:Record<string, string>, at:{ x: number; y: number })` | 0 |
| 613 | text | arrow |  | `(k:string): string` | 14 |
| 618 | alive | arrow |  | `(): boolean` | 3 |
| 639 | ipc:browser:thumbnail | ipc |  | `async (_e, tab:string)` | 0 |
| 650 | ipc:browser:handoff | ipc |  | `(_e, sessionId:string, answer:'done' \| 'skip')` | 0 |
| 654 | ipc:browser:stop | ipc |  | `(_e, sessionId:string)` | 0 |
| 660 | ipc:browser:ready | ipc |  | `()` | 0 |
| 667 | refreshUi | function | export | `(): void` | 0 |

### `apps/desktop/src/main/services/browser/index.ts`（28 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 61 | closeSessionPages | function | export | `(sessionId:string): void` | 2 |
| 67 | disposeAllPages | function | export | `(): void` | 2 |
| 221 | fail | arrow |  | `(msg:string): never` | 50 |
| 225 | str | function |  | `(v:unknown): string` | 56 |
| 229 | sleep | function |  | `(ms:number, signal?:AbortSignal): Promise<void>` | 10 |
| 244 | withTimeout | function |  | `(p:Promise<T>, ms:number, what:string): Promise<T>` | 2 |
| 254 | clip | arrow |  | `(s:string, n:number): string` | 22 |
| 273 | loadErrorText | function |  | `(msg:string): string` | 1 |
| 296 | settle | function |  | `async (page:BrowserPage, signal?:AbortSignal): Promise<void>` | 9 |
| 312 | navigate | function |  | `async (page:BrowserPage, url:string, signal?:AbortSignal): Promise<string \| null>` | 3 |
| 335 | readPage | function |  | `async (page:BrowserPage, fromView=false): Promise<PageSnapshot>` | 1 |
| 344 | formatPage | function |  | `(page:BrowserPage, snap:PageSnapshot, lead:string[], fromView=false): string` | 1 |
| 372 | pageResult | function |  | `async (sessionId:string, fallback:BrowserPage, lead:string[], signal?:AbortSignal, fromView=fal…): Promise<ToolOutcome>` | 15 |
| 405 | locate | function |  | `async (page:BrowserPage, ref:string): Promise<Located>` | 3 |
| 414 | mouseClick | function |  | `async (page:BrowserPage, x:number, y:number, clickCount=1): Promise<void>` | 2 |
| 439 | pressKey | function |  | `async (page:BrowserPage, combo:string): Promise<void>` | 3 |
| 479 | requirePage | function |  | `(sessionId:string): BrowserPage` | 14 |
| 489 | tabsText | function |  | `(sessionId:string): string` | 5 |
| 507 | evaluate | function |  | `async (page:BrowserPage, script:string): Promise<{ ok: boolean; text: string }>` | 1 |
| 510 | wrap | arrow |  | `(body:string): string` | 1 |
| 512 | run | arrow |  | `(body:string): Promise<EvalOutcome>` | 17 |
| 527 | operate | function |  | `async (page:BrowserPage, action:Action, label?:string, signal?:AbortSignal): Promise<void>` | 3 |
| 531 | act | function |  | `async (action:Action, a:Record<string, unknown>, sessionId:string, signal:AbortSignal \| undefin…): Promise<ToolOutcome>` | 8 |
| 849 | goneTab | function |  | `(id:string, sessionId:string): string` | 2 |
| 860 | sameUrl | function |  | `(a:string, b:string): boolean` | 1 |
| 861 | norm | arrow |  | `(u:string): string` | 6 |
| 874 | pageName | function |  | `(page:BrowserPage): string` | 2 |
| 886 | runBrowserTool | function | export | `async (a:Record<string, unknown>, ctx:BrowserToolContext): Promise<ToolOutcome>` | 1 |

### `apps/desktop/src/main/services/browser/live.ts`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | startLive | function | export | `async (tabId:string, target:() => BrowserWindow \| null): Promise<boolean>` | 1 |
| 38 | w.onMessage | objmethod |  | `(_e, method, params)` | 4 |
| 54 | w.onDestroyed | objmethod |  | `()` | 0 |
| 71 | stopLive | function | export | `(): void` | 2 |
| 78 | clear | function |  | `(): void` | 19 |
| 91 | liveTab | function | export | `(): string \| null` | 0 |

### `apps/desktop/src/main/services/browser/page-scripts.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 9 | callScript | function | export | `(fnSource:string, args:unknown[]): string` | 4 |

### `apps/desktop/src/main/services/browser/pages.ts`（35 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 89 | markHostWindow | function | export | `(win:BrowserWindow): void` | 1 |
| 95 | setWindowPageFactory | function | export | `(fn:typeof windowPageFactory): void` | 1 |
| 100 | inUse | arrow |  | `()` | 2 |
| 101 | setInUseCheck | function | export | `(fn:typeof inUse): void` | 1 |
| 106 | sessionBusy | arrow |  | `()` | 1 |
| 107 | setSessionBusyCheck | function | export | `(fn:typeof sessionBusy): void` | 0 |
| 112 | idleLimit | function |  | `(p:BrowserPage): number` | 1 |
| 117 | markTurnEnded | function | export | `(sessionId:string): void` | 0 |
| 123 | changed | arrow |  | `()` | 4 |
| 124 | setPagesChangedListener | function | export | `(fn:() => void): void` | 1 |
| 127 | notifyPagesChanged | function | export | `(): void` | 1 |
| 132 | allPages | function | export | `(): BrowserPage[]` | 6 |
| 137 | hasPendingRequests | function | export | `(page:BrowserPage, staleMs=4_000): boolean` | 2 |
| 146 | isBrowserHostWindow | function | export | `(win:BrowserWindow): boolean` | 1 |
| 151 | browserSession | function | export | `(): Session` | 2 |
| 177 | uniquePath | function |  | `(dir:string, name:string): string` | 1 |
| 184 | startReaper | function |  | `(): void` | 1 |
| 201 | createPage | function | export | `(sessionId:string, visible=false, personaId?:string): BrowserPage` | 4 |
| 229 | basePage | function | export | `(id:string, sessionId:string, personaId:string \| undefined, kind:BrowserPage['kind'], wc:…): BrowserPage` | 2 |
| 244 | dropBlank | arrow |  | `(): void` | 0 |
| 271 | createOffscreenPage | function |  | `(id:string, sessionId:string, personaId?:string): BrowserPage` | 1 |
| 295 | forget | function |  | `(id:string): void` | 4 |
| 307 | enforceLimits | function |  | `(sessionId:string): void` | 1 |
| 315 | lru | function |  | `(list:BrowserPage[]): BrowserPage` | 2 |
| 321 | sessionPages | function | export | `(sessionId:string): BrowserPage[]` | 7 |
| 325 | currentPage | function | export | `(sessionId:string): BrowserPage \| null` | 10 |
| 331 | getPage | function | export | `(sessionId:string, id:string): BrowserPage \| null` | 3 |
| 336 | setCurrent | function | export | `(page:BrowserPage): void` | 6 |
| 344 | currentBySession | function | export | `(): Record<string, string>` | 2 |
| 348 | closePage | function | export | `(id:string): void` | 8 |
| 356 | closeSessionPages | function | export | `(sessionId:string): void` | 2 |
| 361 | disposeAllPages | function | export | `(): void` | 2 |
| 374 | ensureCdp | function | export | `async (page:BrowserPage): Promise<void>` | 4 |
| 394 | timed | function |  | `(p:Promise<T>, what:string, ms=5_000): Promise<T>` | 5 |
| 405 | cdp | function | export | `async (page:BrowserPage, method:string, params?:Record<string, unknown>, timeoutMs=CDP_TIMEOUT_MS): Promise<T>` | 11 |

### `apps/desktop/src/main/services/browser/url.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 9 | normalizeUrl | function | export | `(raw:string): string \| null` | 2 |

### `apps/desktop/src/main/services/chat-bus.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 32 | subscribe | function |  | `(topic:string, listener:(p: T) => void): () => void` | 3 |
| 33 | safe | arrow |  | `(p:T): void` | 0 |
| 44 | publishChatEvent | function | export | `(p:ChatEventPayload): void` | 1 |
| 48 | onChatEvent | function | export | `(listener:(p: ChatEventPayload) => void): () => void` | 2 |
| 52 | publishAppNotice | function | export | `(n:AppNotice): void` | 1 |
| 56 | onAppNotice | function | export | `(listener:(n: AppNotice) => void): () => void` | 1 |
| 63 | publishSessionsChanged | function | export | `(): void` | 15 |
| 67 | onSessionsChanged | function | export | `(listener:() => void): () => void` | 2 |

### `apps/desktop/src/main/services/chat-store.ts`（24 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 245 | projectKey | function | export | `(workspaceRoot:string \| null): string` | 0 |
| 251 | chatsDir | function |  | `(): string` | 9 |
| 265 | safeId | function |  | `(id:string): string` | 3 |
| 269 | fileForId | function |  | `(id:string): string` | 3 |
| 273 | indexPath | function |  | `(): string` | 2 |
| 282 | metaOf | function |  | `(s:StoredSession): ChatSessionMeta` | 3 |
| 299 | ensureIndex | function |  | `(): Map<string, ChatSessionMeta>` | 6 |
| 340 | writeFileAtomic | function | export | `(file:string, data:string): void` | 4 |
| 355 | persistIndex | function |  | `(): void` | 5 |
| 369 | compactedPrefix | function |  | `(id:string): string` | 2 |
| 373 | toLines | function |  | `(messages:Message[]): string` | 2 |
| 379 | readCompacted | function |  | `(c:{ count: number; file: string }): Message[] \| null` | 1 |
| 394 | removeCompactedFiles | function |  | `(id:string, keep?:string): void` | 3 |
| 409 | syncCompacted | function |  | `(s:StoredSession): string \| null` | 1 |
| 439 | loadSessionFile | function |  | `(id:string): StoredSession \| undefined` | 5 |
| 481 | save | function | export | `(id:string): void` | 13 |
| 500 | listSessions | function | export | `(): ChatSessionMeta[]` | 13 |
| 507 | getSession | function | export | `(id:string): StoredSession \| undefined` | 70 |
| 519 | ensureSession | function | export | `(id:string, opts?:{ personaId?: string; focusRoot?: string \| null; model?: string; effort…): StoredSession` | 6 |
| 555 | rebindSessionPersona | function | export | `(id:string, from:string, to:string): boolean` | 1 |
| 570 | syncSessionBinding | function | export | `(id:string, b:{ personaId?: string; model: string }): boolean` | 1 |
| 588 | setSessionArchived | function | export | `(id:string, archived:boolean): boolean` | 2 |
| 599 | deleteSession | function | export | `(id:string): void` | 3 |
| 612 | deriveTitle | function | export | `(text:string): string` | 5 |

### `apps/desktop/src/main/services/chat.ts`（192 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 354 | normalizeAgentDraft | function |  | `(input:unknown): AgentDraft` | 2 |
| 356 | str | arrow |  | `(v:unknown): string` | 56 |
| 396 | normalizeAutotaskDraft | function |  | `(input:unknown): AutotaskDraft` | 2 |
| 398 | str | arrow |  | `(v:unknown): string` | 56 |
| 494 | base64Bytes | function |  | `(b64:string): number` | 2 |
| 502 | imageRef | function |  | `(msgIndex:number, partIndex:number, data:string): string` | 2 |
| 533 | plainTaskText | function |  | `(text:string): string` | 2 |
| 538 | userDisplay | function |  | `(text:string, attachments:AttachmentChip[]): DisplayMessage` | 2 |
| 550 | noticeToBlock | function |  | `(nt:StoredNotice): DisplayBlock` | 2 |
| 562 | toDisplayMessages | function |  | `(messages:Message[], proposals:Record<string, 'accepted' \| 'rejected'>={}, notices:Stored…): DisplayMessage[]` | 2 |
| 606 | lookupSubagent | arrow |  | `(id:string): { agent: string; description: string }…` | 0 |
| 617 | flushNotices | arrow |  | `(n:number): void` | 2 |
| 634 | processOne | arrow |  | `(m:Message, next:Message \| undefined): void` | 1 |
| 862 | isTurnStart | function |  | `(m:Message): boolean` | 1 |
| 875 | turnRanges | function |  | `(messages:Message[]): { start: number; end: number }[]` | 2 |
| 891 | deleteTurns | function |  | `(s:StoredSession, turnIndices:number[]): void` | 4 |
| 947 | survivingBefore | arrow |  | `(afterOld:number): number` | 1 |
| 963 | prune | arrow |  | `(rec?:Record<string, T>): Record<string, T> \| undefined` | 9 |
| 1003 | repairDanglingToolUses | function |  | `(s:StoredSession): boolean` | 8 |
| 1112 | isCustomEntryLabel | function |  | `(label:string): boolean` | 1 |
| 1127 | normalizeOptions | function |  | `(raw:unknown): AskOption[]` | 2 |
| 1165 | isQuestionOptional | function |  | `(question:string, explicit:unknown): boolean` | 1 |
| 1176 | parseAskQuestions | function |  | `(args:unknown): AskQuestion[]` | 2 |
| 1378 | wantedOutputBudget | function |  | `(model:ChatModelConfig): number \| undefined` | 2 |
| 1385 | outputBudgetKey | function |  | `(model:ChatModelConfig, budget:number \| undefined): string` | 2 |
| 1388 | outputBudget | function |  | `(model:ChatModelConfig): number \| undefined` | 1 |
| 1398 | effortKey | function |  | `(model:{ providerId: string; model: string }, level:EffortLevel): string` | 2 |
| 1405 | sentEffort | function |  | `(model:ChatModelConfig, level:EffortLevel \| undefined): { level: EffortLevel; req: EffortReque…` | 1 |
| 1420 | truncatedNudge | function |  | `(hadText:boolean): string` | 1 |
| 1432 | stepLimitNudge | function |  | `(max:number): string` | 1 |
| 1441 | repeatReminder | function |  | `(tool:string, count:number): string` | 1 |
| 1449 | repeatStopNudge | function |  | `(tool:string, count:number): string` | 1 |
| 1461 | degenerateMessage | function |  | `(): string` | 3 |
| 1471 | callFingerprint | function |  | `(name:string, args:unknown, r:Extract<ContentPart, { type: 'tool_result' }>): string` | 1 |
| 1503 | truncatedCallInput | function |  | `(partialArgs:string): Record<string, unknown>` | 1 |
| 1526 | truncatedCallResult | function |  | `(name:string, partialChars:number, cause:BrokenCallCause, streak:number): string` | 1 |
| 1558 | delay | function |  | `(ms:number, signal:AbortSignal): Promise<boolean>` | 1 |
| 1561 | done | arrow |  | `(ok:boolean): void` | 7 |
| 1566 | onAbort | arrow |  | `(): void` | 0 |
| 1592 | timedWait | function |  | `(turnId:string, wait:Promise<T>): Promise<T>` | 3 |
| 1598 | recordTurnDuration | function |  | `(s:StoredSession, turnStart:number, ms:number): void` | 1 |
| 1676 | cancelBackground | function |  | `(sessionId:string, keep?:Set<string>): void` | 4 |
| 1690 | takeNotices | function |  | `(sessionId:string): string \| null` | 3 |
| 1697 | noticeText | function |  | `(queue:PendingNotice[]): string` | 2 |
| 1708 | notifyHeadline | function |  | `(queue:PendingNotice[]): string` | 1 |
| 1719 | noticeHeadline | function |  | `(content:string): string` | 1 |
| 1743 | releasePending | function |  | `(turnId?:string): void` | 2 |
| 1744 | mine | arrow |  | `(p:{ turnId: string }): boolean` | 3 |
| 1764 | hasActiveTurns | function | export | `(): boolean` | 3 |
| 1776 | settleActiveTurns | function | export | `async (timeoutMs:number): Promise<void>` | 2 |
| 1819 | turnToolIds | function |  | `(messages:Message[]): string[][]` | 5 |
| 1831 | collectBlobs | function |  | `(s:StoredSession): void` | 3 |
| 1837 | genId | function |  | `(prefix:string): string` | 20 |
| 1880 | runScheduledTask | function | export | `(task:TaskRecord): Promise<ScheduledTurnResult>` | 1 |
| 1911 | getChatRuntime | function | export | `(): ChatRuntime \| null` | 5 |
| 1923 | systemPrompt | function |  | `(workspaceRoot:string \| null, personas:{ name: string; prompt: string }[]=[], memory:stri…): string` | 1 |
| 1982 | sealedSystemPrompt | function |  | `(workspaceRoot:string \| null, personas:{ name: string; prompt: string }[]=[], memory:stri…): string` | 1 |
| 2042 | memberSystemPrompt | function |  | `(p:{
  member: MemberRef
  owner: string
  workspaceRoot: string \| null
  folder: string
…): string` | 1 |
| 2084 | buildSkillTool | function |  | `(): ToolSpec` | 1 |
| 2105 | buildSubagentTool | function |  | `(): ToolSpec` | 1 |
| 2152 | buildSendToSubagentTool | function |  | `(): ToolSpec` | 1 |
| 2230 | buildSubagentTools | function |  | `(def:SubagentDef, personaId:string): ToolSpec[]` | 1 |
| 2272 | mainTurnMemberTools | function |  | `(): ToolSpec[]` | 1 |
| 2280 | sameRoot | function |  | `(a:string \| null, b:string \| null): boolean` | 1 |
| 2281 | norm | arrow |  | `(p:string \| null): string` | 6 |
| 2286 | personaName | function |  | `(s:StoredSession \| undefined): string` | 13 |
| 2294 | skillDirNote | function |  | `(dir:string \| undefined): string` | 2 |
| 2309 | buildForkHistory | function | export | `(history:Message[], forkCallId:string, prompt:string): Message[]` | 1 |
| 2346 | withSubagentMeta | function |  | `(args:unknown, lookup:(id: string) => { agent: string; description: string } \| undefined): unknown` | 1 |
| 2364 | subagentDisplayArgs | function |  | `(name:string, args:unknown, lookup:(id: string) => { agent: string; description: string }…): unknown` | 2 |
| 2375 | closeDanglingTail | function |  | `(messages:Message[]): void` | 2 |
| 2392 | buildSubagentSystem | function |  | `(def:SubagentDef, workspaceRoot:string \| null): string` | 1 |
| 2545 | registerChatIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 2559 | emit | function |  | `(turnId:string, sessionId:string, event:ChatStreamEvent): void` | 86 |
| 2564 | emitTodos | function |  | `(s:StoredSession): void` | 4 |
| 2569 | emitTurnStart | function |  | `(turnId:string, sessionId:string, history:Message[]): void` | 5 |
| 2585 | notifyTitle | function |  | `(sessionId:string): string` | 3 |
| 2599 | notifyPending | function |  | `(turnId:string, sessionId:string, input:PendingInput): void` | 4 |
| 2606 | setBackgroundState | function |  | `(sessionId:string, toolUseId:string, state:'running' \| 'ok' \| 'error', summary:string): void` | 2 |
| 2619 | enqueueNotice | function |  | `(sessionId:string, n:PendingNotice): void` | 6 |
| 2631 | wakeForNotices | function |  | `(sessionId:string): void` | 5 |
| 2663 | emitInserts | function |  | `(sessionId:string): void` | 2 |
| 2668 | insertMessage | function |  | `(req:ChatInsertRequest, fromRemote=false): ChatInsertResult` | 3 |
| 2683 | takeInserts | function |  | `(sessionId:string): string \| null` | 4 |
| 2717 | memberProgress | function |  | `(mainId:string): MemberProgressGroup[]` | 1 |
| 2720 | nameOf | arrow |  | `(sid:string): string \| undefined` | 4 |
| 2742 | emitMemberProgress | function |  | `(mainId:string): void` | 4 |
| 2749 | noteMemberDone | function |  | `(mainId:string, group:string, sid:string, status:MemberRunStatus \| null): void` | 1 |
| 2766 | addMemberReport | function |  | `(mainId:string, report:MemberReport): void` | 1 |
| 2779 | commitMemberReports | function |  | `(mainId:string): void` | 3 |
| 2835 | addHandoff | function |  | `(mainId:string, h:Handoff): void` | 3 |
| 2849 | commitHandoffs | function |  | `(mainId:string): void` | 2 |
| 2896 | deliverResult | function |  | `(task:TaskRecord, ownerId:string, tc:{ id: string; name: string; args: unknown }, model:C…): MemberToolResult` | 1 |
| 2945 | finishInform | function |  | `(turnId:string, endReason:StopReason, replyText:string): TurnOutcome['handoff']` | 1 |
| 2966 | memberFolder | function |  | `(m:MemberRef): string \| null` | 2 |
| 2972 | memberItem | function |  | `(m:MemberRef, mainRoot:string \| null): MemberListingItem` | 4 |
| 2982 | memberListing | function |  | `(mainId:string): MemberListingItem[]` | 1 |
| 3003 | ownedTasks | function |  | `(main:StoredSession): TaskRecord[]` | 4 |
| 3007 | findOwnedTask | function |  | `(main:StoredSession, name:string): TaskRecord \| undefined` | 1 |
| 3014 | taskGist | function |  | `(t:TaskRecord): string` | 2 |
| 3020 | taskItem | function |  | `(t:TaskRecord): MemberListingItem` | 0 |
| 3032 | taskStatusBlock | function |  | `(main:StoredSession, t:TaskRecord, ago:(at: number) => string): string` | 1 |
| 3064 | askTask | function |  | `(main:StoredSession, task:TaskRecord, subjectRaw:string, note:string, toolUseId:string, m…): MemberToolResult` | 1 |
| 3116 | stopTask | function |  | `(task:TaskRecord): MemberToolResult` | 1 |
| 3128 | reportTaskAsk | function |  | `(sub:StoredSession, endReason:StopReason, text:string, error:string \| undefined): void` | 1 |
| 3168 | memberModelRef | function |  | `(m:MemberRef, main:StoredSession): string` | 2 |
| 3182 | addMember | function |  | `(main:StoredSession, p:{ name: string; root: string \| null; duty: string; origin: MemberR…): { ref: MemberRef; restored: boolean } …` | 2 |
| 3235 | resumeMemberTask | function |  | `(sub:StoredSession, model:ChatModelConfig): boolean` | 1 |
| 3256 | noteMemberDirectTask | function |  | `(sub:StoredSession, text:string): void` | 1 |
| 3267 | markMemberSetting | function |  | `(sub:StoredSession, field:'modelSet' \| 'effortSet'): void` | 2 |
| 3278 | setMemberFolder | function |  | `(sub:StoredSession, folder:string \| null): void` | 2 |
| 3294 | createMember | function |  | `(main:StoredSession, rawName:string, folder:string, duty:string): MemberToolResult` | 1 |
| 3296 | fail | arrow |  | `(content:string, summary='未能添加成员'): MemberToolResult` | 50 |
| 3335 | sendToMember | function |  | `(main:StoredSession, member:MemberRef, task:string, note:string, toolUseId:string, model:…): MemberToolResult` | 1 |
| 3427 | stopMember | function |  | `(main:StoredSession, member:MemberRef): MemberToolResult` | 1 |
| 3448 | memberStatus | function |  | `(main:StoredSession, rawName:string): MemberToolResult` | 1 |
| 3463 | ago | arrow |  | `(t:number): string` | 2 |
| 3470 | waitingOf | arrow |  | `(id:string): string` | 1 |
| 3524 | rosterNames | function |  | `(main:StoredSession): string` | 2 |
| 3534 | mainMemberTool | function |  | `async (mainId:string, tc:{ id: string; name: string; args: unknown }, model:ChatModelConfig, tu…): Promise<MemberToolResult>` | 1 |
| 3543 | str | arrow |  | `(k:string): string` | 56 |
| 3574 | memberSideTool | function |  | `async (memberId:string, tc:{ id: string; name: string; args: unknown }): Promise<MemberToolResult>` | 1 |
| 3611 | reportMemberTurn | function |  | `(sub:StoredSession, endReason:StopReason, text:string, error:string \| undefined, model:Ch…): void` | 1 |
| 3770 | handleMentions | function |  | `(main:StoredSession, text:string): ContentPart \| null` | 1 |
| 3774 | has | arrow |  | `(name:string): boolean` | 265 |
| 3852 | flushInserts | function |  | `(sessionId:string, endReason:StopReason): boolean` | 1 |
| 3856 | giveBack | arrow |  | `(): void` | 1 |
| 3870 | askUser | function |  | `(turnId:string, sessionId:string, questions:AskQuestion[]): Promise<string[] \| null>` | 1 |
| 3885 | reviewPlan | function |  | `(turnId:string, sessionId:string, plan:string): Promise<PlanVerdict \| null>` | 1 |
| 3901 | requestMount | function |  | `(turnId:string, sessionId:string, tool:string, path:string, member?:string): Promise<string \| null>` | 2 |
| 3920 | runAgentLoop | function |  | `async (args:AgentLoopArgs): Promise<{
    text: string
    stopRea…` | 2 |
| 3963 | runsInBackground | arrow |  | `(callArgs:unknown): boolean` | 2 |
| 3980 | prepareNewSubagent | function |  | `(tc:{
      id: string
      args: unknown
    }): { label: string; note: string; rec?: S…` | 1 |
| 4027 | prepareContinueSubagent | function |  | `(tc:{
      id: string
      args: unknown
    }): { label: string; note: string; rec?: S…` | 1 |
| 4071 | runSubagentLoop | function |  | `async (rec:SubagentRecord, tc:{ id: string }, bg?:AbortController): Promise<{ conclusion: string; isErr: b…` | 2 |
| 4138 | runSubagentCall | function |  | `async (tc:{
      id: string
      name: string
      args: unknown
    }): Promise<{ conclusion: string; isErr: b…` | 1 |
| 4185 | launchBackgroundSubagent | function |  | `(tc:{ id: string; name: string; args: unknown }, rec:SubagentRecord, note:string): { conclusion: string; isErr: boolean }` | 1 |
| 4277 | fillUnrun | function |  | `async (calls:{ id: string; name: string }[], resultParts:ContentPart[], subRuns:Map<string, Pro…): Promise<void>` | 3 |
| 4375 | hasTool | arrow |  | `(n:string): boolean` | 1 |
| 4424 | usageGated | arrow |  | `(name:string): boolean` | 2 |
| 4639 | cutLoop | arrow |  | `(t:string): string` | 2 |
| 5359 | compactWithStatus | function |  | `async (turnId:string, sessionId:string, args:Parameters<typeof compactSession>[0]): ReturnType<typeof compactSession>` | 3 |
| 5386 | midTurnCompactor | function |  | `(turnId:string, sessionId:string, session:StoredSession, model:CompactModelConfig, contro…): () => Promise<boolean>` | 1 |
| 5428 | runTurn | function |  | `async (sessionId:string, turnId:string, config:ChatModelConfig, workspaceRoot:string \| null, tr…): Promise<TurnOutcome>` | 5 |
| 5547 | turnProducedVisible | arrow |  | `(): boolean` | 2 |
| 5567 | recordTurnNotice | arrow |  | `(stopReason:StopReason, errorMessage?:string): void` | 2 |
| 5585 | finishDuration | arrow |  | `(): number` | 2 |
| 5867 | runScheduledTurn | function |  | `async (task:TaskRecord): Promise<ScheduledTurnResult>` | 0 |
| 5869 | fail | arrow |  | `(message:string): ScheduledTurnResult` | 50 |
| 5955 | sendMessage | function |  | `async (payload:ChatSendRequest, fromRemote=false): Promise<{ turnId: string }>` | 3 |
| 5964 | startTurn | function |  | `async (payload:ChatSendRequest, trigger:TurnTrigger): Promise<{ turnId: string; done: Promis…` | 2 |
| 5968 | busyError | arrow |  | `(): Error` | 2 |
| 6090 | ipc:chat:send | ipc |  | `(_e, payload:ChatSendRequest)` | 0 |
| 6093 | ipc:chat:insert | ipc |  | `(_e, payload:ChatInsertRequest): ChatInsertResult` | 0 |
| 6094 | ipc:chat:withdraw-inserts | ipc |  | `(_e, sessionId:string): { text: string }` | 0 |
| 6103 | ipc:chat:compact | ipc |  | `async (_e, payload:ChatCompactRequest): Promise<{ turnId: string }>` | 0 |
| 6153 | ipc:chat:create-session | ipc |  | `(_e, payload:ChatCreateSessionRequest): { ok: true }` | 0 |
| 6165 | ipc:chat:set-model | ipc |  | `(_e, payload:ChatSetModelRequest): { ok: boolean }` | 0 |
| 6177 | ipc:chat:set-effort | ipc |  | `(_e, payload:ChatSetEffortRequest): { ok: true }` | 0 |
| 6190 | ipc:chat:set-focus | ipc |  | `(_e, payload:ChatSetFocusRequest): { ok: true }` | 0 |
| 6209 | ipc:chat:rename-session | ipc |  | `(_e, payload:ChatRenameSessionRequest): { title: string } \| null` | 0 |
| 6226 | ipc:chat:set-archived | ipc |  | `(_e, payload:ChatSetArchivedRequest): { ok: boolean }` | 0 |
| 6235 | ipc:chat:list-sessions | ipc |  | `(_e, _workspaceRoot:string \| null): ChatSessionMeta[]` | 0 |
| 6252 | loadDisplay | function |  | `(sessionId:string): DisplayMessage[]` | 2 |
| 6261 | displayOf | function |  | `(s:StoredSession): DisplayMessage[]` | 5 |
| 6279 | ipc:chat:load-session | ipc |  | `(_e, sessionId:string, _workspaceRoot:string \| null): DisplayMessage[]` | 0 |
| 6287 | ipc:chat:attachment-image | ipc |  | `(_e, sessionId:unknown, ref:unknown, full:unknown): string \| null` | 0 |
| 6308 | ipc:chat:attach-session | ipc |  | `(_e, sessionId:string): { messages: DisplayMessage[]; turnId: …` | 0 |
| 6322 | resolveProposal | function |  | `(sessionId:string, toolUseId:string, status:'accepted' \| 'rejected'): boolean` | 5 |
| 6333 | ipc:chat:resolve-proposal | ipc |  | `(_e, sessionId:string, toolUseId:string, status:'accepted' \| 'rejected'): { ok: boolean }` | 0 |
| 6343 | resolveAutotask | function |  | `(sessionId:string, toolUseId:string, action:'create' \| 'dismiss', taskInput?:TaskCreateIn…): ResolveAutotaskResult` | 5 |
| 6383 | ipc:chat:resolve-autotask | ipc |  | `(_e, sessionId:string, toolUseId:string, action:'create' \| 'dismiss', taskInput?:TaskCrea…): ResolveAutotaskResult` | 0 |
| 6393 | purgeSession | function |  | `(sessionId:string): void` | 2 |
| 6415 | ipc:chat:delete-session | ipc |  | `(_e, sessionId:string, _workspaceRoot:string \| null): { ok: true }` | 0 |
| 6428 | ipc:chat:remove-member | ipc |  | `(_e, sessionId:string, memberSessionId:string): { ok: boolean }` | 0 |
| 6446 | abortTurn | function |  | `(turnId:string, cause?:'deleted'): void` | 6 |
| 6466 | ipc:chat:abort | ipc |  | `(_e, turnId:string): { ok: true }` | 0 |
| 6475 | ipc:chat:stop-subagent | ipc |  | `(_e, sessionId:string, toolUseId:string): { ok: boolean }` | 0 |
| 6487 | ipc:chat:reset | ipc |  | `(_e, sessionId:string, _workspaceRoot:string \| null): { ok: true }` | 0 |
| 6519 | ipc:chat:delete-turns | ipc |  | `(_e, sessionId:string, _workspaceRoot:string \| null, turnIndices:number[]): DisplayMessage[]` | 0 |
| 6538 | ipc:chat:todos | ipc |  | `(_e, sessionId:string): TodoState` | 0 |
| 6545 | ipc:chat:todo-cancel | ipc |  | `(_e, sessionId:string): TodoState` | 0 |
| 6568 | ipc:chat:rewind-list | ipc |  | `(_e, sessionId:string): { turns: RewindTurnStat[]; canUndo: bo…` | 0 |
| 6578 | ipc:chat:rewind-preview | ipc |  | `async (_e, sessionId:string, turn:number): Promise<{ files: RewindFile[]; command…` | 0 |
| 6594 | ipc:chat:rewind-apply | ipc |  | `async (_e, req:ChatRewindApplyRequest): Promise<
      \| {
          ok: true
…` | 0 |
| 6686 | ipc:chat:rewind-undo | ipc |  | `async (_e, sessionId:string): Promise<
      \| { ok: true; messages:…` | 0 |
| 6717 | answerAsk | function |  | `(payload:AskResponse): boolean` | 3 |
| 6731 | decidePlan | function |  | `(payload:PlanResponse): boolean` | 2 |
| 6751 | ipc:chat:ask-response | ipc |  | `(_e, payload:AskResponse): { ok: boolean }` | 0 |
| 6755 | ipc:chat:plan-response | ipc |  | `(_e, payload:PlanResponse): { ok: boolean }` | 0 |
| 6759 | ipc:chat:mount-response | ipc |  | `(_e, payload:MountResponse): { ok: boolean }` | 0 |
| 6767 | answerMount | function |  | `(payload:MountResponse): boolean` | 2 |

### `apps/desktop/src/main/services/checkpoints.ts`（24 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 69 | checkpointDirName | function | export | `(id:string): string` | 2 |
| 73 | checkpointsRoot | function |  | `(): string` | 2 |
| 78 | sessionDir | function |  | `(id:string): string \| null` | 9 |
| 84 | pathKey | function |  | `(p:string): string` | 5 |
| 90 | realOf | function |  | `(abs:string): string` | 2 |
| 103 | sha256 | function |  | `(buf:Buffer): string` | 5 |
| 108 | writeBlob | function |  | `async (dir:string, hash:string, buf:Buffer): Promise<void>` | 1 |
| 134 | readBlob | function |  | `async (sessionId:string, hash:string): Promise<Buffer \| null>` | 2 |
| 152 | readDisk | function |  | `async (abs:string): Promise<DiskState>` | 3 |
| 166 | statsBetween | function |  | `(from:Buffer \| null, to:Buffer \| null): { added?: number; removed?: number; ap…` | 2 |
| 199 | maxSeq | function |  | `(s:StoredSession): number` | 1 |
| 209 | createRecorder | function | export | `(s:StoredSession): Recorder` | 1 |
| 282 | enforceCap | function | export | `(s:StoredSession, turnIds:string[][], max=MAX_TURNS): void` | 2 |
| 285 | holdsBlob | arrow |  | `(ids:string[]): boolean` | 0 |
| 302 | gcBlobs | function | export | `async (s:StoredSession): Promise<void>` | 1 |
| 332 | sweepCheckpoints | function | export | `async (liveIds:Iterable<string>): Promise<void>` | 2 |
| 366 | removeSessionCheckpoints | function | export | `(id:string): void` | 2 |
| 389 | summarizeTurns | function | export | `(s:StoredSession, turnIds:string[][]): RewindTurnStat[]` | 1 |
| 441 | displayPath | function |  | `(abs:string, focusRoot:string \| null): string` | 3 |
| 454 | planRewind | function | export | `async (s:StoredSession, ownerIds:Iterable<string>, focusRoot:string \| null): Promise<RewindPlan>` | 2 |
| 529 | publicPreview | function | export | `(plan:RewindPlan): { files: RewindFile[]; commands: strin…` | 1 |
| 564 | applyFiles | function | export | `async (s:StoredSession, plan:RewindPlan, force:Set<string>): Promise<ApplyResult>` | 1 |
| 598 | undoFiles | function | export | `async (undo:UndoFile[]): Promise<{ restored: string[]; skipped:…` | 1 |
| 625 | buildRestoreNote | function | export | `(rels:string[]): string` | 1 |

### `apps/desktop/src/main/services/clipboard.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | registerClipboardIpc | function | export | `(): void` | 2 |
| 15 | ipc:clipboard:read-text | ipc |  | `(): string` | 0 |
| 18 | ipc:clipboard:write-text | ipc |  | `(_e, text:unknown): { ok: true }` | 0 |

### `apps/desktop/src/main/services/compaction.ts`（30 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 69 | insertText | function | export | `(body:string, en:boolean): string` | 1 |
| 77 | insertBody | function | export | `(text:string): string \| null` | 2 |
| 98 | compactionConfig | function | export | `(): CompactionCfg` | 5 |
| 124 | rememberContextLimit | function | export | `(model:LimitModelRef, limit:number): boolean` | 1 |
| 138 | rememberOutputBudget | function | export | `(model:LimitModelRef, budget:number): void` | 1 |
| 143 | learnedOutputBudget | function | export | `(model:LimitModelRef): number \| undefined` | 2 |
| 148 | contextWindowFor | function | export | `(model:LimitModelRef, cfg:CompactionCfg=compactionConfig()): number` | 4 |
| 170 | triggerTokens | function |  | `(model:LimitModelRef, cfg:CompactionCfg): number` | 2 |
| 186 | partTokens | function |  | `(p:ContentPart): number` | 1 |
| 203 | messageTokens | function |  | `(m:Message): number` | 3 |
| 211 | estimateTokens | function | export | `(messages:Message[]): number` | 5 |
| 218 | needsCompaction | function | export | `(session:StoredSession, model:LimitModelRef, cfg:CompactionCfg=compactionConfig()): boolean` | 1 |
| 237 | needsCompactionMidTurn | function | export | `(messages:Message[], model:LimitModelRef, lastInput:number, lastInputAt:number, cfg:Compa…): boolean` | 1 |
| 249 | usedTokensMidTurn | function |  | `(messages:Message[], lastInput:number, lastInputAt:number): number` | 2 |
| 260 | compactionWorthRetry | function | export | `(messages:Message[], model:LimitModelRef, lastInput:number, lastInputAt:number, cfg:Compa…): boolean` | 1 |
| 274 | hasToolUse | function |  | `(m:Message): boolean` | 2 |
| 283 | modelView | function |  | `(messages:Message[]): { view: Message[]; toRecord: (i: numbe…` | 1 |
| 296 | pickBoundary | function | export | `(messages:Message[], keepTokens:number): number` | 1 |
| 329 | pickInTurnCut | function |  | `(messages:Message[], start:number, keepTokens:number): number` | 1 |
| 369 | transcriptBudget | function |  | `(window:number): number` | 1 |
| 374 | buildTranscript | function | export | `(messages:Message[], locale:string, maxChars=MIN_TRANSCRIPT_CHARS): string` | 1 |
| 383 | clip | arrow |  | `(s:string, max:number): string` | 22 |
| 467 | sleep | function |  | `(ms:number, signal:AbortSignal): Promise<void>` | 10 |
| 469 | done | arrow |  | `(): void` | 7 |
| 488 | summarize | function |  | `async (model:CompactModelConfig, transcript:string, locale:string, signal:AbortSignal, midTurn=…): Promise<string>` | 6 |
| 515 | onAbort | arrow |  | `(): void` | 0 |
| 586 | keepTokensFor | function |  | `(window:number): number` | 2 |
| 596 | compactSession | function | export | `async (args:{
  session: StoredSession
  model: CompactModelConfig
  signal: AbortSignal
  /**
…): Promise<{ status: CompactStatus; messa…` | 1 |
| 702 | displaySummary | function | export | `(content:string): string` | 1 |
| 711 | isTaskNotification | function | export | `(m:Message): boolean` | 4 |

### `apps/desktop/src/main/services/config.ts`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 17 | getDevaHome | function | export | `(): string` | 16 |
| 29 | configPath | function |  | `(): string` | 2 |
| 37 | ensureLoaded | function |  | `(): void` | 27 |
| 50 | persist | function |  | `(): void` | 18 |
| 62 | getConfig | function | export | `(): Record<string, unknown>` | 25 |
| 72 | setConfig | function | export | `(patch:Record<string, unknown>): void` | 9 |
| 82 | registerConfigIpc | function | export | `(): void` | 2 |
| 86 | ipc:config:get-sync | ipc |  | `(evt)` | 0 |
| 92 | ipc:config:get | ipc |  | `()` | 0 |
| 98 | ipc:config:set | ipc |  | `(_e, patch:Record<string, unknown>)` | 0 |

### `apps/desktop/src/main/services/decision.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 73 | normalizeBase | function |  | `(url:string): string` | 2 |
| 77 | clamp01 | function |  | `(n:unknown): number` | 4 |
| 84 | fetchWithTimeout | function |  | `async (url:string, init:RequestInit): Promise<Response>` | 2 |
| 94 | networkError | function |  | `(e:unknown): NormalizedError` | 2 |
| 113 | stateToText | function |  | `(state:DecisionState): string` | 1 |
| 123 | buildJevQuestions | function |  | `(questions:DecisionQuestion[]): Record<string, unknown>` | 1 |
| 138 | answerConfidence | function |  | `(answer:unknown): { confidence: number; reason?: string }` | 1 |
| 156 | decideJev | function |  | `async (cfg:DecisionConfig, state:DecisionState, questions:DecisionQuestion[]): Promise<DecisionResult>` | 1 |
| 197 | decide | function | export | `async (cfg:DecisionConfig, state:DecisionState, questions:DecisionQuestion[]): Promise<DecisionResult>` | 0 |

### `apps/desktop/src/main/services/default-personas.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/main/services/deliverables.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 39 | deliveredPaths | function |  | `(sessionId:unknown, toolUseId:unknown): string[]` | 2 |
| 59 | deliveredPath | function |  | `(sessionId:unknown, toolUseId:unknown, index:unknown): string \| null` | 3 |
| 64 | isFile | function |  | `async (p:string): Promise<boolean>` | 16 |
| 69 | registerDeliverablesIpc | function | export | `(): void` | 2 |
| 72 | ipc:deliverables:inspect | ipc |  | `async (_e, sessionId:unknown, toolUseId:unknown): Promise<DeliverableInfo[]>` | 0 |
| 90 | ipc:deliverables:thumbnail | ipc |  | `async (_e, sessionId:unknown, toolUseId:unknown, index:unknown): Promise<string \| null>` | 0 |
| 110 | ipc:deliverables:open | ipc |  | `async (_e, sessionId:unknown, toolUseId:unknown, index:unknown): Promise<{ ok: boolean }>` | 0 |
| 120 | ipc:deliverables:reveal | ipc |  | `async (_e, sessionId:unknown, toolUseId:unknown, index:unknown): Promise<{ ok: boolean }>` | 0 |

### `apps/desktop/src/main/services/deva-personas.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/main/services/exec-policy.ts`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 17 | findGitBashOnPath | function |  | `(): string \| null` | 1 |
| 50 | resolveExecShell | function | export | `(): ExecShell` | 1 |

### `apps/desktop/src/main/services/ext-roles.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 15 | section | function |  | `(name:ExtSection): Record<string, unknown>` | 2 |
| 20 | rolesMap | function |  | `(name:ExtSection): Record<string, string[]>` | 3 |
| 30 | writeRolesMap | function |  | `(name:ExtSection, map:Record<string, string[]>): void` | 2 |
| 35 | getRoles | function | export | `(name:ExtSection, id:string): string[] \| null` | 4 |
| 40 | setRoles | function | export | `(name:ExtSection, id:string, roles:string[] \| null): void` | 9 |
| 52 | allowsPersona | function | export | `(name:ExtSection, id:string, personaId:string): boolean` | 2 |
| 67 | pruneRoles | function | export | `(keep:(personaId: string) => boolean): OrphanedExts` | 1 |

### `apps/desktop/src/main/services/frontmatter.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 19 | stripQuotes | function |  | `(v:string): string` | 4 |
| 31 | parseInlineArray | function |  | `(v:string): string[]` | 1 |
| 43 | parseFrontmatter | function | export | `(raw:string): ParsedFrontmatter` | 3 |
| 112 | fmString | function | export | `(data:Record<string, FmValue>, key:string): string` | 10 |
| 123 | fmArray | function | export | `(data:Record<string, FmValue>, key:string): string[]` | 1 |
| 145 | fmMap | function | export | `(data:Record<string, FmValue>, key:string): Record<string, string>` | 1 |
| 151 | fmScalar | function | export | `(v:string): string` | 7 |

### `apps/desktop/src/main/services/fs-guard.ts`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 20 | realResolve | function |  | `(p:string): string` | 4 |
| 40 | realResolveAsync | function |  | `async (p:string): Promise<string>` | 1 |
| 59 | trustRoot | function | export | `(dir:string): void` | 5 |
| 64 | untrustRoot | function | export | `(dir:string): void` | 0 |
| 69 | listRoots | function | export | `(): string[]` | 0 |
| 79 | isInsideRoot | function | export | `(target:string): boolean` | 2 |
| 90 | assertInside | function | export | `(target:string): void` | 28 |
| 99 | insideRootFlags | function | export | `async (targets:string[]): Promise<boolean[]>` | 2 |
| 110 | assertAllInside | function | export | `async (targets:string[]): Promise<void>` | 1 |
| 118 | isWithinDir | function | export | `(target:string, dir:string \| null): boolean` | 0 |

### `apps/desktop/src/main/services/git.ts`（52 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 113 | readGitPathOverride | function |  | `(): string \| null` | 1 |
| 126 | findGitOnPath | function |  | `(): string \| null` | 1 |
| 137 | findGitFromBash | function |  | `(): string \| null` | 1 |
| 152 | resolveGitPath | function |  | `(): string \| null` | 2 |
| 180 | runGitRaw | function |  | `(cwd:string \| undefined, args:string[], timeout=DEFAULT_TIMEOUT, input?:string): Promise<RunResult>` | 7 |
| 225 | runGit | function |  | `(dir:string, args:string[], timeout=DEFAULT_TIMEOUT, input?:string): Promise<RunResult>` | 24 |
| 240 | runGitPaths | function |  | `(dir:string, args:string[], paths:string[]): Promise<RunResult>` | 4 |
| 253 | emptyStatus | function |  | `(root:string): GitStatus` | 1 |
| 271 | letterFor | function |  | `(c:string): GitStatusLetter` | 2 |
| 288 | mkFile | function |  | `(root:string, rel:string, letter:GitStatusLetter, flags:{ staged: boolean; unstaged: bool…): GitFileStatus` | 4 |
| 311 | parsePorcelainV2 | function |  | `(stdout:string, root:string): Omit<GitStatus, 'isRepo' \| 'root' \| 'r…` | 1 |
| 386 | pushXY | function |  | `(root:string, rel:string, xy:string, staged:GitFileStatus[], unstaged:GitFileStatus[]): void` | 2 |
| 418 | parseUnifiedDiff | function |  | `(text:string): GitDiffLine[]` | 1 |
| 456 | looksBinary | function |  | `(buf:Buffer): boolean` | 8 |
| 463 | diffUntracked | function |  | `async (absPath:string): Promise<GitDiffLine[]>` | 2 |
| 483 | classifyRemoteError | function |  | `(stderr:string): GitFailReason` | 5 |
| 498 | classifyCommitError | function |  | `(stderr:string): GitFailReason` | 1 |
| 506 | safeAbsPaths | function |  | `async (paths:unknown): Promise<string[]>` | 4 |
| 514 | safeRef | function |  | `(ref:unknown): ref is string` | 7 |
| 518 | listRemotes | function |  | `async (dir:string): Promise<string[]>` | 3 |
| 562 | normGenLocale | function |  | `(v:unknown): GenLocale` | 1 |
| 571 | commitSystemPrompt | function |  | `(locale:GenLocale, doc:ProjectDoc \| null): string` | 1 |
| 587 | commitUserText | function |  | `(locale:GenLocale, patch:string, truncated:boolean): string` | 1 |
| 603 | cleanCommitMessage | function |  | `(raw:string): string` | 2 |
| 615 | genReason | function |  | `(kind:string): GitFailReason` | 1 |
| 623 | registerGitIpc | function | export | `(): void` | 2 |
| 625 | ipc:git:available | ipc |  | `async ()` | 0 |
| 638 | ipc:git:status | ipc |  | `async (_e, dir:string): Promise<GitStatus>` | 0 |
| 653 | keepInside | arrow |  | `async (list:GitFileStatus[]): Promise<GitFileStatus[]>` | 3 |
| 683 | ipc:git:diff | ipc |  | `async (_e, dir:string, filePath:string, opts:{ staged?: boolean; untracked?: boolean }={}): Promise<GitDiffLine[]>` | 0 |
| 703 | ipc:git:stage | ipc |  | `async (_e, dir:string, paths:string[])` | 0 |
| 712 | ipc:git:unstage | ipc |  | `async (_e, dir:string, paths:string[])` | 0 |
| 727 | ipc:git:discard | ipc |  | `async (_e, dir:string, trackedPaths:string[], untrackedPaths:string[])` | 0 |
| 740 | ipc:git:commit | ipc |  | `async (_e, dir:string, message:string)` | 0 |
| 758 | ipc:git:set-config | ipc |  | `async (_e, dir:string, name:string, email:string, global:boolean)` | 0 |
| 770 | ipc:git:branches | ipc |  | `async (_e, dir:string): Promise<GitBranch[]>` | 0 |
| 797 | ipc:git:checkout | ipc |  | `async (_e, dir:string, ref:string)` | 0 |
| 807 | ipc:git:create-branch | ipc |  | `async (_e, dir:string, name:string, checkout:boolean)` | 0 |
| 817 | ipc:git:checkout-remote | ipc |  | `async (_e, dir:string, remoteRef:string)` | 0 |
| 827 | ipc:git:merge | ipc |  | `async (_e, dir:string, ref:string)` | 0 |
| 838 | ipc:git:merge-abort | ipc |  | `async (_e, dir:string)` | 0 |
| 845 | ipc:git:delete-branch | ipc |  | `async (_e, dir:string, name:string, force:boolean)` | 0 |
| 859 | ipc:git:rename-branch | ipc |  | `async (_e, dir:string, oldName:string, newName:string)` | 0 |
| 867 | ipc:git:delete-remote-branch | ipc |  | `async (_e, dir:string, remote:string, branch:string)` | 0 |
| 878 | ipc:git:log | ipc |  | `async (_e, dir:string, depth=30): Promise<GitCommit[]>` | 0 |
| 893 | ipc:git:init | ipc |  | `async (_e, dir:string)` | 0 |
| 900 | ipc:git:fetch | ipc |  | `async (_e, dir:string)` | 0 |
| 909 | ipc:git:pull | ipc |  | `async (_e, dir:string)` | 0 |
| 918 | ipc:git:push | ipc |  | `async (_e, dir:string, setUpstreamBranch:string \| null)` | 0 |
| 936 | ipc:git:generate-commit-message | ipc |  | `async (e, dir:string, model:GenModelConfig, locale?:GenLocale, reqId?:string)` | 0 |
| 980 | onGone | arrow |  | `(): void` | 0 |
| 1032 | ipc:git:cancel-commit-message | ipc |  | `(_e, reqId:string): boolean` | 0 |

### `apps/desktop/src/main/services/handoff.ts`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 54 | handoffTool | function | export | `(owner:string): ToolSpec` | 1 |
| 93 | parseHandoffArgs | function | export | `(args:unknown): HandoffInput \| string` | 1 |
| 95 | str | arrow |  | `(k:string): string` | 56 |
| 109 | headOf | function | export | `(text:string): string` | 4 |
| 124 | buildHandoffBody | function | export | `(title:string, h:HandoffInput): string` | 3 |
| 141 | parseHandoff | function | export | `(text:string): HandoffInfo \| null` | 2 |
| 171 | textOf | function |  | `(m:Message): string` | 1 |
| 181 | eachInform | function |  | `(history:Message[], visit:(i: number, h: HandoffInfo, head: string, body: string) => void): void` | 2 |
| 203 | stubLongInforms | function | export | `(history:Message[]): Message[]` | 2 |
| 234 | lastInformBody | function | export | `(history:Message[], title:string): string` | 1 |

### `apps/desktop/src/main/services/image-read.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | sniffImageMime | function | export | `(buf:Buffer): ImageMime \| null` | 3 |
| 57 | thumbnailDataUrl | function | export | `(buf:Buffer, mime:string): string` | 2 |
| 58 | original | arrow |  | `(): string` | 3 |
| 78 | formatBytes | function | export | `(n:number): string` | 7 |
| 104 | prepareImage | function | export | `(buf:Buffer, mime:ImageMime, name?:string): PreparedImage` | 3 |
| 105 | make | arrow |  | `(data:Buffer, mediaType:string): ImagePart` | 3 |
| 143 | done | arrow |  | `(data:Buffer, mediaType:string): PreparedImage` | 7 |

### `apps/desktop/src/main/services/image-trim.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 23 | trimmedNote | function |  | `(removed:number, total:number): string` | 1 |
| 30 | trimResult | function |  | `(p:ToolResultPart, keep:(img: ImagePart) => boolean): ToolResultPart` | 1 |
| 41 | trimHistoryImages | function | export | `(history:Message[]): Message[]` | 1 |

### `apps/desktop/src/main/services/line-stats.ts`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 26 | splitLines | function |  | `(s:string): string[]` | 3 |
| 34 | myersDistance | function |  | `(a:string[], b:string[], maxD:number): number` | 1 |
| 60 | multisetStats | function |  | `(a:string[], b:string[]): { added: number; removed: number }` | 1 |
| 74 | lineStats | function | export | `(before:string, after:string): LineStats` | 1 |
| 101 | lineCount | function | export | `(s:string): number` | 2 |

### `apps/desktop/src/main/services/listing.ts`（16 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 30 | digestOf | function |  | `(content:string): string` | 5 |
| 35 | announced | function |  | `(history:Message[], kind:ListingKind): Map<string, string>` | 2 |
| 60 | diffListing | function |  | `(history:Message[], kind:ListingKind, items:T[], key:(t: T) => string, content:(t: T) => …): ListingDiff<T> \| null` | 3 |
| 91 | attachListing | function | export | `(history:Message[], build:(history: Message[]) => TextPart \| null \| (TextPart \| null)[]): void` | 3 |
| 115 | skillLine | function |  | `(s:SkillSummary): string` | 0 |
| 120 | skillListingPart | function | export | `(history:Message[], skills:SkillSummary[]): TextPart \| null` | 1 |
| 147 | withinBudget | function |  | `(entries:MemoryEntry[], budget:number): { kept: MemoryEntry[]; omitted: number }` | 2 |
| 163 | memoryListingPart | function | export | `(history:Message[], root:string \| null): TextPart \| null` | 1 |
| 193 | memoryWrittenRecord | function | export | `(entry:MemoryEntry): ListingRecord` | 1 |
| 198 | memoryDeletedRecord | function | export | `(id:string): ListingRecord` | 1 |
| 208 | guidesAnnounced | function | export | `(history:Message[]): Set<string>` | 2 |
| 213 | guideRecord | function | export | `(entries:{ key: string; text: string }[]): ListingRecord` | 4 |
| 230 | memberLine | function |  | `(m:MemberListingItem): string` | 0 |
| 238 | memberContent | function |  | `(m:MemberListingItem): string` | 1 |
| 252 | memberListingPart | function | export | `(history:Message[], members:MemberListingItem[]): TextPart \| null` | 1 |
| 276 | memberAddedRecord | function | export | `(m:MemberListingItem): ListingRecord` | 2 |

### `apps/desktop/src/main/services/mcp-config.ts`（23 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 61 | mcpFile | function |  | `(): string` | 2 |
| 66 | readAll | function |  | `(): Record<string, StoredServer>` | 4 |
| 78 | writeAll | function |  | `(servers:Record<string, StoredServer>): void` | 2 |
| 87 | isSafeId | function |  | `(id:string): boolean` | 22 |
| 92 | makeId | function |  | `(name:string, existing:Record<string, StoredServer>): string` | 4 |
| 107 | cleanArgs | function |  | `(args:unknown): string[]` | 1 |
| 113 | cleanValueMap | function |  | `(map:unknown): Record<string, McpValue>` | 2 |
| 136 | changeListener | arrow |  | `()` | 2 |
| 142 | onMcpConfigChange | function | export | `(fn:(id: string, change: McpChange) => void): void` | 1 |
| 147 | connectionSig | function |  | `(s:StoredServer): string` | 2 |
| 153 | enabledMap | function |  | `(): Record<string, boolean>` | 11 |
| 160 | writeEnabledMap | function |  | `(map:Record<string, boolean>): void` | 6 |
| 166 | isEnabled | function | export | `(id:string): boolean` | 8 |
| 170 | writeEnabled | function |  | `(id:string, enabled:boolean): void` | 3 |
| 177 | setEnabled | function | export | `(id:string, enabled:boolean): void` | 5 |
| 185 | listServerConfigs | function | export | `(): McpServerConfig[]` | 2 |
| 196 | getServerConfig | function | export | `(id:string): McpServerConfig \| null` | 6 |
| 204 | upsertServer | function | export | `(input:McpServerInput): McpServerConfig` | 2 |
| 245 | deleteServer | function | export | `(id:string): void` | 1 |
| 263 | resolveValueMap | function |  | `async (id:string, map:Record<string, McpValue> \| undefined): Promise<Record<string, string>>` | 2 |
| 284 | missingSecrets | function | export | `async (cfg:McpServerConfig): Promise<string[]>` | 1 |
| 296 | resolveEnv | function | export | `(cfg:McpServerConfig): Promise<Record<string, string>>` | 1 |
| 301 | resolveHeaders | function | export | `(cfg:McpServerConfig): Promise<Record<string, string>>` | 1 |

### `apps/desktop/src/main/services/mcp.ts`（37 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 124 | sendStatus | arrow |  | `()` | 1 |
| 128 | sanitize | function |  | `(s:string): string` | 2 |
| 134 | hash4 | function |  | `(s:string): string` | 1 |
| 141 | makeFqName | function |  | `(serverId:string, toolName:string, used:Set<string>): string` | 1 |
| 156 | viewOf | function |  | `(cfg:McpServerConfig): McpServerView` | 2 |
| 177 | broadcast | function |  | `(id:string): void` | 9 |
| 182 | listServers | function | export | `(): McpServerView[]` | 1 |
| 188 | toSpec | function |  | `(cfg:McpServerConfig, fqName:string, t:Tool): ToolSpec` | 1 |
| 200 | buildTransport | function |  | `async (cfg:McpServerConfig): Promise<Transport>` | 1 |
| 232 | friendlyError | function |  | `(e:unknown): string` | 1 |
| 250 | configProblem | function |  | `(cfg:McpServerConfig): string \| null` | 1 |
| 263 | dropTools | function |  | `(rt:Runtime): void` | 4 |
| 272 | settle | function |  | `(id:string, status:Exclude<McpStatus, 'connecting' \| 'connected'>, lastError:string \| nul…): void` | 9 |
| 295 | connect | function |  | `async (id:string, cfg:McpServerConfig): Promise<boolean>` | 3 |
| 313 | stale | arrow |  | `(): boolean` | 5 |
| 384 | reconcile | function |  | `async (id:string, keepRetry=false): Promise<boolean>` | 5 |
| 414 | cancelDebounce | function |  | `(id:string): void` | 3 |
| 421 | scheduleReconcile | function |  | `(id:string): void` | 2 |
| 432 | clearRetry | function |  | `(id:string): void` | 2 |
| 442 | scheduleRetry | function |  | `(id:string, livedMs:number): void` | 2 |
| 473 | forget | function |  | `(id:string): void` | 4 |
| 492 | disconnectAllServers | function | export | `async (): Promise<void>` | 1 |
| 512 | autoConnectEnabledServers | function | export | `(): void` | 2 |
| 524 | getMcpToolSpecs | function | export | `(personaId:string): ToolSpec[]` | 2 |
| 543 | mcpImage | function |  | `(block:Record<string, unknown>): { part?: ImagePart; note: string }` | 1 |
| 559 | flattenResult | function |  | `(result:RawCallResult, sessionId?:string): ToolResult` | 1 |
| 598 | dispatchMcpTool | function | export | `async (fqName:string, args:unknown, signal?:AbortSignal, sessionId?:string): Promise<ToolResult>` | 1 |
| 628 | registerMcpIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 633 | ipc:mcp:list | ipc |  | `(): McpServerView[]` | 0 |
| 634 | ipc:mcp:get | ipc |  | `(_e, id:string): McpServerConfig \| null` | 0 |
| 635 | ipc:mcp:upsert | ipc |  | `(_e, input:McpServerInput): McpServerConfig` | 0 |
| 636 | ipc:mcp:remove | ipc |  | `(_e, id:string): { ok: true }` | 0 |
| 642 | ipc:mcp:set-roles | ipc |  | `(_e, id:string, roles:string[] \| null): { ok: boolean }` | 0 |
| 649 | ipc:mcp:set-enabled | ipc |  | `(_e, id:string, enabled:boolean): { ok: true }` | 0 |
| 654 | ipc:mcp:retry | ipc |  | `async (_e, id:string): Promise<McpServerView \| null>` | 0 |
| 662 | ipc:mcp:set-secret | ipc |  | `async (_e, id:string, field:string, value:string): Promise<{ ok: boolean; available: bool…` | 0 |
| 675 | ipc:mcp:has-secret | ipc |  | `(_e, id:string, field:string): Promise<boolean>` | 0 |

### `apps/desktop/src/main/services/media-store.ts`（11 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | mediaDir | function |  | `(): string` | 4 |
| 35 | blobFile | function |  | `(hash:string): string` | 2 |
| 44 | isBinaryPart | function |  | `(v:unknown): v is { type: 'image' \| 'document'; med…` | 1 |
| 51 | ensureBlob | function |  | `(hash:string, base64:string): boolean` | 1 |
| 75 | mediaReplacer | function | export | `(_key:string, value:unknown): unknown` | 0 |
| 89 | readBlob | function |  | `(hash:string): string \| null` | 2 |
| 100 | isRef | function |  | `(v:unknown): v is BlobRef` | 2 |
| 105 | hydratePart | function |  | `(p:Record<string, unknown>): boolean` | 2 |
| 119 | hydrateMessages | function | export | `(messages:Message[]): void` | 2 |
| 149 | sweepMedia | function | export | `async (): Promise<void>` | 2 |
| 161 | scan | arrow |  | `async (dir:string): Promise<boolean>` | 3 |

### `apps/desktop/src/main/services/members.ts`（20 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 91 | activeMembers | function | export | `(list:MemberRef[] \| undefined): MemberRef[]` | 6 |
| 96 | findMember | function | export | `(list:MemberRef[] \| undefined, name:string): MemberRef \| undefined` | 3 |
| 106 | rootLabel | function | export | `(root:string \| null, mainRoot:string \| null): string` | 2 |
| 123 | resolveMemberFolder | function | export | `(folder:string, mainRoot:string \| null): string \| null` | 1 |
| 133 | realUserText | function | export | `(m:Message): string \| null` | 2 |
| 145 | assistantText | function |  | `(m:Message): string` | 2 |
| 161 | clipHead | function |  | `(s:string): string` | 1 |
| 164 | clipTail | function |  | `(s:string): string` | 1 |
| 169 | roundsOf | function |  | `(messages:Message[]): Round[]` | 3 |
| 187 | formatRound | function |  | `(r:Round, owner:string): string` | 2 |
| 195 | lastReplyText | function | export | `(memberMessages:Message[]): string` | 1 |
| 207 | lastDirectUserText | function | export | `(memberMessages:Message[]): string` | 1 |
| 217 | recentMainContext | function | export | `(messages:Message[], owner:string, rounds=3): string` | 1 |
| 227 | readMainPage | function | export | `(messages:Message[], owner:string, before?:number): string` | 1 |
| 252 | readMainRound | function | export | `(messages:Message[], owner:string, round:number, offset=0): string` | 1 |
| 283 | buildTaskMessage | function | export | `(p:{ owner: string; task: string; note: string; context: string }): string` | 2 |
| 298 | parseTaskMessage | function | export | `(text:string): ParsedTask \| null` | 1 |
| 337 | mainMemberTools | function | export | `(): ToolSpec[]` | 1 |
| 415 | readMainTool | function | export | `(): ToolSpec` | 1 |
| 437 | reportToMainTool | function | export | `(): ToolSpec` | 1 |

### `apps/desktop/src/main/services/memory.ts`（23 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 62 | memoryLimits | function | export | `(scope:MemoryScope): Limits` | 3 |
| 69 | scopeKindOfId | function | export | `(id:string): MemoryScope['kind']` | 4 |
| 77 | projectMemoryKey | function | export | `(root:string): string` | 1 |
| 89 | memoryPath | function |  | `(scope:MemoryScope): string` | 2 |
| 96 | listMemories | function | export | `(scope:MemoryScope=GLOBAL_SCOPE): MemoryEntry[]` | 7 |
| 120 | saveMemories | function |  | `(scope:MemoryScope, entries:MemoryEntry[]): void` | 4 |
| 130 | newId | function |  | `(scope:MemoryScope, existing:MemoryEntry[]): string` | 1 |
| 140 | normalize | function |  | `(content:string): string` | 1 |
| 145 | memoryUsage | function | export | `(entries:MemoryEntry[]): number` | 3 |
| 156 | scopeLabel | function |  | `(scope:MemoryScope): string` | 3 |
| 160 | budgetError | function |  | `(scope:MemoryScope, used:number): MemoryWriteResult` | 2 |
| 169 | writeMemory | function | export | `(content:string, id?:string, scope:MemoryScope=GLOBAL_SCOPE): MemoryWriteResult` | 2 |
| 223 | deleteMemory | function | export | `(id:string, scope:MemoryScope=GLOBAL_SCOPE): MemoryEntry \| null` | 2 |
| 233 | clearMemories | function | export | `(scope:MemoryScope=GLOBAL_SCOPE): void` | 1 |
| 238 | formatMemoryLine | function | export | `(e:MemoryEntry): string` | 9 |
| 251 | memoryPromptSection | function | export | `(opts:{
  writable: boolean
  projectWritable?: boolean
  root?: string \| null
}): string[]` | 3 |
| 309 | snapshot | function |  | `(scope:MemoryScope): MemorySnapshot` | 10 |
| 328 | ipcScope | function |  | `(root:unknown): MemoryScope` | 4 |
| 338 | registerMemoryIpc | function | export | `(): void` | 2 |
| 339 | ipc:memory:list | ipc |  | `(_e, root?:string): MemorySnapshot` | 0 |
| 340 | ipc:memory:write | ipc |  | `(_e, content:string, id?:string, root?:string): MemoryIpcResult` | 0 |
| 349 | ipc:memory:delete | ipc |  | `(_e, id:string, root?:string): MemoryIpcResult` | 0 |
| 354 | ipc:memory:clear | ipc |  | `(_e, root?:string): MemoryIpcResult` | 0 |

### `apps/desktop/src/main/services/model-resolve.ts`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 41 | resolveRefStrict | function |  | `(ref:string \| null \| undefined): ResolvedModel \| null` | 3 |
| 73 | resolveModelRef | function | export | `(ref:string \| null \| undefined, fallback:ResolvedModel): ResolvedModel` | 2 |
| 85 | resolveModelRefOrNull | function | export | `(ref:string \| null \| undefined): ResolvedModel \| null` | 4 |
| 100 | modelOverrides | function | export | `(providerId:string, modelId:string): ModelOverrides` | 4 |
| 122 | resolveDefaultModel | function | export | `(): ResolvedModel \| null` | 3 |
| 136 | resolveDefaultEffort | function | export | `(): EffortLevel` | 2 |

### `apps/desktop/src/main/services/model-view.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 19 | isCompactionSummary | function | export | `(m:Message): boolean` | 7 |
| 24 | isAutoNudge | function | export | `(m:Message): boolean` | 6 |
| 28 | hasToolResult | function | export | `(m:Message): boolean` | 1 |
| 37 | isGenuineUserTurn | function | export | `(m:Message): boolean` | 3 |
| 42 | lastTurnStart | function | export | `(messages:Message[]): number` | 4 |
| 54 | modelRange | function | export | `(messages:Message[]): { head: number; start: number }` | 4 |
| 68 | modelStart | function | export | `(messages:Message[]): number` | 1 |
| 76 | modelFirst | function | export | `(messages:Message[]): number` | 1 |
| 85 | modelMessages | function | export | `(messages:Message[]): Message[]` | 9 |

### `apps/desktop/src/main/services/office-text.ts`（11 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | decodeXml | function |  | `(s:string): string` | 4 |
| 26 | tidy | function |  | `(s:string): string` | 1 |
| 36 | byNumber | function |  | `(a:string, b:string): number` | 0 |
| 37 | n | arrow |  | `(s:string): number` | 15 |
| 45 | paragraphText | function |  | `(xml:string, ns:'w' \| 'a'): string` | 2 |
| 68 | docxText | function |  | `(files:Record<string, Uint8Array>): string \| null` | 1 |
| 73 | pptxText | function |  | `(files:Record<string, Uint8Array>): string \| null` | 1 |
| 87 | colIndex | function |  | `(ref:string): number` | 1 |
| 95 | runsText | function |  | `(xml:string): string` | 2 |
| 101 | xlsxText | function |  | `(files:Record<string, Uint8Array>): string \| null` | 1 |
| 161 | officeText | function | export | `(buf:Uint8Array, ext:string): string \| null` | 1 |

### `apps/desktop/src/main/services/personas.ts`（36 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 84 | personasDir | function |  | `(): string` | 4 |
| 88 | personaFile | function |  | `(id:string): string` | 7 |
| 95 | avatarsDir | function |  | `(): string` | 3 |
| 99 | readAvatarImage | function |  | `(id:string): string` | 4 |
| 103 | clearAvatarImage | function |  | `(id:string): void` | 5 |
| 107 | writeAvatarImage | function |  | `(id:string, dataUri:string): string` | 2 |
| 112 | enabledMap | function |  | `(): Record<string, boolean>` | 11 |
| 119 | writeEnabledMap | function |  | `(map:Record<string, boolean>): void` | 6 |
| 130 | orderList | function |  | `(): string[]` | 2 |
| 137 | writeOrderList | function |  | `(order:string[]): void` | 2 |
| 144 | isSafeId | function |  | `(id:string): boolean` | 22 |
| 153 | makeId | function |  | `(name:string): string` | 4 |
| 168 | parsePersona | function |  | `(id:string, raw:string, enabled:boolean, withImage:boolean): PersonaRecord` | 2 |
| 187 | listPersonas | function | export | `(withImages=false): PersonaRecord[]` | 5 |
| 223 | getPersona | function | export | `(id:string, withImage=false): PersonaRecord \| null` | 15 |
| 237 | resolvePersonaId | function | export | `(id:string \| undefined): string` | 8 |
| 242 | composePersonaMd | function |  | `(input:{
  name: string
  description: string
  avatar: string
  model: string
  prompt: …): string` | 2 |
| 259 | upsertPersona | function | export | `(input:PersonaUpsertInput): PersonaRecord` | 5 |
| 304 | pinAutoAvatarShapes | function | export | `(): void` | 1 |
| 326 | pruneExtRoles | function |  | `(keep:(personaId: string) => boolean): void` | 2 |
| 333 | pruneOrphanExtRoles | function | export | `(): void` | 2 |
| 340 | deletePersona | function | export | `(id:string): void` | 1 |
| 367 | reorderPersonas | function | export | `(ids:string[]): void` | 1 |
| 380 | setPersonaEnabled | function | export | `(id:string, enabled:boolean): void` | 3 |
| 403 | ensureSeededPersonas | function | export | `(): void` | 2 |
| 456 | promptHash | function |  | `(prompt:string): string` | 2 |
| 465 | refreshDefaultPrompt | function |  | `(def:DefaultPersona, baseline:string \| undefined, target:string): boolean` | 1 |
| 487 | registerPersonasIpc | function | export | `(): void` | 2 |
| 488 | ipc:personas:list | ipc |  | `(): PersonaRecord[]` | 0 |
| 489 | ipc:personas:get | ipc |  | `(_e, id:string): PersonaRecord \| null` | 0 |
| 490 | ipc:personas:upsert | ipc |  | `(_e, input:PersonaUpsertInput): PersonaRecord` | 0 |
| 493 | ipc:personas:remove | ipc |  | `(_e, id:string): { ok: true }` | 0 |
| 497 | ipc:personas:set-enabled | ipc |  | `(_e, id:string, enabled:boolean): { ok: true }` | 0 |
| 501 | ipc:personas:reorder | ipc |  | `(_e, ids:string[]): { ok: true }` | 0 |
| 506 | ipc:personas:set-avatar-image | ipc |  | `(_e, id:string, dataUri:string): string` | 0 |
| 509 | ipc:personas:clear-avatar-image | ipc |  | `(_e, id:string): { ok: true }` | 0 |

### `apps/desktop/src/main/services/portable.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 15 | installedByNsis | function | export | `(): boolean` | 2 |
| 20 | isPortable | function | export | `(): boolean` | 3 |
| 32 | registerToastIdentity | function | export | `(appId:string): void` | 1 |
| 35 | set | arrow |  | `(name:string, value:string): void` | 143 |

### `apps/desktop/src/main/services/profile.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 26 | profileDir | function |  | `(): string` | 3 |
| 30 | profileSection | function |  | `(): Record<string, unknown>` | 2 |
| 35 | getProfile | function | export | `(): UserProfile` | 1 |
| 43 | setProfileAvatar | function |  | `(spec:string): void` | 1 |
| 48 | registerProfileIpc | function | export | `(): void` | 2 |
| 49 | ipc:profile:get | ipc |  | `(): UserProfile` | 0 |
| 50 | ipc:profile:set-avatar | ipc |  | `(_e, spec:string): { ok: true }` | 0 |
| 55 | ipc:profile:set-avatar-image | ipc |  | `(_e, dataUri:string): string` | 0 |

### `apps/desktop/src/main/services/project-doc.ts`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 32 | loadProjectDoc | function | export | `(root:string \| null): ProjectDoc \| null` | 5 |
| 66 | projectDocPromptSection | function | export | `(doc:ProjectDoc \| null): string[]` | 3 |

### `apps/desktop/src/main/services/provider.ts`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 30 | normalizeBase | function |  | `(url:string): string` | 2 |
| 35 | fetchWithTimeout | function |  | `async (url:string, init:RequestInit): Promise<Response>` | 2 |
| 45 | networkError | function |  | `(e:unknown): NormalizedError` | 2 |
| 55 | extractModelIds | function |  | `(json:unknown): string[]` | 1 |
| 72 | registerProviderIpc | function | export | `(): void` | 2 |
| 74 | ipc:provider:list-models | ipc |  | `async (_e, cfg:ProbeConfig): Promise<ListModelsResult>` | 0 |

### `apps/desktop/src/main/services/remote/feishu-onboard.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 43 | startFeishuScan | function | export | `async (): Promise<FeishuScan>` | 1 |

### `apps/desktop/src/main/services/remote/feishu.ts`（30 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 55 | FeishuAdapter.constructor | ctor |  | `(id:ChannelId, opts:FeishuOptions)` | 0 |
| 62 | FeishuAdapter.domain | method | export | `(): lark.Domain` | 1 |
| 66 | FeishuAdapter.start | method | export | `async (host:AdapterHost): Promise<void>` | 6 |
| 96 | FeishuAdapter.stop | method | export | `async (): Promise<void>` | 11 |
| 103 | FeishuAdapter.dedupe | method | export | `(id:string): boolean` | 1 |
| 110 | FeishuAdapter.onMessage | method | export | `(host:AdapterHost, data:{
      sender: { sender_id?: { open_id?: string }; sender_type: …): void` | 4 |
| 133 | FeishuAdapter.onCard | method | export | `async (host:AdapterHost, d:RawCardEvent): Promise<Card>` | 1 |
| 155 | FeishuAdapter.upsert | method | export | `async (chat:ChatAddress, card:Card, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 14 |
| 174 | FeishuAdapter.renderTurn | method | export | `(chat:ChatAddress, page:TurnPage, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 1 |
| 178 | FeishuAdapter.renderPrompt | method | export | `(chat:ChatAddress, view:PromptView, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 6 |
| 182 | FeishuAdapter.sendNotice | method | export | `(chat:ChatAddress, view:NoticeView): Promise<MessageHandle \| undefined>` | 1 |
| 187 | FeishuAdapter.deleteMessage | method | export | `async (_chat:ChatAddress, handle:MessageHandle): Promise<void>` | 1 |
| 194 | FeishuAdapter.openDirect | method | export | `async (userId:string, view:NoticeView): Promise<string \| undefined>` | 1 |
| 208 | feishuClient | function |  | `(opts:FeishuOptions): lark.Client` | 2 |
| 218 | fetchFeishuBotName | function | export | `async (opts:FeishuOptions): Promise<string>` | 1 |
| 233 | extractText | function |  | `(type:string, raw:string): string \| null` | 1 |
| 240 | strip | arrow |  | `(s:string): string` | 2 |
| 264 | apiError | function |  | `(e:unknown): string` | 4 |
| 274 | card | function |  | `(elements:unknown[], header?:{ title: string; subtitle?: string; template: Template }): Card` | 13 |
| 291 | md | arrow |  | `(content:string): Card` | 20 |
| 292 | grey | arrow |  | `(s:string): string` | 19 |
| 293 | plain | arrow |  | `(content:string): Card` | 5 |
| 295 | button | function |  | `(label:string, value:ActionValue, type:'primary' \| 'default' \| 'danger'='default'): Card` | 10 |
| 299 | buttonRow | function |  | `(buttons:Card[]): Card` | 6 |
| 307 | toast | function |  | `(ok:boolean, content:string): Card` | 2 |
| 311 | clip | function |  | `(s:string, n:number): string` | 22 |
| 316 | code | arrow |  | `(s:string): string` | 4 |
| 327 | turnCard | function |  | `(p:TurnPage): Card` | 1 |
| 351 | promptCard | function |  | `(v:PromptView): Card` | 1 |
| 529 | noticeCard | function |  | `(v:NoticeView): Card` | 2 |

### `apps/desktop/src/main/services/remote/hub.ts`（66 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 66 | notifyState | function |  | `(): void` | 7 |
| 71 | onHubChange | function | export | `(l:() => void): () => void` | 1 |
| 76 | channelState | function | export | `(id:ChannelId): { state: ChannelState; error?: string }` | 1 |
| 81 | startChannel | function | export | `async (adapter:RemoteAdapter): Promise<void>` | 1 |
| 87 | host.onMessage | objmethod |  | `(msg)` | 4 |
| 91 | host.onAction | objmethod |  | `(a)` | 2 |
| 92 | host.onState | objmethod |  | `(state, error)` | 13 |
| 115 | greetPending | function |  | `async (adapter:RemoteAdapter): Promise<void>` | 1 |
| 131 | setUserChat | function |  | `(id:ChannelId, userId:string, chatId:string): void` | 2 |
| 138 | stopChannel | function | export | `async (id:ChannelId): Promise<void>` | 4 |
| 151 | stopAllChannels | function | export | `async (): Promise<void>` | 1 |
| 155 | liveAdapter | function |  | `(id:ChannelId): RemoteAdapter \| null` | 6 |
| 167 | issuePairCode | function | export | `(id:ChannelId): { code: string; expiresAt: number }` | 1 |
| 175 | cancelPairCode | function | export | `(id:ChannelId): void` | 1 |
| 179 | removePairedUser | function | export | `(id:ChannelId, userId:string): void` | 1 |
| 189 | isAuthorized | function |  | `(id:ChannelId, userId:string): boolean` | 2 |
| 193 | tryPair | function |  | `async (msg:InboundMessage, code:string): Promise<void>` | 1 |
| 228 | chatKey | function |  | `(c:ChatAddress): string` | 12 |
| 232 | boundSession | function |  | `(chat:ChatAddress): string \| null` | 5 |
| 238 | bind | function |  | `(chat:ChatAddress, sessionId:string): void` | 6 |
| 246 | watchersOf | function |  | `(sessionId:string): ChatAddress[]` | 2 |
| 257 | homeChats | function |  | `(sessionId?:string): ChatAddress[]` | 2 |
| 276 | allows | function |  | `(channel:ChannelId, s:{ id: string; personaId?: string }): boolean` | 2 |
| 284 | inScope | function |  | `(channel:ChannelId, sessionId:string): boolean` | 4 |
| 291 | allowedPersonas | function |  | `(channel:ChannelId): PersonaRecord[]` | 5 |
| 300 | sessionTitle | function |  | `(sessionId:string): string` | 6 |
| 304 | personaName | function |  | `(sessionId:string): string` | 13 |
| 340 | ensureTrack | function |  | `(turnId:string, sessionId:string, eager:boolean): TurnTrack` | 2 |
| 362 | addPost | function |  | `(t:TurnTrack, chat:ChatAddress): void` | 3 |
| 401 | reduce | function |  | `(t:TurnTrack, ev:ChatStreamEvent): boolean` | 8 |
| 404 | content | arrow |  | `(): void` | 6 |
| 472 | hasVisible | function |  | `(t:TurnTrack): boolean` | 3 |
| 476 | scheduleFlush | function |  | `(t:TurnTrack, immediate=false): void` | 6 |
| 496 | flushPost | function |  | `(t:TurnTrack, post:Post, adapter:RemoteAdapter): void` | 1 |
| 525 | finishTurn | function |  | `(t:TurnTrack, stopReason:string): void` | 1 |
| 578 | isCard | function |  | `(v:PromptView): v is Extract<PromptView, { kind: 'auto…` | 2 |
| 583 | toolInput | function |  | `(sessionId:string, toolUseId:string): Record<string, unknown> \| null` | 2 |
| 593 | str | arrow |  | `(v:unknown): string` | 56 |
| 596 | autotaskInput | function |  | `(sessionId:string, raw:Record<string, unknown>): TaskCreateInput` | 2 |
| 612 | autotaskView | function |  | `(sessionId:string, toolUseId:string, raw:Record<string, unknown>): PromptView` | 1 |
| 633 | agentView | function |  | `(sessionId:string, toolUseId:string, raw:Record<string, unknown>): PromptView` | 1 |
| 656 | openPrompt | function |  | `(turnId:string, sessionId:string, view:PromptView): void` | 2 |
| 669 | renderPrompt | function |  | `(p:PromptTrack): void` | 6 |
| 683 | cancelPrompt | function |  | `(v:PromptView): void` | 1 |
| 688 | applyCardResolution | function |  | `(sessionId:string, ev:Extract<ChatStreamEvent, { type: 'card_resolved' }>): void` | 1 |
| 704 | applyResolution | function |  | `(ev:Extract<ChatStreamEvent, { type: 'interaction_resolved' }>): void` | 1 |
| 729 | onBusEvent | function |  | `({ turnId, sessionId, event }:ChatEventPayload): void` | 0 |
| 798 | replied | function |  | `(sessionId:string, chat:ChatAddress): boolean` | 1 |
| 804 | onNotice | function |  | `(n:AppNotice): void` | 0 |
| 821 | initHub | function | export | `(): void` | 1 |
| 857 | clearTrail | function |  | `(chat:ChatAddress): void` | 3 |
| 866 | dropMessage | function |  | `async (chat:ChatAddress, handle:MessageHandle): Promise<void>` | 2 |
| 875 | notice | function |  | `async (chat:ChatAddress, view:NoticeView, trail?:Trail): Promise<void>` | 17 |
| 888 | handleMessage | function |  | `async (msg:InboundMessage): Promise<void>` | 1 |
| 920 | runCommand | function |  | `async (chat:ChatAddress, name:string, arg:string, trail:Trail): Promise<boolean>` | 1 |
| 921 | say | arrow |  | `(view:NoticeView): Promise<void>` | 11 |
| 1030 | pickPersona | function |  | `(channel:ChannelId, name:string): { id: string; name: string } \| null` | 3 |
| 1041 | genSessionId | function |  | `(): string` | 1 |
| 1045 | createSession | function |  | `(chat:ChatAddress, personaId?:string): string` | 4 |
| 1065 | newSessionNotice | function |  | `(personaName?:string): NoticeView` | 2 |
| 1072 | useSession | function |  | `async (chat:ChatAddress, sid:string): Promise<void>` | 1 |
| 1099 | lastAssistantText | function |  | `(sid:string): string` | 1 |
| 1116 | sendToSession | function |  | `async (chat:ChatAddress, text:string): Promise<void>` | 1 |
| 1181 | handleAction | function |  | `async (a:InboundAction): Promise<ActionResult>` | 1 |
| 1270 | truncate | function |  | `(s:string, n:number): string` | 3 |
| 1274 | errText | function |  | `(e:unknown): string` | 11 |

### `apps/desktop/src/main/services/remote/index.ts`（21 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 44 | SECRET_KEY | arrow |  | `(id:ChannelId, field:string): string` | 4 |
| 47 | ADAPTERS.feishu | objmethod |  | `async (bot)` | 0 |
| 57 | ADAPTERS.telegram | objmethod |  | `async (bot)` | 0 |
| 80 | publicState | function |  | `(): { bots: BotView[] }` | 2 |
| 100 | launch | function |  | `async (id:ChannelId): Promise<string \| null>` | 4 |
| 136 | feishuScan | function |  | `async (): Promise<Scan>` | 1 |
| 159 | telegramScan | function |  | `async (rawToken:string): Promise<Scan>` | 1 |
| 195 | genId | function |  | `(prefix:string): string` | 20 |
| 199 | registerRemoteIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 202 | send | arrow |  | `(channel:string, payload:unknown): void` | 50 |
| 206 | push | arrow |  | `(): void` | 463 |
| 209 | ipc:remote:get-state | ipc |  | `()` | 0 |
| 215 | ipc:remote:scan-start | ipc |  | `async (_e, platform:Platform, opts?:{ token?: string }): Promise<
      \| { ok: true; scanId: s…` | 0 |
| 277 | ipc:remote:scan-cancel | ipc |  | `(_e, scanId:string): { ok: true }` | 0 |
| 284 | ipc:remote:set-enabled | ipc |  | `async (_e, id:ChannelId, enabled:boolean): Promise<{ ok: boolean; error?: string }>` | 0 |
| 298 | ipc:remote:set-reply-mode | ipc |  | `(_e, id:ChannelId, mode:ReplyMode): { ok: true }` | 0 |
| 304 | ipc:remote:set-scope | ipc |  | `(_e, id:ChannelId, scope:ReplyScope): { ok: true }` | 0 |
| 311 | ipc:remote:delete-bot | ipc |  | `async (_e, id:ChannelId): Promise<{ ok: true }>` | 0 |
| 319 | ipc:remote:pair-code | ipc |  | `(_e, id:ChannelId)` | 0 |
| 321 | ipc:remote:pair-cancel | ipc |  | `(_e, id:ChannelId): { ok: true }` | 0 |
| 326 | ipc:remote:remove-user | ipc |  | `(_e, id:ChannelId, userId:string): { ok: true }` | 0 |

### `apps/desktop/src/main/services/remote/paginate.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 7 | paginate | function | export | `(blocks:TurnBlock[], budget:number): TurnBlock[][]` | 1 |
| 10 | newPage | arrow |  | `(): void` | 3 |
| 14 | cur | arrow |  | `(): TurnBlock[]` | 5 |

### `apps/desktop/src/main/services/remote/store.ts`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 42 | ids | function |  | `(v:unknown): string[]` | 2 |
| 47 | normalizeScope | function | export | `(raw:unknown): ReplyScope` | 2 |
| 71 | readRemote | function |  | `(): Record<string, unknown>` | 2 |
| 76 | normalize | function |  | `(raw:unknown): BotConfig \| null` | 1 |
| 103 | listBots | function | export | `(): BotConfig[]` | 7 |
| 108 | getBot | function | export | `(id:ChannelId): BotConfig \| null` | 3 |
| 112 | writeBots | function |  | `(bots:BotConfig[]): void` | 3 |
| 116 | addBot | function | export | `(bot:BotConfig): void` | 1 |
| 120 | deleteBot | function | export | `(id:ChannelId): void` | 2 |
| 125 | updateBot | function | export | `(id:ChannelId, fn:(b: BotConfig) => BotConfig): BotConfig \| null` | 4 |
| 135 | getChannelConfig | function | export | `(id:ChannelId): BotConfig` | 15 |
| 153 | updateChannelConfig | function | export | `(id:ChannelId, fn:(c: BotConfig) => BotConfig): void` | 5 |

### `apps/desktop/src/main/services/remote/telegram-onboard.ts`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 30 | startTelegramLink | function | export | `async (token:string, me:TelegramMe): Promise<TelegramLink>` | 1 |
| 38 | wait | arrow |  | `async (): Promise<LinkOutcome>` | 1 |

### `apps/desktop/src/main/services/remote/telegram.ts`（41 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 38 | TelegramError.constructor | ctor |  | `(code:number, message:string, retryAfter?:number)` | 0 |
| 56 | tgCall | function | export | `async (token:string, method:string, params:Record<string, unknown>={}, opts:{ signal?: AbortSig…): Promise<T>` | 5 |
| 99 | fetchTelegramMe | function | export | `async (token:string): Promise<TelegramMe>` | 2 |
| 183 | TelegramAdapter.constructor | ctor |  | `(id:ChannelId, opts:TelegramOptions)` | 0 |
| 188 | TelegramAdapter.call | method | export | `(method:string, params:Record<string, unknown>={}, timeoutMs?:number): Promise<T>` | 7 |
| 192 | TelegramAdapter.start | method | export | `async (host:AdapterHost): Promise<void>` | 6 |
| 205 | TelegramAdapter.stop | method | export | `async (): Promise<void>` | 11 |
| 210 | TelegramAdapter.poll | method | export | `async (host:AdapterHost, signal:AbortSignal): Promise<void>` | 2 |
| 254 | TelegramAdapter.onMessage | method | export | `(host:AdapterHost, m:TgMessage): void` | 4 |
| 270 | TelegramAdapter.onCallback | method | export | `async (host:AdapterHost, q:TgCallbackQuery): Promise<void>` | 1 |
| 271 | reply | arrow |  | `(text:string, alert=false): Promise<unknown>` | 7 |
| 318 | TelegramAdapter.encode | method | export | `(p:Pending): string` | 4 |
| 329 | TelegramAdapter.decode | method | export | `(data:string): Pending \| null` | 3 |
| 342 | TelegramAdapter.act | method | export | `(value:ActionValue, form?:Record<string, string \| string[]>): string` | 8 |
| 348 | TelegramAdapter.upsert | method | export | `async (chat:ChatAddress, r:Rendered, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 14 |
| 384 | TelegramAdapter.renderTurn | method | export | `(chat:ChatAddress, page:TurnPage, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 1 |
| 388 | TelegramAdapter.renderPrompt | method | export | `(chat:ChatAddress, view:PromptView, handle?:MessageHandle): Promise<MessageHandle \| undefined>` | 6 |
| 402 | TelegramAdapter.sendNotice | method | export | `(chat:ChatAddress, view:NoticeView): Promise<MessageHandle \| undefined>` | 1 |
| 406 | TelegramAdapter.deleteMessage | method | export | `async (chat:ChatAddress, handle:MessageHandle): Promise<void>` | 1 |
| 411 | TelegramAdapter.openDirect | method | export | `async (userId:string, view:NoticeView): Promise<string \| undefined>` | 1 |
| 417 | sleep | function |  | `(ms:number, signal:AbortSignal): Promise<void>` | 10 |
| 424 | userName | function |  | `(u:TgUser): string \| undefined` | 2 |
| 429 | stripMention | function |  | `(text:string, username:string): string` | 1 |
| 437 | esc | function | export | `(s:string): string` | 27 |
| 441 | htmlToPlain | function |  | `(html:string): string` | 1 |
| 450 | clipPlain | function |  | `(s:string): string` | 2 |
| 455 | inline | function |  | `(s:string): string` | 4 |
| 474 | mdToHtml | function | export | `(md:string): string` | 3 |
| 478 | flushQuote | arrow |  | `(): void` | 3 |
| 513 | i | arrow |  | `(s:string): string` | 19 |
| 514 | b | arrow |  | `(s:string): string` | 8 |
| 515 | code | arrow |  | `(s:string): string` | 4 |
| 516 | fold | arrow |  | `(s:string): string` | 3 |
| 518 | clip | function |  | `(s:string, n:number): string` | 22 |
| 522 | head | function |  | `(title:string, subtitle?:string, icon?:string): string` | 14 |
| 535 | turnRendered | function |  | `(p:TurnPage, act:(v: ActionValue) => string): Rendered` | 1 |
| 564 | optionLabels | function |  | `(q:AskView['questions'][number] \| undefined): string[]` | 2 |
| 574 | askRendered | function |  | `(d:AskDraft, enc:(p: Pending) => string): Rendered` | 3 |
| 607 | promptRendered | function |  | `(v:Exclude<PromptView, { kind: 'ask' }>, act:(v: ActionValue) => string): Rendered` | 1 |
| 608 | btn | arrow |  | `(text:string, value:ActionValue): { text: string; callback_data: string }` | 8 |
| 707 | noticeRendered | function |  | `(v:NoticeView, act:(v: ActionValue) => string): Rendered` | 2 |

### `apps/desktop/src/main/services/remote/types.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/main/services/repetition.ts`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 35 | qualifies | function |  | `(span:number, period:number): boolean` | 1 |
| 40 | minSpanFor | function |  | `(period:number): number` | 1 |
| 45 | findRepetition | function | export | `(text:string): RepetitionHit \| null` | 1 |
| 73 | trailingRepetition | function | export | `(text:string): RepetitionHit \| null` | 2 |
| 100 | watchRepetition | function | export | `(): (delta: string) => RepetitionHit \| null` | 2 |

### `apps/desktop/src/main/services/reply-notify.ts`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 17 | preview | function |  | `(text:string, max=120): string` | 7 |
| 27 | isEn | function |  | `(): boolean` | 31 |
| 32 | show | function |  | `(getWindow:() => BrowserWindow \| null, sessionId:string, title:string, body:string): void` | 60 |
| 65 | notifyReplyDone | function | export | `(getWindow:() => BrowserWindow \| null, opts:{ sessionId: string; title: string; text: str…): void` | 3 |
| 98 | notifyNeedsInput | function | export | `(getWindow:() => BrowserWindow \| null, opts:{ sessionId: string; title: string; input: Pe…): void` | 1 |

### `apps/desktop/src/main/services/schedule.ts`（14 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 44 | parseField | function |  | `(raw:string, spec:FieldSpec): Set<number> \| null` | 1 |
| 88 | parseCron | function | export | `(expr:string): ParsedCron \| null` | 5 |
| 117 | formatterFor | function |  | `(tz:string): Intl.DateTimeFormat` | 1 |
| 136 | isValidTimeZone | function | export | `(tz:string): boolean` | 4 |
| 156 | wallPartsAt | function |  | `(utcMs:number, tz:string): WallParts` | 2 |
| 173 | tzOffsetAt | function |  | `(utcMs:number, tz:string): number` | 2 |
| 184 | wallClockToUtc | function |  | `(y:number, mo:number, d:number, h:number, mi:number, tz:string): number` | 1 |
| 201 | dowOf | function |  | `(y:number, mo:number, d:number): number` | 1 |
| 208 | parseWallIso | function | export | `(at:string): { y: number; mo: number; d: number; h:…` | 3 |
| 239 | nextRun | function | export | `(schedule:TaskSchedule, after:number): number \| null` | 10 |
| 317 | pad2 | function |  | `(n:number): string` | 12 |
| 325 | describeSchedule | function | export | `(schedule:TaskSchedule, locale:'zh-CN' \| 'en'): string` | 5 |
| 341 | single | arrow |  | `(s:Set<number>): number \| null` | 3 |
| 365 | dayNames | arrow |  | `(): string` | 3 |

### `apps/desktop/src/main/services/scheduler.ts`（11 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 37 | countMissed | function | export | `(schedule:TaskSchedule, firstFire:number, now:number): number` | 1 |
| 53 | planFires | function | export | `(tasks:TaskRecord[], now:number): Array<{ id: string; missed: number }>` | 1 |
| 85 | firstLine | function |  | `(text:string): string` | 1 |
| 97 | notify | function |  | `(title:string, body:string, sessionId?:string, echoesReply=false): void` | 4 |
| 123 | notifyForRun | function |  | `(task:TaskRecord, run:TaskRun, autoPaused:boolean): void` | 1 |
| 142 | fireOnce | function |  | `async (id:string, manual:boolean, missed:number): Promise<void>` | 1 |
| 203 | enqueue | function |  | `(id:string, manual:boolean, missed:number): ReturnType<TaskRunner>` | 2 |
| 212 | drain | function |  | `async (): Promise<void>` | 1 |
| 233 | tick | function |  | `(): void` | 1 |
| 249 | startScheduler | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 263 | stopScheduler | function | export | `(): void` | 0 |

### `apps/desktop/src/main/services/sealed.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 45 | sealedDecision | function | export | `(toolName:string): SealedVerdict` | 1 |

### `apps/desktop/src/main/services/secrets.ts`（14 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 21 | migrateLegacy | function |  | `async (): Promise<void>` | 2 |
| 36 | ensureLoaded | function |  | `async (): Promise<void>` | 27 |
| 50 | persist | function |  | `async (): Promise<void>` | 18 |
| 59 | getSecret | function | export | `async (key:string): Promise<string \| null>` | 7 |
| 75 | setSecret | function | export | `async (key:string, value:string): Promise<{ ok: boolean; available: bool…` | 3 |
| 93 | hasSecret | function | export | `async (key:string): Promise<boolean>` | 2 |
| 99 | deleteSecret | function | export | `async (key:string): Promise<void>` | 0 |
| 108 | deleteSecretsByPrefix | function | export | `async (prefix:string): Promise<void>` | 2 |
| 120 | registerSecretsIpc | function | export | `(): void` | 2 |
| 124 | ipc:secrets:set | ipc |  | `async (_e, providerId:string, key:string): Promise<{ ok: boolean; available: bool…` | 0 |
| 140 | ipc:secrets:has | ipc |  | `async (_e, providerId:string): Promise<boolean>` | 0 |
| 145 | ipc:secrets:delete | ipc |  | `async (_e, providerId:string): Promise<{ ok: true }>` | 0 |
| 153 | ipc:secrets:list | ipc |  | `async (): Promise<string[]>` | 0 |
| 159 | ipc:secrets:available | ipc |  | `(): boolean` | 0 |

### `apps/desktop/src/main/services/shells.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 26 | firstExisting | function |  | `(candidates:(string \| undefined)[]): string \| null` | 2 |
| 34 | detectWindows | function |  | `(): ShellProfile[]` | 1 |
| 80 | detectPosix | function |  | `(): ShellProfile[]` | 1 |
| 83 | add | arrow |  | `(id:string, label:string, path:string, isDefault?:boolean): void` | 96 |
| 103 | detectShells | function | export | `(): ShellProfile[]` | 4 |
| 110 | fallbackShell | function |  | `(): { path: string; args: string[] }` | 1 |
| 116 | resolveShell | function | export | `(id:string \| null): { path: string; args: string[] }` | 1 |

### `apps/desktop/src/main/services/skills.ts`（33 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 264 | skillsDir | function | export | `(): string` | 11 |
| 268 | skillFile | function |  | `(id:string): string` | 3 |
| 273 | enabledMap | function |  | `(): Record<string, boolean>` | 11 |
| 280 | writeEnabledMap | function |  | `(map:Record<string, boolean>): void` | 6 |
| 287 | isSafeId | function |  | `(id:string): boolean` | 22 |
| 292 | makeId | function |  | `(name:string): string` | 4 |
| 309 | parseSkill | function |  | `(id:string, raw:string, enabled:boolean): SkillRecord` | 2 |
| 329 | listSkills | function | export | `(): SkillRecord[]` | 5 |
| 359 | getSkill | function | export | `(id:string): SkillRecord \| null` | 2 |
| 372 | composeSkillMd | function |  | `(input:{
  name: string
  description: string
  trigger: string
  allowedTools: string[]
…): string` | 1 |
| 389 | upsertSkill | function | export | `(input:SkillUpsertInput): SkillRecord` | 1 |
| 440 | deleteSkill | function | export | `async (id:string): Promise<{ ok: boolean }>` | 1 |
| 460 | setSkillEnabled | function | export | `(id:string, enabled:boolean): void` | 5 |
| 484 | usableBy | function |  | `(s:SkillRecord, personaId:string, hasTool?:(name: string) => boolean): boolean` | 2 |
| 492 | enabledSkillSummaries | function | export | `(personaId:string, hasTool?:(name: string) => boolean): { name: string; description: string }[]` | 2 |
| 502 | hasEnabledSkills | function | export | `(): boolean` | 0 |
| 512 | loadSkillInstructionsByName | function | export | `(name:string, personaId:string, hasTool?:(name: string) => boolean): { name: string; instructions: string; …` | 2 |
| 540 | writeImportedSkill | function |  | `(rawMd:string, extra:{ path: string; data: Uint8Array }[]): SkillImportResult` | 2 |
| 569 | importZipSkill | function |  | `(filePath:string): SkillImportResult` | 1 |
| 627 | importSkillFromFile | function | export | `(filePath:string): SkillImportResult` | 1 |
| 651 | affectsList | function |  | `(filename:string \| null): boolean` | 2 |
| 668 | startSkillsWatcher | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 677 | schedule | arrow |  | `(): void` | 3 |
| 686 | stopAll | arrow |  | `(err:unknown): void` | 2 |
| 691 | add | arrow |  | `(key:string, w:FSWatcher): void` | 96 |
| 708 | syncChildren | arrow |  | `(): void` | 2 |
| 752 | registerSkillsIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 753 | ipc:skills:list | ipc |  | `(): SkillRecord[]` | 0 |
| 754 | ipc:skills:get | ipc |  | `(_e, id:string): SkillRecord \| null` | 0 |
| 755 | ipc:skills:remove | ipc |  | `(_e, id:string): Promise<{ ok: boolean }>` | 0 |
| 756 | ipc:skills:set-enabled | ipc |  | `(_e, id:string, enabled:boolean): { ok: true }` | 0 |
| 761 | ipc:skills:set-roles | ipc |  | `(_e, id:string, roles:string[] \| null): { ok: boolean }` | 0 |
| 767 | ipc:skills:import | ipc |  | `async (): Promise<SkillImportResult>` | 0 |

### `apps/desktop/src/main/services/subagent-store.ts`（19 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 48 | safeName | function |  | `(id:string): string` | 5 |
| 52 | subagentsRoot | function |  | `(): string` | 3 |
| 57 | sessionDir | function |  | `(sessionId:string): string \| null` | 9 |
| 62 | recordFile | function |  | `(sessionId:string, id:string): string \| null` | 3 |
| 72 | key | arrow |  | `(sessionId:string, id:string): string` | 19 |
| 75 | subagentIdFor | function | export | `(toolUseId:string): string` | 2 |
| 79 | loadIndex | function |  | `(sessionId:string): Map<string, SubagentMeta>` | 9 |
| 96 | persistIndex | function |  | `(sessionId:string): void` | 5 |
| 108 | newSubagentId | function | export | `(sessionId:string, originToolId:string): string` | 1 |
| 116 | getSubagentMeta | function | export | `(sessionId:string, id:string): SubagentMeta \| undefined` | 2 |
| 121 | loadSubagent | function | export | `(sessionId:string, id:string): SubagentRecord \| undefined` | 1 |
| 139 | saveSubagent | function | export | `(rec:SubagentRecord): void` | 1 |
| 164 | dropRecord | function |  | `(sessionId:string, id:string): void` | 2 |
| 178 | enforceCap | function |  | `(sessionId:string, keepId:string): void` | 2 |
| 190 | isSubagentBusy | function | export | `(sessionId:string, id:string): boolean` | 1 |
| 194 | setSubagentBusy | function | export | `(sessionId:string, id:string, on:boolean): void` | 3 |
| 203 | pruneSubagents | function | export | `(sessionId:string, liveToolIds:Set<string>): void` | 3 |
| 217 | removeSessionSubagents | function | export | `(sessionId:string): void` | 3 |
| 230 | sweepSubagents | function | export | `async (liveIds:Iterable<string>): Promise<void>` | 2 |

### `apps/desktop/src/main/services/subagents.ts`（3 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 114 | isForkAgent | function | export | `(name:string): boolean` | 1 |
| 119 | subagentSummaries | function | export | `(): { name: string; description: string }[]` | 3 |
| 130 | getSubagentByName | function | export | `(name:string): SubagentDef \| null` | 1 |

### `apps/desktop/src/main/services/tasks-types.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/main/services/tasks.ts`（32 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 42 | tasksFile | function |  | `(): string` | 2 |
| 47 | ensureLoaded | function |  | `(): void` | 27 |
| 64 | normalizeRecord | function |  | `(t:TaskRecord): TaskRecord` | 1 |
| 80 | persist | function |  | `(): void` | 18 |
| 93 | emitChanged | function |  | `(): void` | 1 |
| 104 | listTasks | function | export | `(): TaskRecord[]` | 3 |
| 109 | getTask | function | export | `(id:string): TaskRecord \| null` | 4 |
| 115 | findTaskBySession | function | export | `(sessionId:string): TaskRecord \| null` | 3 |
| 122 | tasksOwnedBy | function | export | `(ownerSessionId:string): TaskRecord[]` | 1 |
| 130 | validOwner | function |  | `(sessionId:unknown, taskSessionId?:string): string \| undefined` | 2 |
| 141 | releaseTasksOwnedBy | function | export | `(ownerSessionId:string): number` | 1 |
| 166 | sanitizeAuth | function |  | `(auth:Partial<TaskAuthorization> \| undefined): TaskAuthorization` | 4 |
| 178 | createTask | function | export | `(input:TaskCreateInput): CreateTaskResult` | 2 |
| 231 | updateTask | function | export | `(input:TaskUpdateInput): TaskRecord \| null` | 2 |
| 286 | deleteTask | function | export | `(id:string): void` | 1 |
| 297 | setTaskSessionPurger | function | export | `(fn:((sessionId: string) => void) \| null): void` | 1 |
| 305 | syncTaskModel | function | export | `(sessionId:string, modelRef:string): void` | 1 |
| 323 | reassignTaskPersona | function | export | `(from:string, to:string): void` | 1 |
| 344 | setTaskStatus | function | export | `(id:string, status:TaskStatus): TaskRecord \| null` | 2 |
| 361 | appendRun | function | export | `(id:string, run:TaskRun): TaskRecord \| null` | 2 |
| 378 | applyRunResult | function | export | `(id:string, result:{ ok: boolean; aborted?: boolean }, firedAt:number): { task: TaskRecord; autoPausedError: b…` | 1 |
| 434 | previewSchedule | function | export | `(schedule:TaskSchedule, locale:'zh-CN' \| 'en'='zh-CN', allowPast=false): PreviewScheduleResult` | 2 |
| 470 | setTaskRunner | function | export | `(fn:TaskRunner \| null): void` | 2 |
| 477 | registerTasksIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 480 | ipc:tasks:list | ipc |  | `(): TaskRecord[]` | 0 |
| 481 | ipc:tasks:get | ipc |  | `(_e, id:string): TaskRecord \| null` | 0 |
| 483 | ipc:tasks:create | ipc |  | `(_e, input:TaskCreateInput): CreateTaskResult` | 0 |
| 486 | ipc:tasks:update | ipc |  | `(_e, input:TaskUpdateInput): TaskRecord \| null` | 0 |
| 489 | ipc:tasks:delete | ipc |  | `(_e, id:string): { ok: true }` | 0 |
| 493 | ipc:tasks:set-status | ipc |  | `(_e, id:string, status:TaskStatus): TaskRecord \| null` | 0 |
| 499 | ipc:tasks:preview | ipc |  | `(_e, schedule:TaskSchedule, locale:'zh-CN' \| 'en', allowPast?:boolean): PreviewScheduleResult` | 0 |
| 506 | ipc:tasks:run-now | ipc |  | `(_e, id:string): { ok: boolean; reason?: string; alread…` | 0 |

### `apps/desktop/src/main/services/terminal.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | registerTerminalIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 39 | flush | function |  | `(): void` | 6 |
| 45 | send | function |  | `(msg:Record<string, unknown>): void` | 50 |
| 50 | ensureChild | function |  | `(): void` | 1 |
| 87 | ipc:terminal:list-shells | ipc |  | `()` | 0 |
| 91 | ipc:terminal:create | ipc |  | `(_evt, opts:CreateOptions): { id: string }` | 0 |
| 100 | ipc:terminal:input | ipc |  | `(_evt, id:string, data:string)` | 0 |
| 104 | ipc:terminal:resize | ipc |  | `(_evt, id:string, cols:number, rows:number)` | 0 |
| 108 | ipc:terminal:dispose | ipc |  | `(_evt, id:string)` | 0 |

### `apps/desktop/src/main/services/todos.ts`（14 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 66 | isListDone | function | export | `(items:TodoItem[]): boolean` | 4 |
| 71 | foldTodos | function | export | `(entries:TodoEntry[]=[]): TodoList[]` | 2 |
| 90 | activeTodoList | function | export | `(entries:TodoEntry[]=[], cancelled:string[]=[]): TodoList \| null` | 5 |
| 96 | todoState | function | export | `(entries:TodoEntry[]=[], cancelled:string[]=[]): TodoState` | 5 |
| 100 | str | arrow |  | `(v:unknown): string` | 56 |
| 103 | parseTodoInput | function | export | `(input:unknown): { title: string; items: TodoItem[]; ne…` | 1 |
| 131 | applyTodoWrite | function | export | `(entries:TodoEntry[]=[], cancelled:string[]=[], id:string, input:unknown, now:number): TodoEntry \| { cancel: string \| null } …` | 1 |
| 143 | overlap | arrow |  | `(a:TodoItem[], b:TodoItem[]): boolean` | 1 |
| 147 | closed | arrow |  | `(l:TodoList): boolean` | 1 |
| 161 | todoResultText | function | export | `(entry:TodoEntry): string` | 1 |
| 176 | listLines | function |  | `(list:TodoList): string` | 2 |
| 182 | todoSnapshotText | function | export | `(entries:TodoEntry[]=[], cancelled:string[]=[], zh:boolean): string` | 1 |
| 195 | todoReminderText | function | export | `(entries:TodoEntry[]=[], cancelled:string[]=[]): string` | 1 |
| 207 | todoUserCancelNote | function | export | `(list:TodoList): string` | 1 |

### `apps/desktop/src/main/services/tool-results.ts`（13 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 24 | safeName | function |  | `(id:string): string` | 5 |
| 29 | toolResultsDir | function | export | `(sessionId?:string): string` | 2 |
| 34 | removeToolResults | function | export | `(sessionId:string): void` | 1 |
| 43 | writeResultFile | function |  | `(sessionId:string \| undefined, name:string, text:string): string \| null` | 2 |
| 55 | fmt | function |  | `(n:number): string` | 23 |
| 66 | headOf | function |  | `(s:string, n:number): string` | 4 |
| 73 | tailOf | function |  | `(s:string, n:number): string` | 2 |
| 85 | spillLongOutput | function | export | `(text:string, limit:number, sessionId:string \| undefined, label:string): string` | 3 |
| 121 | clearable | function |  | `(name:string \| undefined): boolean` | 1 |
| 142 | idleThreshold | function |  | `(model:{ adapter: string; model: string }): number` | 1 |
| 149 | isCleared | function |  | `(content:string): boolean` | 1 |
| 153 | placeholder | function |  | `(chars:number, file:string \| null, images:number, en:boolean): string` | 1 |
| 184 | clearStaleToolResults | function | export | `(session:StoredSession, model:{ adapter: string; model: string }, from=0, now=Date.now()): ClearOutcome \| null` | 1 |

### `apps/desktop/src/main/services/tool-search.ts`（13 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | skeleton | function |  | `(schema:unknown): unknown` | 3 |
| 49 | deferTool | function | export | `(spec:ToolSpec, brief:string, guide?:string): ToolSpec` | 2 |
| 63 | fitToolSearch | function | export | `(tools:ToolSpec[]): ToolSpec[]` | 2 |
| 71 | paramLines | function |  | `(schema:unknown, indent:string): string[]` | 3 |
| 86 | toolUsage | function | export | `(name:string): string \| null` | 4 |
| 97 | buildToolSearchTool | function | export | `(names:string[]=[...deferred.keys()]): ToolSpec` | 3 |
| 117 | unknownUsages | function | export | `(history:Message[], offered:Set<string>): Set<string>` | 2 |
| 123 | searchedNames | function | export | `(args:unknown): string[]` | 2 |
| 143 | runToolSearch | function | export | `(args:unknown, offered:Set<string>): UsageResult` | 1 |
| 176 | isUsageGateResult | function | export | `(content:string): boolean` | 1 |
| 184 | usageGateResult | function | export | `(name:string, given:boolean): { content: string; listing?: ListingRe…` | 1 |
| 197 | usageListingPart | function | export | `(history:Message[], names:string[]): TextPart \| null` | 1 |
| 215 | skillToolUsages | function | export | `(allowedTools:string[], pending:Set<string>): { text: string; names: string[]; listi…` | 2 |

### `apps/desktop/src/main/services/tools.ts`（51 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 495 | buildPlanTool | function | export | `(): ToolSpec` | 1 |
| 515 | buildTodoTool | function | export | `(): ToolSpec` | 1 |
| 607 | registerMcpToolNames | function | export | `(names:string[]): void` | 1 |
| 610 | unregisterMcpToolNames | function | export | `(names:string[]): void` | 1 |
| 613 | isMcpTool | function | export | `(name:string): boolean` | 3 |
| 617 | toolCategory | function | export | `(name:string): ToolCategory` | 2 |
| 702 | looksBinary | function | export | `(buf:Buffer): boolean` | 8 |
| 709 | normEol | function |  | `(s:string): string` | 5 |
| 714 | dominantEol | function |  | `(text:string): '\r\n' \| '\n'` | 2 |
| 721 | hasUtf8Bom | function |  | `async (abs:string): Promise<boolean>` | 1 |
| 739 | expandHome | function |  | `(p:string): string` | 3 |
| 749 | toAbsPath | function |  | `(root:string \| null, p:string): string` | 2 |
| 758 | resolvePath | function |  | `(root:string \| null, p:unknown): string` | 6 |
| 777 | writeTargetPath | function | export | `(name:string, args:unknown, root:string \| null): { abs: string; dir: string } \| null` | 1 |
| 824 | needsWorkspaceMount | function | export | `(name:string, args:unknown, root:string \| null): { tool: string; path: string } \| null` | 2 |
| 844 | displayPath | function |  | `(root:string \| null, abs:string): string` | 3 |
| 852 | resolveReadDir | function |  | `(root:string \| null, p:unknown): string` | 3 |
| 858 | toInt | function |  | `(v:unknown): number \| null` | 3 |
| 863 | escapeRe | function |  | `(s:string): string` | 3 |
| 873 | compileGrepPattern | function |  | `(pattern:string, ignoreCase:boolean): { re: RegExp; note?: string }` | 1 |
| 900 | globToRegExp | function |  | `(glob:string): RegExp` | 2 |
| 946 | loadIgnoreLayer | function |  | `async (dir:string): Promise<IgnoreLayer \| null>` | 1 |
| 955 | isIgnoredBy | function |  | `(layers:IgnoreLayer[], abs:string, isDir:boolean): boolean` | 3 |
| 970 | ancestorIgnoreLayers | function |  | `async (dir:string): Promise<IgnoreLayer[]>` | 1 |
| 971 | exists | arrow |  | `(p:string): Promise<boolean>` | 2 |
| 997 | walkFiles | function |  | `async (root:string, gitignore=false): AsyncGenerator<{ abs: string; rel: str…` | 2 |
| 1007 | walk | function |  | `async (dir:string, rel:string, layers:IgnoreLayer[]): AsyncGenerator<{ abs: string; rel: str…` | 4 |
| 1041 | collectFiles | function |  | `async (root:string): Promise<{ abs: string; rel: string }[]>` | 1 |
| 1048 | readCapped | function |  | `async (res:Response, cap:number): Promise<Buffer>` | 1 |
| 1075 | safeFromCodePoint | function |  | `(cp:number): string` | 2 |
| 1085 | decodeEntities | function |  | `(s:string): string` | 2 |
| 1101 | htmlToText | function |  | `(html:string): { title: string \| null; text: string }` | 1 |
| 1139 | execEnv | function |  | `(): NodeJS.ProcessEnv` | 2 |
| 1183 | killTree | function |  | `(child:import('node:child_process').ChildProcess, msys?:MsysKillTarget): void` | 1 |
| 1187 | finalKill | arrow |  | `(): void` | 1 |
| 1195 | taskkill | arrow |  | `(): void` | 2 |
| 1241 | execCapture | function |  | `(command:string, cwd:string, timeoutMs:number, signal?:AbortSignal): Promise<ExecOutcome>` | 1 |
| 1293 | kill | arrow |  | `(): void` | 11 |
| 1305 | onData | arrow |  | `(buf:Buffer): void` | 1 |
| 1322 | onAbort | arrow |  | `(): void` | 0 |
| 1328 | finish | arrow |  | `(code:number \| null, spawnError?:string): void` | 11 |
| 1354 | numberedText | function |  | `(text:string, a:Record<string, unknown>, extraNote?:string): ToolResult` | 2 |
| 1395 | readImageResult | function |  | `(buf:Buffer, mime:ImageMime, abs:string): ToolResult` | 1 |
| 1428 | errorSummary | function |  | `(e:unknown): string` | 2 |
| 1436 | executeTool | function | export | `async (name:string, args:unknown, ctx:ToolContext): Promise<ToolResult>` | 2 |
| 1611 | searchFile | arrow |  | `async (f:{ abs: string }): Promise<string[]>` | 0 |
| 1632 | flush | arrow |  | `async (): Promise<void>` | 6 |
| 1786 | countOcc | arrow |  | `(hay:string, needle:string): number` | 2 |
| 2038 | plainMap | arrow |  | `(v:unknown): Record<string, string>` | 1 |
| 2049 | secretNames | arrow |  | `(v:unknown): string[]` | 3 |
| 2060 | buildMap | arrow |  | `(plainKey:string, secretKey:string): Record<string, McpValue>` | 2 |

### `apps/desktop/src/main/services/tray-icon.ts`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | crc32 | function |  | `(buf:Buffer): number` | 2 |
| 34 | pngChunk | function |  | `(type:string, data:Buffer): Buffer` | 3 |
| 44 | encodePng | function |  | `(width:number, height:number, rgba:Uint8Array): Buffer` | 4 |
| 77 | inBg | function |  | `(x:number, y:number): boolean` | 2 |
| 84 | inShape | function |  | `(x:number, y:number): boolean` | 3 |
| 104 | drawLogo | function |  | `(size:number, ss=8): Uint8Array` | 2 |
| 143 | getAppIcon | function | export | `(): NativeImage` | 4 |
| 169 | drawGlyph | function |  | `(size:number, glyphH:number, ss=8): Uint8Array` | 2 |
| 200 | getTrayIcon | function | export | `(): NativeImage` | 1 |

### `apps/desktop/src/main/services/updater.ts`（21 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 38 | getWindow | arrow |  | `()` | 13 |
| 45 | setState | function |  | `(next:UpdateState): void` | 11 |
| 51 | errorText | function |  | `(e:unknown): string` | 3 |
| 59 | compareVersions | function |  | `(a:string, b:string): number` | 2 |
| 78 | canAutoInstall | function |  | `(): boolean` | 1 |
| 86 | linuxPackage | function |  | `(): 'appimage' \| 'deb' \| null` | 1 |
| 94 | installerName | function |  | `(version:string): string \| null` | 1 |
| 122 | latestRelease | function |  | `async (): Promise<LatestRelease>` | 1 |
| 131 | latestFromApi | function |  | `async (): Promise<LatestRelease>` | 1 |
| 143 | latestFromWeb | function |  | `async (): Promise<LatestRelease>` | 1 |
| 158 | assetReady | function |  | `(tag:string, name:string): Promise<boolean>` | 1 |
| 170 | settle | arrow |  | `(fn:() => void): void` | 9 |
| 186 | check | function |  | `async (): Promise<void>` | 19 |
| 220 | getUpdater | function |  | `(): AppUpdater` | 1 |
| 238 | download | function |  | `async (): Promise<void>` | 2 |
| 259 | install | function |  | `async (): Promise<void>` | 2 |
| 268 | registerUpdaterIpc | function | export | `(getWin:() => BrowserWindow \| null): void` | 2 |
| 270 | ipc:update:get-state | ipc |  | `(): UpdateState` | 0 |
| 271 | ipc:update:check | ipc |  | `()` | 0 |
| 272 | ipc:update:download | ipc |  | `()` | 0 |
| 273 | ipc:update:install | ipc |  | `()` | 0 |

### `apps/desktop/src/main/services/workspace.ts`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 35 | looksBinary | function |  | `(buf:Buffer): boolean` | 8 |
| 41 | registerWorkspaceIpc | function | export | `(getWindow:() => BrowserWindow \| null): void` | 2 |
| 43 | ipc:fs:open-folder | ipc |  | `async (): Promise<OpenFolderResult \| null>` | 0 |
| 55 | ipc:fs:reveal-folder | ipc |  | `async (_e, dirPath:unknown): Promise<{ ok: boolean }>` | 0 |
| 64 | ipc:fs:read-dir | ipc |  | `async (_e, dirPath:string): Promise<DirEntry[]>` | 0 |
| 82 | ipc:fs:read-file | ipc |  | `async (_e, filePath:string): Promise<ReadFileResult>` | 0 |
| 92 | ipc:fs:write-file | ipc |  | `async (_e, filePath:string, content:string): Promise<{ ok: true }>` | 0 |

### `apps/desktop/src/main/services/xiaomajiang-personas.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

## B2 桌面·预加载（2 文件 / 15 条）

### `apps/desktop/src/preload/index.d.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/preload/index.ts`（15 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 929 | listener | arrow |  | `(_e:unknown, on:boolean): void` | 1 |
| 998 | listener | arrow |  | `(_e:unknown, skills:SkillRecord[]): void` | 1 |
| 1075 | listener | arrow |  | `(_e:unknown, view:McpServerView): void` | 1 |
| 1209 | listener | arrow |  | `(_e:unknown, payload:ChatEventPayload): void` | 1 |
| 1215 | listener | arrow |  | `(): void` | 1 |
| 1232 | listener | arrow |  | `(_e:unknown, payload:TerminalDataPayload): void` | 1 |
| 1238 | listener | arrow |  | `(_e:unknown, payload:TerminalExitPayload): void` | 1 |
| 1314 | listener | arrow |  | `(_e:unknown, reqId:string, text:string): void` | 1 |
| 1355 | listener | arrow |  | `(_e:unknown, tasks:TaskRecord[]): void` | 1 |
| 1364 | listener | arrow |  | `(_e:unknown, payload:{ sessionId?: string; pane?: 'tasks' }): void` | 1 |
| 1409 | listener | arrow |  | `(_e:unknown, state:BrowserUiState): void` | 1 |
| 1428 | listener | arrow |  | `(_e:unknown, frame:BrowserLiveFrame): void` | 1 |
| 1457 | listener | arrow |  | `(_e:unknown, state:UpdateState): void` | 1 |
| 1487 | listener | arrow |  | `(_e:unknown, state:RemoteState): void` | 1 |
| 1492 | listener | arrow |  | `(_e:unknown, ev:BotScanEvent): void` | 1 |

## C 桌面·渲染层（49 文件 / 869 条）

### `apps/desktop/src/renderer/src/App.tsx`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 9 | App | function | export | `(): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/browser-main.tsx`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/components/DialogProvider.tsx`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 54 | DialogProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 57 | confirm | arrow |  | `(opts:ConfirmOptions)` | 21 |
| 62 | prompt | arrow |  | `(opts:PromptOptions)` | 3 |
| 68 | api | arrow |  | `()` | 0 |
| 95 | useDialog | function | export | `(): DialogApi` | 9 |
| 101 | ConfirmView | function |  | `({
  req,
  onDone
}:{
  req: Extract<Request, { kind: 'confirm' }>
  onDone: (v: boolean…): React.JSX.Element` | 0 |
| 134 | PromptView | function |  | `({
  req,
  onDone
}:{
  req: Extract<Request, { kind: 'prompt' }>
  onDone: (v: string \|…): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/components/Modal.tsx`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 20 | Modal | function | export | `({
  open,
  onClose,
  width = 420,
  labelledBy,
  children
}:ModalProps): React.JSX.Element \| null` | 0 |
| 30 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |

### `apps/desktop/src/renderer/src/components/Select.tsx`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 70 | isOption | arrow |  | `(e:SelectEntry<V>): e is SelectOption<V>` | 0 |
| 91 | Select | function | export | `(props:SingleProps<V> \| MultiProps<V>): React.JSX.Element` | 0 |
| 106 | options | arrow |  | `()` | 0 |
| 107 | isOn | arrow |  | `(v:V): boolean` | 2 |
| 109 | place | arrow |  | `(): void` | 3 |
| 126 | openMenu | arrow |  | `(): void` | 4 |
| 132 | close | arrow |  | `(refocus:boolean): void` | 28 |
| 137 | pick | arrow |  | `(i:number): void` | 16 |
| 180 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 186 | onResize | arrow |  | `(): void` | 0 |
| 195 | onKeyDown | arrow |  | `(e:React.KeyboardEvent): void` | 0 |
| 204 | move | arrow |  | `(i:number): void` | 5 |

### `apps/desktop/src/renderer/src/components/ToastProvider.tsx`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 53 | ToastProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 58 | dismiss | arrow |  | `(id:number): void` | 2 |
| 67 | arm | arrow |  | `(id:number, ms:number): void` | 2 |
| 78 | show | arrow |  | `(opts:ToastOptions): void` | 60 |
| 89 | pause | arrow |  | `(id:number): void` | 1 |
| 96 | resume | arrow |  | `(id:number): void` | 1 |
| 114 | api | arrow |  | `()` | 0 |
| 138 | useToast | function | export | `(): ToastApi` | 15 |
| 144 | ToastCard | function |  | `({
  item,
  onClose,
  onPause,
  onResume
}:{
  item: ToastItem
  onClose: () => void
 …): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/components/humation.tsx`（52 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 113 | pick | function |  | `(arr:readonly T[]): T` | 16 |
| 126 | seededPalette | function | export | `(seed:string): { colors: Record<string, string>; back…` | 3 |
| 128 | next | arrow |  | `(n:number): number` | 5 |
| 150 | r2 | arrow |  | `(n:number): number` | 18 |
| 153 | polarPts | function |  | `(fn:(t: number) => number, n=180): Pt[]` | 7 |
| 162 | superellipsePts | function |  | `(a:number, n:number, m=160): Pt[]` | 1 |
| 172 | rotatePts | function |  | `(pts:Pt[], deg:number): Pt[]` | 1 |
| 179 | burstR | function |  | `(t:number): number` | 1 |
| 183 | fitPts | function |  | `(pts:Pt[], m=2): Pt[]` | 6 |
| 196 | smoothUnionPts | function |  | `(circles:[number, number, number][], k:number, n=200): Pt[]` | 2 |
| 197 | f | arrow |  | `(x:number, y:number): number` | 1 |
| 215 | ptsPath | function |  | `(pts:Pt[]): string` | 10 |
| 219 | roundPolyPath | function |  | `(pts:Pt[], rad:number): string` | 1 |
| 221 | unit | arrow |  | `(a:Pt, p:Pt): Pt` | 8 |
| 308 | resolveShape | function | export | `(seed:string, spec?:AvatarSpec \| null): AvatarShape` | 5 |
| 315 | shapePath | function | export | `(shape:AvatarShape): string` | 1 |
| 321 | shapeMaskImage | function | export | `(shape:AvatarShape): string` | 1 |
| 332 | shapeMask | function | export | `(shape:AvatarShape): string` | 1 |
| 339 | mapPath | function |  | `(shape:AvatarShape, b:Box): string` | 2 |
| 345 | X | arrow |  | `(v:number): number` | 4 |
| 346 | Y | arrow |  | `(v:number): number` | 4 |
| 349 | n | arrow |  | `(): number` | 15 |
| 370 | pickStrings | function |  | `(o:unknown): Record<string, string>` | 2 |
| 389 | validSelections | function |  | `(sel?:Record<string, string>): Record<string, string> \| undefined` | 3 |
| 403 | parseAvatarSpec | function | export | `(raw:string \| null \| undefined): AvatarSpec \| null` | 14 |
| 425 | serializeAvatarSpec | function | export | `(spec:AvatarSpec \| null \| undefined): string` | 4 |
| 437 | resolveSpec | function | export | `(seed:string, spec?:AvatarSpec \| null): Required<AvatarSpec>` | 3 |
| 458 | randomizeSpec | function | export | `(keepShape?:string): Required<AvatarSpec>` | 2 |
| 474 | partsForSlot | function | export | `(slot:string): PartOption[]` | 1 |
| 479 | partPreview | function | export | `(part:PartOption, colors?:Record<string, string>): string` | 1 |
| 484 | partLabel | function | export | `(part:PartOption): string` | 2 |
| 489 | isNonePart | function | export | `(part:PartOption): boolean` | 1 |
| 506 | humationParts | function |  | `(seed:string, selections:Record<string, string> \| undefined): HumationParts` | 2 |
| 536 | hex | arrow |  | `(v:string): string` | 4 |
| 543 | detectCutout | function |  | `(src:string): Promise<Cutout \| null>` | 1 |
| 559 | a | arrow |  | `(x:number, y:number): number` | 5 |
| 585 | useCutout | function |  | `(src?:string): Cutout \| null` | 1 |
| 610 | cutoutRect | function |  | `(cut:Cutout, pop:boolean): { x: number; y: number; w: number }` | 1 |
| 639 | PersonaFace | function | export | `(props:FaceProps): React.JSX.Element` | 0 |
| 650 | HumationFace | function | export | `(props:Omit<FaceProps, 'image'>): React.JSX.Element` | 0 |
| 669 | shapeRadii | function |  | `(shape:AvatarShape): Float32Array \| null` | 1 |
| 693 | easeInOut | arrow |  | `(x:number): number` | 1 |
| 700 | morphTick | function |  | `(ts:number): void` | 0 |
| 711 | runMorph | function |  | `(step:MorphStep): void` | 1 |
| 729 | useBusyMorph | function |  | `(busy:boolean, shape:AvatarShape, box:Box, rest:string, els:MorphEls): void` | 1 |
| 740 | paint | arrow |  | `(e:number, phi:number): void` | 2 |
| 756 | step | arrow |  | `(dt)` | 25 |
| 783 | FaceSvg | function |  | `({ seed, spec, image, size, title, className, compact, busy, veil }:FaceProps): React.JSX.Element` | 0 |
| 836 | els | arrow |  | `()` | 0 |
| 888 | avatarDataUri | function | export | `(seed:string, spec?:AvatarSpec \| null, image?:string): string` | 2 |
| 932 | FaceBoundary.getDerivedStateFromError | method |  | `(): { failed: boolean }` | 0 |
| 936 | FaceBoundary.render | method |  | `(): ReactNode` | 6 |

### `apps/desktop/src/renderer/src/env.d.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/features/browser/BrowserCapsule.tsx`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 50 | BrowserCapsule | function | export | `({ sessionId }:{ sessionId: string \| null }): React.JSX.Element \| null` | 0 |
| 82 | on | arrow |  | `(): void` | 90 |
| 111 | close | arrow |  | `(): void` | 28 |
| 115 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 118 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 140 | place | arrow |  | `(): void` | 3 |
| 150 | watch | arrow |  | `(): void` | 5 |
| 171 | openWindow | arrow |  | `(tab?:string): void` | 2 |
| 178 | showPreview | arrow |  | `(tab:string \| null, mode:Preview['mode']): void` | 3 |
| 183 | hoverIn | arrow |  | `(): void` | 0 |
| 188 | hoverOut | arrow |  | `(): void` | 0 |
| 194 | toggle | arrow |  | `(): void` | 8 |

### `apps/desktop/src/renderer/src/features/browser/BrowserChrome.tsx`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 43 | BrowserChrome | function | export | `(): React.JSX.Element` | 0 |
| 55 | personaKey | arrow |  | `()` | 0 |
| 71 | persona | arrow |  | `(id?:string): PersonaRecord \| undefined` | 3 |
| 72 | face | arrow |  | `(id?:string): React.JSX.Element` | 3 |
| 86 | openMenu | arrow |  | `(btn:HTMLElement): void` | 4 |

### `apps/desktop/src/renderer/src/features/browser/shared.tsx`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 9 | useBrowserState | function | export | `(): BrowserUiState \| null` | 3 |
| 23 | PagesPanel | function | export | `({
  sessionId,
  tabs,
  current,
  locked,
  onPick
}:{
  sessionId: string
  tabs: Bro…): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/features/browser/text.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 27 | doingText | function | export | `(t:(key: string) => string, action:string, label?:string): string` | 2 |
| 35 | tabTitle | function | export | `(t:(key: string) => string, tab:{ title: string; url: string }): string` | 5 |
| 49 | siteOf | function | export | `(url:string): { host: string; secure: boolean } \| null` | 3 |
| 60 | displayUrl | function | export | `(url:string): string` | 1 |

### `apps/desktop/src/renderer/src/features/chat/BackgroundTasks.tsx`（9 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 14 | currentChild | function |  | `(task:SubagentBlock): { step?: SubagentBlock['children'][num…` | 1 |
| 26 | SubagentProgressNotice | function | export | `({ ownerName }:{ ownerName: string }): React.JSX.Element \| null` | 0 |
| 29 | groups | arrow |  | `()` | 0 |
| 73 | BackgroundCapsule | function | export | `(): React.JSX.Element \| null` | 0 |
| 81 | tasks | arrow |  | `()` | 0 |
| 97 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 100 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 116 | stop | arrow |  | `(ids:string[]): void` | 11 |
| 123 | stopButton | arrow |  | `(task:SubagentBlock): React.JSX.Element` | 2 |

### `apps/desktop/src/renderer/src/features/chat/DeliverablesCard.tsx`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 30 | formatSize | function |  | `(n:number): string` | 2 |
| 41 | placeholders | function |  | `(args:unknown): DeliverableInfo[]` | 1 |
| 51 | DeliverablesCard | function | export | `({
  block
}:{
  block: Extract<ChatBlock, { kind: 'tool' }>
}): React.JSX.Element` | 0 |
| 105 | open | arrow |  | `(i:number): void` | 6 |
| 114 | reveal | arrow |  | `(i:number): void` | 3 |
| 124 | copyPath | arrow |  | `(i:number, path:string): void` | 1 |
| 184 | primary | arrow |  | `(): void` | 0 |

### `apps/desktop/src/renderer/src/features/chat/Markdown.tsx`（5 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 23 | isBlockCode | function |  | `(className:string, children:ReactNode): boolean` | 1 |
| 29 | CopyButton | function | export | `({ getText }:{ getText: () => string }): React.JSX.Element` | 0 |
| 33 | copy | arrow |  | `(): void` | 2 |
| 54 | CodeBlock | function |  | `({
  lang,
  codeClassName,
  children
}:{
  lang?: string
  codeClassName: string
  chil…): React.JSX.Element` | 0 |
| 112 | Markdown | arrow | export | `({
  text,
  muted
}:{
  text: string
  muted?: boolean
}): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/features/chat/ModelSetupCard.tsx`（16 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 36 | rank | arrow |  | `(id:string): number` | 2 |
| 59 | byVersionDesc | arrow |  | `(a:string, b:string): number` | 0 |
| 64 | hostOf | function |  | `(url:string): string` | 1 |
| 72 | recommendOf | function |  | `(pid:string, ids:string[]): string \| null` | 1 |
| 80 | ModelSetupCard | function | export | `(): React.JSX.Element` | 0 |
| 126 | presets | arrow |  | `()` | 0 |
| 154 | chatLike | arrow |  | `()` | 0 |
| 155 | visible | arrow |  | `()` | 0 |
| 165 | descOf | arrow |  | `(id:string): string` | 3 |
| 171 | dropCustom | arrow |  | `(): void` | 1 |
| 178 | choose | arrow |  | `(id:string): void` | 8 |
| 186 | backToPick | arrow |  | `(): void` | 0 |
| 194 | goManual | arrow |  | `(): void` | 2 |
| 202 | resolveTarget | arrow |  | `(): { id: string; adapter: Adapter; host: …` | 1 |
| 227 | verify | arrow |  | `async (): Promise<void>` | 2 |
| 281 | finish | arrow |  | `(): void` | 11 |

### `apps/desktop/src/renderer/src/features/chat/ScheduleEditor.tsx`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 21 | pad2 | arrow |  | `(n:number): string` | 12 |
| 35 | ScheduleEditor | function | export | `({
  initial,
  tz,
  onChange
}:{
  /** 初值（草稿或既有任务的日程）；仅首挂载读取，后续由本组件自持。 */
  initial: Ta…): React.JSX.Element` | 0 |
| 50 | onceInit | arrow |  | `()` | 0 |
| 57 | initRecur | arrow |  | `()` | 0 |
| 68 | schedule | arrow |  | `()` | 3 |
| 88 | toggleDow | arrow |  | `(d:number): void` | 1 |

### `apps/desktop/src/renderer/src/features/chat/TaskConfirmCard.tsx`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | taskErrorKey | function | export | `(code:string): string` | 2 |
| 53 | useModelLabel | function |  | `(): (ref: string \| null) => string` | 2 |
| 65 | useNextShort | function |  | `(): (ms: number \| null) => string` | 2 |
| 78 | TaskConfirmCard | function | export | `({
  block,
  onOpen
}:{
  block: Extract<ChatBlock, { kind: 'autotaskcard' }>
  /** crea…): React.JSX.Element` | 0 |
| 95 | TaskTerminalCard | function |  | `({
  block,
  onOpen
}:{
  block: Extract<ChatBlock, { kind: 'autotaskcard' }>
  onOpen?:…): React.JSX.Element` | 0 |
| 107 | task | arrow |  | `()` | 0 |
| 182 | TaskEditor | function |  | `({
  block
}:{
  block: Extract<ChatBlock, { kind: 'autotaskcard' }>
}): React.JSX.Element` | 0 |
| 208 | enabledPersonas | arrow |  | `()` | 0 |
| 215 | tz | arrow |  | `()` | 0 |
| 243 | nextText | arrow |  | `(ms:number \| null): string` | 2 |
| 256 | confirm | arrow |  | `async (): Promise<void>` | 21 |
| 274 | dismiss | arrow |  | `async (): Promise<void>` | 2 |

### `apps/desktop/src/renderer/src/features/chat/TaskPickers.tsx`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 22 | TaskModelSelect | function | export | `({
  value,
  onChange
}:{
  value: string \| null
  onChange: (ref: string \| null) => voi…): React.JSX.Element` | 0 |
| 34 | groups | arrow |  | `()` | 0 |
| 44 | selected | arrow |  | `()` | 0 |
| 136 | clipChatTitle | function | export | `(name:string, max:number): string` | 2 |
| 137 | units | arrow |  | `(c:string): number` | 3 |
| 161 | TaskRunModeSelect | function | export | `({
  value,
  taskSessionId,
  faceOf,
  onChange
}:{
  value: string \| null
  /** 任务自己的对…): React.JSX.Element` | 0 |
| 178 | chats | arrow |  | `()` | 0 |
| 187 | titleOf | arrow |  | `(title:string): string` | 2 |
| 189 | subOf | arrow |  | `(s:SessionMeta): string \| undefined` | 1 |
| 253 | TaskPersonaSelect | function | export | `({
  value,
  onChange
}:{
  value: string \| null
  onChange: (id: string \| null) => void
}): React.JSX.Element` | 0 |
| 264 | enabled | arrow |  | `()` | 0 |
| 266 | selected | arrow |  | `()` | 0 |

### `apps/desktop/src/renderer/src/features/chat/Todos.tsx`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 14 | countDone | function |  | `(items:TodoItem[]): number` | 1 |
| 19 | TodoItemList | function | export | `({ items }:{ items: TodoItem[] }): React.JSX.Element` | 0 |
| 47 | ProgressRing | function |  | `({ value }:{ value: number }): React.JSX.Element` | 0 |
| 71 | TodoCapsule | function | export | `(): React.JSX.Element \| null` | 0 |
| 84 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 87 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |

### `apps/desktop/src/renderer/src/features/chat/blocks.tsx`（77 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 152 | toolMeta | function |  | `(name:string, args?:unknown): { key: string; icon: LucideIcon } \| un…` | 2 |
| 165 | browserObject | function |  | `(args:unknown): { text: string; full: string } \| null` | 1 |
| 167 | pick | arrow |  | `(v:unknown): string` | 16 |
| 191 | shortPath | function |  | `(p:string): string` | 1 |
| 207 | memberObject | function |  | `(name:string, args:unknown): { who: string; task: string } \| null` | 3 |
| 229 | useTaskStatusStep | function |  | `(step:{ name: string; args: unknown }): boolean` | 2 |
| 239 | usageObject | function |  | `(args:unknown, t?:(key: string) => string): { text: string; full: string } \| null` | 1 |
| 243 | key | arrow |  | `(n:string): string \| undefined` | 19 |
| 248 | flowObject | function |  | `(name:string, args:unknown, t?:(key: string) => string): { text: string; full: string } \| null` | 4 |
| 305 | deriveActivity | function | export | `(messages:ChatMessage[]): Activity` | 1 |
| 333 | StatusIndicator | function | export | `({
  activity,
  status,
  folded = false,
  pending = false,
  onStop
}:{
  activity: Ac…): React.JSX.Element \| null` | 0 |
| 459 | formatElapsed | function |  | `(sec:number): string` | 2 |
| 472 | LiveThinkingWindow | function | export | `({ text }:{ text: string }): React.JSX.Element` | 0 |
| 493 | useAnchorOnClose | function |  | `(open:boolean): [React.RefObject<T>, () => void]` | 3 |
| 511 | TimelineThinking | function |  | `({
  text,
  done,
  autoOpen = true
}:{
  text: string
  done: boolean
  autoOpen?: bool…): React.JSX.Element` | 0 |
| 530 | toggle | arrow |  | `(): void` | 8 |
| 566 | BlockView | function | export | `({
  block,
  thinkingDone,
  onAsk,
  onPlan,
  onMountReq,
  onOpenProposal,
  onOpenAu…): React.JSX.Element \| null` | 0 |
| 684 | MountRequestCard | function |  | `({
  block,
  onMountReq,
  bare,
  extra,
  hint
}:{
  block: Extract<ChatBlock, { kind:…): React.JSX.Element` | 0 |
| 700 | pick | arrow |  | `(): void` | 16 |
| 709 | name | arrow |  | `(s:string): string` | 2 |
| 835 | PlanReviewCard | function |  | `({
  block,
  onPlan,
  bare,
  extra
}:{
  block: Extract<ChatBlock, { kind: 'plan' }>
 …): React.JSX.Element` | 0 |
| 854 | submitKeep | arrow |  | `(): void` | 1 |
| 975 | planSummary | function |  | `(plan:string): string` | 2 |
| 992 | isReco | arrow |  | `(label:string): boolean` | 1 |
| 993 | cleanLabel | arrow |  | `(label:string): string` | 1 |
| 996 | draftToAnswer | function |  | `(d:AskDraft): string` | 1 |
| 1009 | AskCard | function |  | `({
  block,
  onAsk,
  bare,
  extra
}:{
  block: Extract<ChatBlock, { kind: 'ask' }>
  o…): React.JSX.Element` | 0 |
| 1043 | patchDraft | arrow |  | `(qi:number, patch:Partial<AskDraft>): void` | 5 |
| 1048 | pickReal | arrow |  | `(qi:number, label:string): void` | 1 |
| 1066 | toggleCustom | arrow |  | `(qi:number): void` | 2 |
| 1079 | onInlineBlur | arrow |  | `(qi:number): void` | 1 |
| 1091 | focusInline | arrow |  | `(el:HTMLTextAreaElement \| null): void` | 0 |
| 1098 | inputShown | arrow |  | `(qi:number): boolean` | 1 |
| 1102 | isAnswered | arrow |  | `(qi:number): boolean` | 3 |
| 1108 | isDone | arrow |  | `(qi:number): boolean` | 3 |
| 1111 | isBlank | arrow |  | `(qi:number): boolean` | 2 |
| 1114 | clearTimer | arrow |  | `(): void` | 6 |
| 1120 | goStep | arrow |  | `(i:number): void` | 4 |
| 1126 | onOptionClick | arrow |  | `(qi:number, label:string): void` | 1 |
| 1139 | submit | arrow |  | `(): void` | 3 |
| 1149 | onCustomKeyDown | arrow |  | `(e:React.KeyboardEvent, qi:number): void` | 2 |
| 1160 | renderBody | arrow |  | `(qi:number): React.JSX.Element` | 2 |
| 1424 | verbKey | function |  | `(name:string, args?:unknown): string` | 2 |
| 1430 | isFailed | arrow |  | `(status:ToolStatus): boolean` | 7 |
| 1436 | failReason | function |  | `(step:ToolStep, t:(key: string) => string): string \| null` | 2 |
| 1443 | stepTitle | function |  | `(step:ToolStep, t:(key: string) => string): string \| undefined` | 2 |
| 1451 | stepIcon | function |  | `(step:ToolStep, size:number, taskStatus=false): React.JSX.Element` | 3 |
| 1465 | ToolText | function | export | `({ step }:{ step: ToolStep }): React.JSX.Element` | 0 |
| 1507 | TimelineTool | function |  | `({ step }:{ step: ToolStep }): React.JSX.Element` | 0 |
| 1561 | TimelineNote | function |  | `({ text }:{ text: string }): React.JSX.Element` | 0 |
| 1578 | TimelineAsk | function |  | `({ block }:{ block: Extract<ChatBlock, { kind: 'ask' }> }): React.JSX.Element` | 0 |
| 1620 | TimelinePlan | function |  | `({ block }:{ block: Extract<ChatBlock, { kind: 'plan' }> }): React.JSX.Element` | 0 |
| 1662 | TimelineTodo | function |  | `({ block }:{ block: Extract<ChatBlock, { kind: 'todolist' }> }): React.JSX.Element` | 0 |
| 1697 | TimelineMount | function |  | `({ block }:{ block: Extract<ChatBlock, { kind: 'mount' }> }): React.JSX.Element` | 0 |
| 1728 | CompactionNotice | function | export | `({ summary, first = false }:{ summary: string; first?: boolean }): React.JSX.Element` | 0 |
| 1761 | TimelineCompaction | function |  | `({ summary, steps }:{ summary: string; steps: number }): React.JSX.Element` | 0 |
| 1805 | TimelineInsert | function |  | `({ text }:{ text: string }): React.JSX.Element` | 0 |
| 1832 | Timeline | function | export | `({
  steps,
  liveBlock,
  compact = false,
  limit
}:{
  steps: TimelineStep[]
  liveBlo…): React.JSX.Element` | 0 |
| 1893 | isTimelineStep | function |  | `(b:ChatBlock): boolean` | 3 |
| 1921 | groupBlocks | function | export | `(blocks:ChatBlock[], notesInline=false): BlockItem[]` | 1 |
| 1925 | flush | arrow |  | `(): void` | 6 |
| 1955 | isPinned | function |  | `(b:ChatBlock): boolean` | 2 |
| 1975 | isDelivery | function |  | `(b:ChatBlock): b is Extract<ChatBlock, { kind: 'tool'…` | 0 |
| 1983 | DeliveryCards | function | export | `({ blocks }:{ blocks: ChatBlock[] }): React.JSX.Element` | 0 |
| 1994 | isProcess | function |  | `(b:ChatBlock): boolean` | 1 |
| 2000 | hasProcess | function | export | `(blocks:ChatBlock[]): boolean` | 1 |
| 2011 | splitProcess | function | export | `(blocks:ChatBlock[], live=false): { process: ChatBlock[]; visible: ChatB…` | 1 |
| 2039 | currentSteps | function | export | `(blocks:ChatBlock[]): ChatBlock[]` | 1 |
| 2052 | thoughtOnly | function |  | `(blocks:ChatBlock[]): string \| null` | 1 |
| 2059 | formatDuration | function | export | `(sec:number, t:(key: string) => string): string` | 4 |
| 2063 | unit | arrow |  | `(key:string, n:number): string` | 8 |
| 2086 | ProcessFold | function | export | `({
  blocks,
  durationMs,
  live = false,
  thinking = false,
  elapsedSec,
  preview,
 …): React.JSX.Element` | 0 |
| 2114 | toggle | arrow |  | `(): void` | 8 |
| 2175 | subagentName | function |  | `(agent:string \| undefined, t:(key: string) => string): string` | 2 |
| 2184 | subagentTitle | function | export | `(block:Extract<ChatBlock, { kind: 'subagent' }>, t:(key: string) => string): string` | 6 |
| 2198 | TimelineSubagent | function |  | `({ block }:{ block: Extract<ChatBlock, { kind: 'subagent' }> }): React.JSX.Element` | 0 |
| 2271 | AgentCard | function |  | `({
  block,
  onOpen
}:{
  block: Extract<ChatBlock, { kind: 'agentcard' }>
  onOpen?: (b…): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/features/chat/dockOrder.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 11 | useDockOrder | function | export | `(visible:boolean, key:string \| null): number \| undefined` | 4 |

### `apps/desktop/src/renderer/src/features/chat/schedule.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 12 | localDatetimeValue | function | export | `(d:Date): string` | 1 |
| 13 | p | arrow |  | `(n:number): string` | 4 |
| 18 | normalizeDows | function | export | `(dows:number[]): number[]` | 3 |
| 29 | parseRecur | function | export | `(cron:string): {
  mode: RecurMode
  time: string
  d…` | 1 |
| 51 | num | arrow |  | `(s:string): number \| null` | 10 |
| 53 | dowList | arrow |  | `(s:string): number[] \| null` | 1 |
| 58 | fmt | arrow |  | `(hh:string, mm:string): string` | 23 |
| 81 | buildCron | function | export | `(mode:RecurMode, time:string, dows:number[], hourlyMin:number, everyN:number, dom:number,…): string` | 1 |

### `apps/desktop/src/renderer/src/features/settings/ModelDetail.tsx`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | ModelDetail | function | export | `({ provider, model, onBack, onUpdate }:Props): React.JSX.Element` | 0 |
| 42 | commitName | arrow |  | `(): void` | 0 |
| 142 | LimitField | function |  | `({
  label,
  autoText,
  value,
  presets,
  range,
  note,
  check,
  onChange
}:LimitF…): React.JSX.Element` | 0 |
| 153 | show | arrow |  | `(n:number \| undefined): string` | 60 |
| 182 | close | arrow |  | `(): void` | 28 |
| 197 | commit | arrow |  | `(raw:string): void` | 3 |
| 225 | pick | arrow |  | `(e:React.MouseEvent, n:number \| undefined): void` | 16 |

### `apps/desktop/src/renderer/src/features/settings/ModelSettings.tsx`（22 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 42 | ModelSettings | function | export | `(): React.JSX.Element` | 0 |
| 109 | seedHost | arrow |  | `()` | 0 |
| 114 | suggestions | arrow |  | `()` | 0 |
| 134 | renderProviderRow | arrow |  | `(p:(typeof providers)[number]): React.JSX.Element` | 0 |
| 164 | onPickPreset | arrow |  | `async (presetId:string): Promise<void>` | 1 |
| 187 | commitName | arrow |  | `(): void` | 0 |
| 195 | onDeleteProvider | arrow |  | `async (): Promise<void>` | 1 |
| 210 | openProvider | arrow |  | `(id:string): void` | 1 |
| 216 | openModel | arrow |  | `(id:string): void` | 1 |
| 223 | onAddProvider | arrow |  | `(purpose:ProviderPurpose): void` | 1 |
| 231 | resetHost | arrow |  | `(): void` | 0 |
| 235 | onHostBlur | arrow |  | `(): void` | 0 |
| 241 | startAddModel | arrow |  | `(): void` | 0 |
| 265 | closeAddModel | arrow |  | `(): void` | 3 |
| 271 | confirmAddModel | arrow |  | `(explicitId?:string): void` | 1 |
| 278 | toggleSel | arrow |  | `(id:string): void` | 1 |
| 291 | toggleSelectAll | arrow |  | `(): void` | 1 |
| 300 | confirmAdd | arrow |  | `(): void` | 1 |
| 309 | clearKeyTimer | function |  | `(): void` | 4 |
| 318 | doSaveKey | arrow |  | `async (providerId:string, value:string): Promise<void>` | 2 |
| 327 | onKeyChange | arrow |  | `(providerId:string, value:string): void` | 1 |
| 339 | flushKey | arrow |  | `async (providerId:string): Promise<void>` | 2 |

### `apps/desktop/src/renderer/src/features/settings/Switch.tsx`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 2 | Switch | function | export | `({
  checked,
  onChange,
  title
}:{
  checked: boolean
  onChange: (next: boolean) => v…): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/i18n/i18n.tsx`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | detectLocale | function |  | `(): Locale` | 0 |
| 46 | resolve | function |  | `(tree:MessageTree, key:string): string` | 102 |
| 56 | I18nProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 63 | setLocale | arrow |  | `(next:Locale): void` | 1 |
| 74 | value | arrow |  | `()` | 0 |
| 82 | useI18n | function | export | `(): I18nContextValue` | 113 |

### `apps/desktop/src/renderer/src/i18n/messages.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/main.tsx`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/mock/extensions.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/mock/models.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/renderer/src/redesign/AvatarEditor.tsx`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 27 | toHexInput | arrow |  | `(v:string \| undefined): string` | 3 |
| 31 | fromHexInput | arrow |  | `(v:string): string` | 2 |
| 43 | fileToAvatarDataUri | function |  | `(file:File): Promise<string>` | 1 |
| 84 | AvatarEditor | function | export | `({
  seed,
  initialSpec,
  initialImage,
  title,
  busy,
  onCancel,
  onDone
}:{
  see…): React.JSX.Element` | 0 |
| 110 | onPickImage | arrow |  | `(e:React.ChangeEvent<HTMLInputElement>): void` | 0 |
| 123 | slotPreviews | arrow |  | `()` | 0 |
| 134 | setSelection | arrow |  | `(slot:string, partId:string): void` | 1 |
| 136 | setColorSlot | arrow |  | `(slot:string, hex:string): void` | 1 |
| 138 | setBackground | arrow |  | `(hex:string): void` | 1 |
| 141 | randomize | arrow |  | `(): void` | 0 |

### `apps/desktop/src/renderer/src/redesign/BotsPane.tsx`（21 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 32 | BotsPane | function | export | `(): React.JSX.Element` | 0 |
| 61 | shown | arrow |  | `()` | 0 |
| 154 | BotAddMenu | function |  | `({ onPick }:{ onPick: (p: Platform) => void }): React.JSX.Element` | 0 |
| 158 | cancelClose | arrow |  | `(): void` | 6 |
| 165 | scheduleClose | arrow |  | `(): void` | 0 |
| 219 | PlatformLogo | function |  | `({ platform, size }:{ platform: string; size: number }): React.JSX.Element` | 0 |
| 241 | ScanModal | function |  | `({
  platform,
  onClose,
  onCreated
}:{
  platform: Platform
  onClose: () => void
  on…): React.JSX.Element` | 0 |
| 268 | cancelScan | arrow |  | `(): void` | 2 |
| 273 | start | arrow |  | `async ()` | 6 |
| 428 | fmtLeft | function |  | `(sec:number): string` | 2 |
| 435 | BotDetail | function |  | `({ bot }:{ bot: BotView }): React.JSX.Element` | 0 |
| 466 | toggle | arrow |  | `async (): Promise<void>` | 8 |
| 476 | removeUser | arrow |  | `async (id:string): Promise<void>` | 2 |
| 486 | remove | arrow |  | `async (): Promise<void>` | 17 |
| 621 | ScopeCard | function |  | `({ bot }:{ bot: BotView }): React.JSX.Element` | 0 |
| 639 | picked | arrow |  | `(k:ScopeKind): number` | 2 |
| 644 | save | arrow |  | `(next:Scope): void` | 13 |
| 646 | pickMode | arrow |  | `(m:Scope['mode']): void` | 1 |
| 699 | ScopePicker | function |  | `({
  kind,
  selected,
  personas,
  sessions,
  onClose,
  onSave
}:{
  kind: ScopeKind
…): React.JSX.Element` | 0 |
| 718 | items | arrow |  | `()` | 0 |
| 741 | toggle | arrow |  | `(id:string): void` | 8 |

### `apps/desktop/src/renderer/src/redesign/ChatFirstShell.tsx`（292 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 212 | basename | function |  | `(p:string): string` | 22 |
| 217 | samePath | function |  | `(a:string, b:string): boolean` | 2 |
| 218 | norm | arrow |  | `(p:string): string` | 6 |
| 229 | clipName | function |  | `(s:string, max=20): string` | 5 |
| 238 | DragBar | function |  | `(): React.JSX.Element` | 0 |
| 248 | useTrafficLights | function |  | `(): boolean` | 1 |
| 267 | reorderIds | function |  | `(ids:string[], dragId:string, targetId:string, place:'before' \| 'after'): string[]` | 1 |
| 338 | useRelativeTime | function |  | `(): (ts: number) => string` | 4 |
| 366 | ChatFirstShell | function | export | `(): React.JSX.Element` | 0 |
| 400 | boundTasks | arrow |  | `()` | 0 |
| 401 | boundTaskSessions | arrow |  | `()` | 0 |
| 410 | chatAlert | arrow |  | `()` | 0 |
| 433 | clearPeekTimer | arrow |  | `(): void` | 6 |
| 437 | setCollapsed | arrow |  | `(next:boolean): void` | 3 |
| 446 | peekEnter | arrow |  | `(): void` | 0 |
| 454 | peekStay | arrow |  | `(): void` | 0 |
| 460 | typingInPeek | arrow |  | `(): boolean` | 1 |
| 464 | peekLeave | arrow |  | `(): void` | 0 |
| 473 | peekFocusOut | arrow |  | `(): void` | 0 |
| 484 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 511 | openSettings | arrow |  | `(init:SettingsInit={}): void` | 2 |
| 525 | defaultPersona | arrow |  | `()` | 0 |
| 533 | taskPersonaOf | arrow |  | `(title:string): Persona \| undefined` | 1 |
| 547 | sessions | arrow |  | `()` | 0 |
| 550 | known | arrow |  | `(s:SessionMeta): boolean` | 1 |
| 562 | memberOf | arrow |  | `()` | 0 |
| 571 | taskOf | arrow |  | `()` | 0 |
| 596 | toMemberEntry | arrow |  | `(m:MemberMeta): MemberEntry` | 1 |
| 598 | currentMembers | arrow |  | `()` | 0 |
| 608 | formerMembers | arrow |  | `()` | 0 |
| 619 | mentionables | arrow |  | `()` | 0 |
| 638 | removeMemberFrom | arrow |  | `(mainId:string, m:MemberMeta): void` | 1 |
| 658 | railSessions | arrow |  | `()` | 0 |
| 668 | openThread | arrow |  | `(id:string): void` | 1 |
| 673 | openProfile | arrow |  | `(personaId:string): void` | 0 |
| 678 | openProposal | arrow |  | `(block:Extract<ChatBlock, { kind: 'agentcard' }>): void` | 0 |
| 685 | openAutotask | arrow |  | `(taskId:string): void` | 0 |
| 704 | startWith | arrow |  | `(personaId:string): void` | 2 |
| 712 | newChatFromThread | arrow |  | `(id:string): void` | 0 |
| 722 | addPersonaByChat | arrow |  | `(): void` | 0 |
| 731 | addTaskByChat | arrow |  | `(): void` | 0 |
| 740 | editTask | arrow |  | `()` | 0 |
| 741 | runBoundTask | arrow |  | `(task:TaskRecord): void` | 0 |
| 757 | toggleBoundTask | arrow |  | `(task:TaskRecord): void` | 0 |
| 762 | deleteBoundTask | arrow |  | `(task:TaskRecord): void` | 0 |
| 780 | deleteThread | arrow |  | `(id:string, title:string): void` | 0 |
| 807 | renameThread | arrow |  | `(id:string, title:string): void` | 0 |
| 821 | archiveThread | arrow |  | `(id:string, title:string): void` | 0 |
| 838 | deleteTurnsWithConfirm | arrow |  | `async (indices:number[]): Promise<boolean>` | 0 |
| 854 | deletePersona | arrow |  | `(id:string, name:string): void` | 1 |
| 1093 | fill | function |  | `(s:string, vars:Record<string, string>): string` | 28 |
| 1104 | memberPersona | function |  | `(m:MemberMeta, personas:Persona[], fallback?:Persona): Persona \| undefined` | 6 |
| 1119 | MemberBar | function |  | `({
  members,
  sessionStates,
  waiting,
  onOpen,
  onRemove
}:{
  members: MemberEntry…): React.JSX.Element \| null` | 0 |
| 1143 | close | arrow |  | `(): void` | 28 |
| 1144 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 1147 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 1303 | memberWaitId | arrow |  | `(w:MemberWait): string` | 10 |
| 1326 | Fold | function |  | `({
  open,
  instant,
  className,
  children
}:{
  open: boolean
  instant?: boolean
  c…): React.JSX.Element` | 0 |
| 1358 | MemberAsks | function |  | `({
  waits,
  onAsk,
  onPlan,
  onMountReq,
  onOpenMember
}:{
  waits: MemberWait[]
  o…): React.JSX.Element \| null` | 0 |
| 1382 | resolveOpen | arrow |  | `(list:MemberWait[]): string \| null` | 1 |
| 1447 | done | arrow |  | `(w:MemberWait, index:number, key:string, ok:boolean): void` | 7 |
| 1588 | TaskSpeakerFace | function |  | `({ persona, size }:{ persona?: Persona; size: number }): React.JSX.Element` | 0 |
| 1600 | useShortTime | function |  | `(): (ms: number) => string` | 1 |
| 1607 | sameDay | arrow |  | `(a:Date, b:Date): boolean` | 2 |
| 1622 | TaskBar | function |  | `({
  tasks,
  sessionStates,
  onOpen,
  onRun,
  onToggle,
  onDelete
}:{
  tasks: TaskR…): React.JSX.Element \| null` | 0 |
| 1644 | close | arrow |  | `(): void` | 28 |
| 1645 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 1648 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 1716 | TaskBarRow | function |  | `({
  task,
  busy,
  startedAt,
  onOpen,
  onRun,
  onToggle,
  onDelete
}:{
  task: Tas…): React.JSX.Element` | 0 |
| 1810 | TaskLogHead | function |  | `({
  view,
  streaming,
  onRun,
  onToggle,
  onEdit
}:{
  view: NonNullable<Parameters<…): React.JSX.Element` | 0 |
| 1881 | HandoffNotice | function |  | `({ handoff }:{ handoff: HandoffInfo }): React.JSX.Element` | 0 |
| 1916 | MemberLogHead | function |  | `({
  view,
  streaming
}:{
  view: NonNullable<Parameters<typeof Conversation>[0]['member…): React.JSX.Element` | 0 |
| 1952 | IconRail | function |  | `({
  tab,
  onTab,
  listCollapsed,
  onChatsHover,
  onChatsLeave,
  onOpenSettings,
  c…): React.JSX.Element` | 0 |
| 2058 | folderKeyOf | arrow |  | `(s:SessionMeta): string` | 2 |
| 2060 | passRoles | arrow |  | `(s:SessionMeta, roles:string[]): boolean` | 2 |
| 2062 | passFolders | arrow |  | `(s:SessionMeta, folders:string[]): boolean` | 2 |
| 2073 | Rail | function |  | `({
  tab,
  sessions,
  personas,
  currentSessionId,
  sessionStates,
  viewPersonaId,
 …): React.JSX.Element` | 0 |
| 2138 | setQuery | arrow |  | `(v:string): void` | 12 |
| 2150 | tasksBySession | arrow |  | `()` | 0 |
| 2155 | browserPages | arrow |  | `()` | 0 |
| 2160 | liveSessions | arrow |  | `()` | 0 |
| 2161 | archivedSessions | arrow |  | `()` | 0 |
| 2178 | clearFilters | arrow |  | `(): void` | 3 |
| 2215 | onDown | arrow |  | `(e:MouseEvent): void` | 0 |
| 2221 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 2231 | roleIds | arrow |  | `()` | 0 |
| 2232 | folderKeys | arrow |  | `()` | 0 |
| 2236 | toggleFilter | arrow |  | `(kind:ConvFilter['kind'], value:string): void` | 2 |
| 2243 | startFresh | arrow |  | `(fn:() => void): void` | 4 |
| 2250 | filterOptions | arrow |  | `()` | 0 |
| 2263 | count | arrow |  | `(key:string): number` | 2 |
| 2298 | ordered | arrow |  | `()` | 0 |
| 2313 | shownPersonas | arrow |  | `()` | 0 |
| 2320 | clearDrag | arrow |  | `(): void` | 1 |
| 2325 | dropOnPersona | arrow |  | `(targetId:string, edge:'before' \| 'after'): void` | 1 |
| 2332 | pinPersona | arrow |  | `(id:string): void` | 1 |
| 2337 | threadRow | arrow |  | `(s:SessionMeta): React.JSX.Element` | 0 |
| 2678 | ContextMenu | function |  | `({
  x,
  y,
  items,
  onClose,
  openUp = false
}:{
  x: number
  y: number
  items: Ct…): React.JSX.Element` | 0 |
| 2710 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |
| 2775 | probeGitAvailable | function |  | `(): Promise<boolean>` | 1 |
| 2786 | gitReasonText | function |  | `(t:(k: string) => string, reason?:GitFailReason): string` | 6 |
| 2796 | gitErrorDetail | function |  | `(message?:string): string` | 1 |
| 2807 | gitErrorToast | function |  | `(t:(k: string) => string, r:{ reason?: GitFailReason; message?: string }): ToastOptions` | 5 |
| 2822 | isValidBranchName | function |  | `(raw:string): boolean` | 1 |
| 2841 | useGitStatus | function |  | `(root:string \| null): GitState` | 1 |
| 2847 | refresh | arrow |  | `async (): Promise<void>` | 7 |
| 2891 | GitWidget | function |  | `({ root, streaming }:{ root: string; streaming: boolean }): React.JSX.Element \| null` | 0 |
| 2916 | fmt | arrow |  | `(key:string, name:string): string` | 23 |
| 2921 | openMenu | arrow |  | `async (): Promise<void>` | 4 |
| 2934 | go | arrow |  | `(view:GitMenuView): void` | 3 |
| 2939 | run | arrow |  | `async (fn:() => Promise<{ ok: boolean; reason?: GitFailReason; message?: string }>, okMsg:string): Promise<void>` | 17 |
| 2957 | createBranch | arrow |  | `async (): Promise<void>` | 2 |
| 2971 | mergeBranch | arrow |  | `async (ref:string): Promise<void>` | 1 |
| 2993 | abortMerge | arrow |  | `async (confirm:boolean): Promise<void>` | 2 |
| 3008 | deleteBranch | arrow |  | `async (name:string): Promise<void>` | 3 |
| 3037 | renameBranch | arrow |  | `async (oldName:string): Promise<void>` | 2 |
| 3049 | deleteRemoteBranch | arrow |  | `async (b:GitBranchEntry): Promise<void>` | 2 |
| 3066 | checkout | arrow |  | `(b:GitBranchEntry): void` | 3 |
| 3082 | branchList | arrow |  | `(list:GitBranchEntry[], onPick:(b: GitBranchEntry) => void): CtxEntry[]` | 2 |
| 3085 | row | arrow |  | `(b:GitBranchEntry): CtxEntry` | 0 |
| 3243 | WorkspaceMenu | function |  | `({ root }:{ root: string }): React.JSX.Element` | 0 |
| 3249 | openMenu | arrow |  | `(): void` | 4 |
| 3257 | copyPath | arrow |  | `(): void` | 1 |
| 3263 | reveal | arrow |  | `(): void` | 3 |
| 3307 | cleanStreamingCommit | function |  | `(raw:string): string` | 1 |
| 3323 | CommitModal | function |  | `({
  root,
  status: initialStatus,
  locale,
  model,
  onClose,
  onDone
}:{
  root: st…): React.JSX.Element` | 0 |
| 3377 | changed | arrow |  | `()` | 4 |
| 3388 | stopGenerate | arrow |  | `(): void` | 0 |
| 3392 | generate | arrow |  | `async (): Promise<void>` | 1 |
| 3423 | submit | arrow |  | `async (): Promise<void>` | 3 |
| 3518 | useHoverMenu | function |  | `(): {
  open: boolean
  hoverProps: { onMo…` | 2 |
| 3527 | cancelClose | arrow |  | `(): void` | 6 |
| 3533 | scheduleClose | arrow |  | `(): void` | 0 |
| 3562 | NewChatMenu | function |  | `({
  personas,
  archivedCount,
  archiveHint,
  onStart,
  onOpenArchive
}:{
  personas:…): React.JSX.Element` | 0 |
| 3679 | AddMenu | function |  | `({
  manualLabel,
  chatLabel,
  onManual,
  onByChat
}:{
  /** 手动项文案，同时作 + 按钮的 title / a…): React.JSX.Element` | 0 |
| 3739 | GroupFace | function |  | `({
  people,
  working,
  dot,
  title
}:{
  people: Persona[]
  /** 与 people 一一对应：这一位是否在…): React.JSX.Element` | 0 |
| 3783 | ThreadRow | function |  | `({
  session,
  owner,
  memberFaces,
  state,
  membersWorking,
  browserPages,
  tasks,…): React.JSX.Element` | 0 |
| 3903 | PersonaRow | function |  | `({
  persona,
  active,
  dragging,
  dropEdge,
  onClick,
  onContext,
  onDragStart,
  …): React.JSX.Element` | 0 |
| 3930 | edgeAt | arrow |  | `(e:React.DragEvent): 'before' \| 'after'` | 2 |
| 3978 | QuickStart | function |  | `({
  personas,
  onStart
}:{
  personas: Persona[]
  onStart: (personaId: string) => void
}): React.JSX.Element` | 0 |
| 4017 | RosterEmpty | function |  | `(): React.JSX.Element` | 0 |
| 4044 | fmtAbs | function |  | `(ts:number, locale:'zh-CN' \| 'en'): string` | 2 |
| 4066 | TasksPane | function |  | `({
  target,
  onTargetConsumed,
  onAddByChat,
  onOpenChat
}:{
  /** 外部导航意图（对话里「查看任务」）：…): React.JSX.Element` | 0 |
| 4084 | chatTitle | arrow |  | `(task:TaskRecord): string \| null` | 1 |
| 4091 | hasChat | arrow |  | `(task:TaskRecord): boolean` | 1 |
| 4115 | groups | arrow |  | `()` | 0 |
| 4123 | byNext | arrow |  | `(a:TaskRecord, b:TaskRecord): number` | 0 |
| 4134 | viewTask | arrow |  | `()` | 0 |
| 4139 | editTask | arrow |  | `()` | 0 |
| 4145 | personaName | arrow |  | `(id:string \| null): string` | 13 |
| 4151 | modelLabel | arrow |  | `(ref:string \| null): string` | 3 |
| 4162 | doRunNow | arrow |  | `(task:TaskRecord): void` | 1 |
| 4190 | doDelete | arrow |  | `(task:TaskRecord): void` | 1 |
| 4269 | useSchedulePreview | function |  | `(schedule:TaskSchedule): string` | 4 |
| 4296 | TasksRail | function |  | `({
  groups,
  viewTaskId,
  onSelect,
  onDelete,
  onAddManual,
  onAddByChat
}:{
  gro…): React.JSX.Element` | 0 |
| 4320 | shown | arrow |  | `()` | 0 |
| 4413 | TaskRailRow | function |  | `({
  task,
  active,
  onClick,
  onContext
}:{
  task: TaskRecord
  active: boolean
  on…): React.JSX.Element` | 0 |
| 4484 | RunStatusIcon | function |  | `({
  status,
  label,
  detail
}:{
  status: TaskRunStatus
  label: string
  detail?: str…): React.JSX.Element` | 0 |
| 4518 | TaskDetail | function |  | `({
  task,
  personaName,
  modelLabel,
  onEdit,
  onSetStatus,
  onRunNow,
  onDelete,
…): React.JSX.Element` | 0 |
| 4546 | runKey | arrow |  | `(s:TaskRunStatus): string` | 2 |
| 4555 | history | arrow |  | `()` | 0 |
| 4701 | SessionFace | function |  | `({ session, size }:{ session: SessionMeta; size: number }): React.JSX.Element` | 0 |
| 4724 | TaskFormModal | function |  | `({
  task,
  hideRunMode,
  onClose,
  onSubmit
}:{
  /** 既有任务 → 编辑态；null → 手动新建（空表单 + 每天…): React.JSX.Element` | 0 |
| 4762 | tz | arrow |  | `()` | 0 |
| 4769 | initialSchedule | arrow |  | `()` | 0 |
| 4797 | nextText | arrow |  | `(ms:number \| null): string` | 2 |
| 4807 | submit | arrow |  | `async (): Promise<void>` | 3 |
| 4919 | TasksEmpty | function |  | `({ hasTasks }:{ hasTasks: boolean }): React.JSX.Element` | 0 |
| 4941 | groupTurns | function |  | `(messages:ChatMessage[]): { turn: number; from: number; to: numb…` | 1 |
| 4953 | Conversation | function |  | `({
  owner,
  currentSessionId,
  messages,
  streaming,
  streamStatus,
  focusRoot,
  o…): React.JSX.Element` | 0 |
| 5076 | taskNames | arrow |  | `()` | 0 |
| 5080 | taskNameCtx | arrow |  | `()` | 0 |
| 5086 | memberFace | arrow |  | `(name:string): React.ReactNode` | 0 |
| 5095 | memberPersonaOf | arrow |  | `(sid:string): Persona \| undefined` | 0 |
| 5101 | mentionLookup | arrow |  | `()` | 0 |
| 5138 | turnOf | arrow |  | `()` | 0 |
| 5148 | turnStart | arrow |  | `()` | 0 |
| 5157 | startOfTurn | arrow |  | `(turn:number): number` | 1 |
| 5159 | endOfTurn | arrow |  | `(turn:number): number` | 1 |
| 5186 | loadEarlier | arrow |  | `(): void` | 2 |
| 5192 | loadLater | arrow |  | `(): void` | 2 |
| 5198 | resetToTail | arrow |  | `(): void` | 2 |
| 5204 | tocItems | arrow |  | `()` | 0 |
| 5230 | openRewind | arrow |  | `(turn:number \| null=null): boolean` | 2 |
| 5236 | promptOf | arrow |  | `(turn:number): string` | 1 |
| 5253 | recomputeActive | arrow |  | `(): void` | 1 |
| 5284 | scheduleActive | arrow |  | `(): void` | 2 |
| 5305 | scrollToTurn | arrow |  | `(turn:number): void` | 2 |
| 5331 | jumpToTurn | arrow |  | `(turn:number): void` | 0 |
| 5362 | exitSelect | arrow |  | `(): void` | 2 |
| 5366 | toggleTurn | arrow |  | `(turn:number): void` | 1 |
| 5374 | doDeleteSelected | arrow |  | `(): void` | 0 |
| 5386 | onMsgsContextMenu | arrow |  | `(e:React.MouseEvent): void` | 0 |
| 5402 | copySelection | arrow |  | `(text:string): void` | 1 |
| 5450 | onScroll | arrow |  | `(): void` | 0 |
| 5486 | jumpToLatest | arrow |  | `(): void` | 0 |
| 5496 | handleSend | arrow |  | `(text:string, attachments?:SendAttachment[]): Promise<boolean>` | 0 |
| 5528 | hidePendingPick | arrow |  | `(m:ChatMessage): ChatMessage` | 1 |
| 5537 | reportOf | arrow |  | `(i:number): MemberReportHead \| undefined` | 1 |
| 5552 | renderMsg | arrow |  | `(m:ChatMessage, i:number, turn?:number): React.JSX.Element` | 3 |
| 5867 | TurnIndex | function |  | `({
  items,
  active,
  onJump
}:{
  items: TocItem[]
  /** 当前所在轮下标；-1 表示无。 */
  active: …): React.JSX.Element` | 0 |
| 5893 | measure | arrow |  | `(): void` | 2 |
| 5963 | MentionText | function |  | `({ text }:{ text: string }): React.ReactNode` | 0 |
| 5994 | quoteOf | function |  | `(sel:Selection \| null): string` | 1 |
| 5996 | elOf | arrow |  | `(n:Node \| null): Element \| null` | 2 |
| 6021 | splitQuotes | function |  | `(text:string): UserTextSeg[] \| null` | 3 |
| 6062 | leadingQuote | function |  | `(text:string): { quote: string; rest: string } \| null` | 3 |
| 6081 | withQuote | function |  | `(quote:string, text:string): string` | 2 |
| 6087 | quotePlain | function |  | `(quote:string, full=false): string` | 3 |
| 6099 | UserText | function |  | `({ text }:{ text: string }): React.JSX.Element` | 0 |
| 6104 | segs | arrow |  | `()` | 0 |
| 6112 | measure | arrow |  | `(): void` | 2 |
| 6173 | withoutHeadline | function |  | `(m:ChatMessage, headline:string): ChatMessage` | 1 |
| 6181 | MemberInlineFace | function |  | `({ persona }:{ persona: Persona }): React.JSX.Element` | 0 |
| 6190 | ConvMessage | function |  | `({
  msg,
  report,
  owner,
  taskSpeaker,
  taskPersona,
  taskOwner,
  active,
  lates…): React.JSX.Element` | 0 |
| 6251 | releasePeak | arrow |  | `(): void` | 4 |
| 6406 | renderBlocks | arrow |  | `(blocks:ChatBlock[], notesInline=false): React.ReactNode` | 3 |
| 6530 | setComposerDraft | function |  | `(id:string, draft:ComposerDraft \| null): void` | 4 |
| 6536 | subscribeDrafts | function |  | `(onChange:() => void): () => void` | 0 |
| 6553 | restoreToComposer | function |  | `(sessionId:string, text:string): void` | 2 |
| 6573 | InsertCapsule | function |  | `({ sessionId }:{ sessionId: string }): React.JSX.Element \| null` | 0 |
| 6580 | withdraw | arrow |  | `(): void` | 0 |
| 6610 | MemberProgressNotice | function |  | `({
  ownerName,
  faceOf
}:{
  ownerName: string
  faceOf: (sid: string) => Persona \| und…): React.JSX.Element \| null` | 0 |
| 6654 | useDraftPreview | function |  | `(id:string): string \| null` | 1 |
| 6667 | Composer | function |  | `({
  sessionId,
  owner,
  mentionables,
  roleId,
  streaming,
  focusRoot,
  onMount,
 …): React.JSX.Element` | 0 |
| 6706 | skills | arrow |  | `()` | 0 |
| 6763 | slashCommands | arrow |  | `()` | 0 |
| 6786 | slashMatches | arrow |  | `()` | 0 |
| 6824 | applySlash | arrow |  | `(c:SlashCommand): void` | 2 |
| 6846 | stopTurn | arrow |  | `(): void` | 0 |
| 6854 | pickWorkspace | arrow |  | `(): void` | 0 |
| 6862 | addPicked | arrow |  | `(picked:Picked[]): void` | 4 |
| 6880 | pickFiles | arrow |  | `async (): Promise<void>` | 1 |
| 6887 | addFiles | arrow |  | `async (files:File[]): Promise<void>` | 1 |
| 6919 | addFolders | arrow |  | `(dirs:{ path: string; name: string }[]): void` | 1 |
| 6935 | ingest | arrow |  | `async (files:File[]): Promise<void>` | 1 |
| 6948 | onPaste | arrow |  | `(e:ClipboardEvent): boolean` | 1 |
| 6963 | hasFiles | arrow |  | `(e:DragEvent): boolean` | 2 |
| 6964 | onDragOver | arrow |  | `(e:DragEvent): void` | 0 |
| 6969 | onDrop | arrow |  | `(e:DragEvent): void` | 0 |
| 6983 | removePending | arrow |  | `(path:string): void` | 0 |
| 6987 | insertNow | arrow |  | `(): void` | 1 |
| 7003 | submit | arrow |  | `(): void` | 3 |
| 7045 | onKey | arrow |  | `(key:ComposerKey, e:KeyboardEvent): boolean` | 1 |
| 7091 | isToken | arrow |  | `(name:string, whole:string): boolean` | 1 |
| 7098 | mentionNames | arrow |  | `()` | 0 |
| 7106 | mentionFace | arrow |  | `(name:string): string \| null` | 1 |
| 7151 | entry.restore | objmethod |  | `(text:string): void` | 5 |
| 7395 | ModelPicker | function |  | `(): React.JSX.Element` | 0 |
| 7406 | selected | arrow |  | `()` | 0 |
| 7486 | EffortPicker | function |  | `(): React.JSX.Element \| null` | 0 |
| 7499 | nameOf | arrow |  | `(lv:EffortLevel): string` | 4 |
| 7501 | hintOf | arrow |  | `(lv:EffortLevel): string` | 1 |
| 7570 | ProfileView | function |  | `({
  persona,
  sessions,
  onOpenThread,
  onStart,
  onEdit,
  onManageCaps
}:{
  perso…): React.JSX.Element` | 0 |
| 7590 | convs | arrow |  | `()` | 0 |
| 7598 | caps | arrow |  | `()` | 0 |
| 7719 | PersonaEditor | function |  | `({
  initial,
  onClose
}:{
  initial: EditorState
  onClose: () => void
}): React.JSX.Element` | 0 |
| 7760 | dismiss | arrow |  | `(): void` | 2 |
| 7767 | llmProviders | arrow |  | `()` | 0 |
| 7771 | modelItems | arrow |  | `()` | 0 |
| 7792 | modelDisplay | arrow |  | `()` | 0 |
| 7810 | save | arrow |  | `(): void` | 13 |
| 7839 | reject | arrow |  | `(): void` | 34 |
| 7974 | Settings | function |  | `({ initial, onClose }:{ initial?: SettingsInit; onClose: () => void }): React.JSX.Element` | 0 |
| 8023 | GeneralPane | function |  | `(): React.JSX.Element` | 0 |
| 8032 | toggleTray | arrow |  | `(): void` | 0 |
| 8039 | pickChatFontSize | arrow |  | `(v:string): void` | 0 |
| 8099 | ExtensionsPane | function |  | `({
  initialOpen
}:{
  initialOpen?: { kind: 'skill' \| 'mcp'; id: string } \| null
}): React.JSX.Element` | 0 |
| 8215 | AvatarStack | function |  | `({
  personas,
  size = 20,
  max = 3,
  plain
}:{
  personas: Persona[]
  size?: number
…): React.JSX.Element` | 0 |
| 8258 | usePickedPersonas | function |  | `(roles:string[] \| null): Persona[]` | 2 |
| 8267 | RolesBadge | function |  | `({ roles }:{ roles: string[] \| null }): React.JSX.Element \| null` | 0 |
| 8280 | RolesPicker | function |  | `({
  kind,
  id,
  roles
}:{
  kind: 'skill' \| 'mcp'
  id: string
  roles: string[] \| nul…): React.JSX.Element` | 0 |
| 8296 | toggle | arrow |  | `(pid:string): void` | 8 |
| 8383 | SkillDetail | function |  | `({ item, onBack }:{ item: Skill; onBack: () => void }): React.JSX.Element` | 0 |
| 8389 | onDelete | arrow |  | `(): void` | 4 |
| 8460 | McpEditor | function |  | `({ item, onBack }:{ item: McpServer; onBack: () => void }): React.JSX.Element` | 0 |
| 8469 | setSecret | arrow |  | `(field:string, value:string): Promise<{ ok: boolean; available: bool…` | 3 |
| 8475 | onDelete | arrow |  | `(): void` | 4 |
| 8625 | McpArgsField | function |  | `({ item }:{ item: McpServer }): React.JSX.Element` | 0 |
| 8658 | McpKvEditor | function |  | `({
  serverId,
  rows,
  onChange,
  onSetSecret
}:{
  serverId: string
  rows: McpKV[]
 …): React.JSX.Element` | 0 |
| 8694 | setRow | arrow |  | `(i:number, patch:Partial<McpKV>): void` | 3 |
| 8696 | addRow | arrow |  | `(): void` | 0 |
| 8697 | removeRow | arrow |  | `(i:number): void` | 1 |
| 8699 | clearTimer | arrow |  | `(i:number): void` | 6 |
| 8707 | doSaveSecret | arrow |  | `async (i:number, key:string, value:string): Promise<void>` | 2 |
| 8716 | onSecretChange | arrow |  | `(i:number, value:string): void` | 1 |
| 8729 | flushSecret | arrow |  | `(i:number): void` | 2 |
| 8734 | toggleSecret | arrow |  | `(i:number): void` | 1 |
| 8833 | AboutPane | function |  | `(): React.JSX.Element` | 0 |
| 8851 | Segmented | function |  | `({
  value,
  onChange,
  options
}:{
  value: string
  onChange: (v: string) => void
  o…): React.JSX.Element` | 0 |
| 8875 | Toggle | function |  | `({
  on,
  onChange,
  disabled
}:{
  on: boolean
  onChange: () => void
  disabled?: boo…): React.JSX.Element` | 0 |
| 8901 | Avatar | function |  | `({
  persona,
  user,
  size,
  busy,
  attention,
  unread,
  plain,
  compact
}:{
  per…): React.JSX.Element \| null` | 0 |

### `apps/desktop/src/renderer/src/redesign/ProfilePanel.tsx`（19 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 24 | ProfilePanel | function | export | `({ onClose }:{ onClose: () => void }): React.JSX.Element` | 0 |
| 37 | doneAvatar | arrow |  | `(spec:Parameters<typeof profile.saveAvatar>[0], image:string): void` | 0 |
| 50 | dismiss | arrow |  | `(): void` | 2 |
| 143 | editBoxWidth | function |  | `(text:string, base:EditBase \| null, max:number): number \| undefined` | 2 |
| 158 | MemoryTag | function |  | `({
  entry: e,
  h,
  style,
  elRef
}:{
  entry: MemoryEntry
  h: TagHandlers
  style?: …): React.JSX.Element` | 0 |
| 180 | showPop | arrow |  | `(): void` | 1 |
| 187 | hidePop | arrow |  | `(): void` | 1 |
| 197 | close | arrow |  | `(): void` | 28 |
| 210 | beginEdit | arrow |  | `(): void` | 3 |
| 336 | MemoryBoard | function |  | `({
  avatar,
  error,
  entries,
  h
}:{
  avatar: React.ReactNode
  error: React.ReactNo…): React.JSX.Element` | 0 |
| 378 | MemoryTags | function | export | `({
  entries,
  h,
  emptyText
}:{
  entries: MemoryEntry[]
  h: TagHandlers
  /** 空列表提示文…): React.JSX.Element` | 0 |
| 425 | slotPoint | arrow |  | `(deg:number, rx:number): { x: number; y: number }` | 3 |
| 430 | arcFrames | arrow |  | `(deg:number, from:number, to:number, rx:number, fadeIn:boolean): Keyframe[]` | 2 |
| 441 | reducedMotion | arrow |  | `(): boolean` | 1 |
| 449 | MemoryOrbit | function |  | `({
  width,
  avatar,
  entries,
  h
}:{
  width: number
  avatar: React.ReactNode
  entr…): React.JSX.Element` | 0 |
| 473 | slice | arrow |  | `(p:number): MemoryEntry[]` | 250 |
| 483 | goto | arrow |  | `(target:number, dir:1 \| -1): void` | 3 |
| 503 | onWheel | arrow |  | `(ev:WheelEvent): void` | 0 |
| 533 | slotStyle | arrow |  | `(i:number, editing=false): React.CSSProperties` | 2 |

### `apps/desktop/src/renderer/src/redesign/RewindModal.tsx`（10 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 31 | RewindModal | function | export | `({
  sessionId,
  turns,
  initialTurn,
  promptOf,
  onClose,
  onPrefill
}:{
  sessionI…): React.JSX.Element` | 0 |
| 85 | errText | arrow |  | `(e:RewindError \| undefined): string` | 11 |
| 94 | countText | arrow |  | `(restored:number, skipped:number): string \| undefined` | 2 |
| 103 | undo | arrow |  | `async (id:string): Promise<void>` | 2 |
| 121 | apply | arrow |  | `async (mode:RewindMode): Promise<void>` | 1 |
| 150 | undoFromList | arrow |  | `(): void` | 0 |
| 156 | ordered | arrow |  | `()` | 0 |
| 241 | Detail | function |  | `({
  text,
  preview,
  force,
  busy,
  onToggleForce,
  onBack,
  onApply,
  onCancel
}…): React.JSX.Element` | 0 |
| 353 | FileRow | function |  | `({
  file,
  forced,
  onToggle
}:{
  file: RewindFile
  forced: boolean
  onToggle: () =…): React.JSX.Element` | 0 |
| 397 | LineStat | function |  | `({
  added,
  removed,
  approx
}:{
  added: number
  removed: number
  approx?: boolean
}): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/redesign/UpdateSection.tsx`（6 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 10 | manualHintKey | function |  | `(file:string \| null): string` | 1 |
| 21 | UpdateSection | function | export | `(): React.JSX.Element` | 0 |
| 39 | check | arrow |  | `(): void` | 18 |
| 40 | download | arrow |  | `(): void` | 1 |
| 41 | install | arrow |  | `(): void` | 2 |
| 45 | link | arrow |  | `(href:string, label:string): React.JSX.Element` | 2 |

### `apps/desktop/src/renderer/src/redesign/attachments.tsx`（15 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 50 | sourceKey | function |  | `(src:ImageSource): string` | 4 |
| 54 | fetchImage | function |  | `(src:ImageSource, full:boolean): Promise<string \| null>` | 2 |
| 62 | loadThumb | function |  | `(src:ImageSource): Promise<string \| null>` | 2 |
| 85 | useThumb | function |  | `(src:ImageSource): string \| null \| undefined` | 1 |
| 109 | formatSize | function | export | `(n:number): string` | 2 |
| 116 | extLabel | function |  | `(name:string): string` | 2 |
| 122 | metaLine | function |  | `(name:string, size?:number): string` | 3 |
| 159 | categoryOf | function |  | `(kind:AttachKind, name:string): FileCategory` | 1 |
| 200 | RemoveButton | function |  | `({ name, onRemove }:{ name: string; onRemove: () => void }): React.JSX.Element` | 0 |
| 221 | Thumb | function |  | `({
  item,
  variant,
  onOpen,
  onRemove
}:{
  item: ViewerItem
  variant: 'composer' \|…): React.JSX.Element` | 0 |
| 278 | FileCard | function | export | `({
  name,
  kind,
  size,
  title,
  sent,
  onRemove
}:{
  name: string
  kind: AttachK…): React.JSX.Element` | 0 |
| 335 | AttachmentList | function | export | `({
  entries,
  variant,
  onRemove
}:{
  entries: AttachEntry[]
  variant: 'composer' \| …): React.JSX.Element \| null` | 0 |
| 400 | ImageViewer | function | export | `({
  items,
  index,
  onClose
}:{
  items: ViewerItem[]
  index: number
  onClose: () =>…): React.JSX.Element` | 0 |
| 443 | step | arrow |  | `(d:number): void` | 25 |
| 458 | onKey | arrow |  | `(e:KeyboardEvent): void` | 1 |

### `apps/desktop/src/renderer/src/redesign/composer-editor.ts`（31 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 57 | SlashTokenNode.$config | method | export | `()` | 0 |
| 61 | SlashTokenNode.createDOM | method | export | `(config:EditorConfig): HTMLElement` | 1 |
| 68 | $isSlashTokenNode | arrow |  | `(node:LexicalNode \| null \| undefined): node is SlashTokenNode` | 1 |
| 81 | MentionNode.$config | method | export | `()` | 0 |
| 85 | MentionNode.constructor | ctor |  | `(mention='', key?:NodeKey)` | 0 |
| 90 | MentionNode.afterCloneFrom | method | export | `(prevNode:this): void` | 1 |
| 95 | MentionNode.getTextContent | method | export | `(): string` | 10 |
| 99 | MentionNode.createDOM | method | export | `(_config:EditorConfig, editor:LexicalEditor): HTMLElement` | 1 |
| 117 | MentionNode.updateDOM | method | export | `(): boolean` | 0 |
| 121 | MentionNode.decorate | method | export | `(): null` | 0 |
| 125 | MentionNode.isInline | method | export | `(): boolean` | 0 |
| 130 | MentionNode.isKeyboardSelectable | method | export | `(): boolean` | 0 |
| 135 | $isMentionNode | arrow |  | `(node:LexicalNode \| null \| undefined): node is MentionNode` | 2 |
| 141 | $swapTextNode | function |  | `(node:TextNode, next:TextNode): void` | 2 |
| 153 | $caretOffset | function |  | `(block:LexicalNode \| null, leaves:LexicalNode[]): number \| null` | 2 |
| 174 | stillTyping | function |  | `(text:string, start:number, caret:number \| null, names:readonly string[]): boolean` | 1 |
| 182 | $swapForMention | function |  | `(piece:TextNode): void` | 1 |
| 197 | $syncTokens | function |  | `(isToken:(name: string, whole: string) => boolean, mentionNames:readonly string[]): boolean` | 1 |
| 269 | $triggerAt | function |  | `(): ComposerTrigger \| null` | 1 |
| 292 | triggerReplaceEnd | function | export | `(text:string, trigger:ComposerTrigger, name:string): number` | 1 |
| 303 | sameTrigger | arrow |  | `(a:ComposerTrigger \| null, b:ComposerTrigger \| null): boolean` | 1 |
| 346 | useComposerEditor | function | export | `(handlers:ComposerEditorHandlers): ComposerEditor` | 1 |
| 366 | key | arrow |  | `(command:LexicalCommand<E>, name:ComposerKey)` | 19 |
| 435 | rootRef | arrow |  | `(el:HTMLDivElement \| null)` | 0 |
| 437 | getText | arrow |  | `()` | 6 |
| 443 | update | arrow |  | `(fn:() => void, tags:string[], focus:boolean)` | 35 |
| 461 | setText | arrow |  | `(text:string, focus=false)` | 8 |
| 479 | replaceRange | arrow |  | `(start:number, end:number, text:string)` | 1 |
| 519 | focusEnd | arrow |  | `()` | 2 |
| 524 | clearHistory | arrow |  | `()` | 3 |
| 529 | refreshToken | arrow |  | `()` | 1 |

### `apps/desktop/src/renderer/src/redesign/memory-editor.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 14 | fill | arrow | export | `(s:string, vars:Record<string, number \| string>): string` | 28 |
| 44 | useMemoryEditor | function | export | `({
  root,
  clearTitle,
  clearConfirm
}:{
  /** 工作区根：给了即该项目的私有记忆，省略即全局记忆。 */
  root?: s…): MemoryEditor` | 1 |
| 69 | reload | arrow |  | `(): void` | 6 |
| 94 | run | arrow |  | `async (op:() => Promise<MemoryIpcResult>): Promise<boolean>` | 17 |
| 124 | cancelEdit | arrow |  | `(): void` | 1 |
| 128 | saveEdit | arrow |  | `async (): Promise<void>` | 1 |
| 135 | remove | arrow |  | `async (id:string): Promise<void>` | 17 |
| 148 | clearAll | arrow |  | `async (): Promise<void>` | 1 |

### `apps/desktop/src/renderer/src/redesign/resizable.tsx`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 35 | clamp | arrow |  | `(v:number, lo:number, hi:number): number` | 2 |
| 38 | clampSidebar | function | export | `(w:number, viewportW:number, railW=ICONRAIL_W): number` | 2 |
| 44 | clampComposer | function | export | `(h:number, viewportH:number): number` | 2 |
| 49 | loadLayout | function | export | `(): Layout` | 4 |
| 59 | saveLayout | function | export | `(patch:Layout): void` | 6 |
| 66 | useViewport | function | export | `(): { w: number; h: number }` | 2 |
| 69 | on | arrow |  | `(): void` | 90 |
| 81 | ResizeHandle | function | export | `({
  axis,
  value,
  onChange,
  onCommit,
  onReset,
  className,
  style,
  title
}:{
…): React.JSX.Element` | 0 |

### `apps/desktop/src/renderer/src/store/chat.tsx`（74 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 452 | withLiveCards | function |  | `(msgs:ChatMessage[], cards:PendingCard[]): ChatMessage[]` | 1 |
| 468 | resolveCard | function |  | `(blocks:ChatBlock[], ev:Extract<StreamEvent, { type: 'interaction_resolved' }>): ChatBlock[]` | 1 |
| 488 | resolveProposalCard | function |  | `(blocks:ChatBlock[], ev:Extract<StreamEvent, { type: 'card_resolved' }>): ChatBlock[]` | 1 |
| 642 | onInsertsReturned | function |  | `(cb:(sessionId: string, text: string) => void): () => void` | 1 |
| 672 | genId | function |  | `(prefix='m'): string` | 20 |
| 678 | displayToMessages | function |  | `(dms:DisplayMessage[]): ChatMessage[]` | 5 |
| 750 | subagentIndex | function |  | `(blocks:ChatBlock[], parent?:string): number` | 2 |
| 764 | isSubagentCall | function |  | `(name:string): boolean` | 2 |
| 773 | subagentBlock | function |  | `(id:string, name:string, args:unknown, status:ToolStatus, summary?:string): ChatBlock` | 2 |
| 807 | reduceBackground | function |  | `(blocks:ChatBlock[], ev:Extract<StreamEvent, { type: 'tool_call' \| 'tool_result' }>): ChatBlock[]` | 1 |
| 817 | normalizeAgentDraft | function |  | `(input:unknown): AgentDraft` | 2 |
| 819 | str | arrow |  | `(v:unknown): string` | 56 |
| 829 | normalizeAutotaskDraft | function |  | `(input:unknown): AutotaskDraft` | 2 |
| 831 | str | arrow |  | `(v:unknown): string` | 56 |
| 850 | reduceBlocks | function |  | `(blocks:ChatBlock[], ev:StreamEvent): ChatBlock[]` | 2 |
| 972 | dropStepPartial | function |  | `(blocks:ChatBlock[]): ChatBlock[]` | 0 |
| 991 | hasVisibleAnswer | function |  | `(blocks:ChatBlock[]): boolean` | 2 |
| 1020 | appendTerminalNotice | function |  | `(blocks:ChatBlock[], stopReason:string): ChatBlock[]` | 1 |
| 1033 | updateLastAssistant | function |  | `(list:ChatMessage[], fn:(blocks: ChatBlock[]) => ChatBlock[]): ChatMessage[]` | 3 |
| 1048 | setLastDuration | function |  | `(list:ChatMessage[], durationMs:number \| undefined): ChatMessage[]` | 1 |
| 1057 | dropEmptyAssistantTail | function |  | `(list:ChatMessage[]): ChatMessage[]` | 2 |
| 1069 | settleOpenCards | function |  | `(list:ChatMessage[]): ChatMessage[]` | 1 |
| 1140 | hasAttention | function |  | `(messages:ChatMessage[]): boolean` | 1 |
| 1152 | ChatProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 1166 | sessions | arrow |  | `()` | 0 |
| 1174 | dropPendingCard | arrow |  | `(sid:string, key?:string): void` | 5 |
| 1218 | setCurrent | arrow |  | `(id:string): void` | 6 |
| 1230 | setBinding | arrow |  | `(sid:string, patch:{
        personaId?: string
        focusRoot?: string \| null
       …): void` | 6 |
| 1252 | patchRuntime | arrow |  | `(sid:string, fn:(r: SessionRuntime) => SessionRuntime): void` | 19 |
| 1268 | attachSession | arrow |  | `async (sid:string): Promise<void>` | 4 |
| 1299 | setTodoState | arrow |  | `(sid:string, st:TodoState): void` | 3 |
| 1308 | setInsertState | arrow |  | `(sid:string, pending:string[]): void` | 1 |
| 1320 | setProgressState | arrow |  | `(sid:string, groups:MemberProgressGroup[]): void` | 1 |
| 1331 | patchMessages | arrow |  | `(sid:string, mutate:(blocks: ChatBlock[]) => ChatBlock[]): void` | 2 |
| 1347 | patchCardBlocks | arrow |  | `(sid:string, mutate:(blocks: ChatBlock[]) => ChatBlock[]): void` | 9 |
| 1367 | dropRuntime | arrow |  | `(sid:string): void` | 4 |
| 1376 | refreshSessions | arrow |  | `async (): Promise<void>` | 13 |
| 1393 | startFresh | arrow |  | `(personaId?:string, focusRoot?:string \| null, model?:string): void` | 4 |
| 1424 | openFirstSession | arrow |  | `(list:SessionMeta[]): void` | 4 |
| 1463 | reloadIntoRuntime | arrow |  | `(sid:string): void` | 3 |
| 1766 | sessionStates | arrow |  | `()` | 0 |
| 1793 | isMemberSession | arrow |  | `(id:string): boolean` | 4 |
| 1797 | currentBinding | arrow |  | `()` | 0 |
| 1857 | draftSession | arrow |  | `()` | 0 |
| 1876 | value | arrow |  | `()` | 0 |
| 1879 | send | arrow |  | `async (text:string, attachments?:SendAttachment[]): Promise<boolean>` | 50 |
| 1897 | noModel | arrow |  | `(): false` | 2 |
| 1902 | sendFailed | arrow |  | `(msg:string): false` | 2 |
| 2022 | stop | arrow |  | `(): void` | 11 |
| 2028 | insert | arrow |  | `async (text:string): Promise<boolean>` | 2 |
| 2063 | withdrawInserts | arrow |  | `async (): Promise<string>` | 2 |
| 2073 | newSession | arrow |  | `(personaId?:string, focusRoot?:string \| null, model?:string): void` | 3 |
| 2080 | mountFocus | arrow |  | `(path:string \| null): void` | 0 |
| 2093 | setSessionModel | arrow |  | `(modelRef:string): void` | 2 |
| 2112 | setSessionEffort | arrow |  | `(level:EffortLevel): void` | 1 |
| 2121 | selectSession | arrow |  | `(id:string): void` | 7 |
| 2129 | deleteSession | arrow |  | `(id:string): void` | 3 |
| 2152 | renameSession | arrow |  | `(id:string, title:string): void` | 2 |
| 2153 | setTitle | arrow |  | `(next:string): void` | 4 |
| 2165 | setArchived | arrow |  | `(id:string, archived:boolean): void` | 5 |
| 2187 | deleteSessions | arrow |  | `(ids:string[]): void` | 1 |
| 2215 | deleteTurns | arrow |  | `async (turnIndices:number[]): Promise<void>` | 4 |
| 2231 | applyRewound | arrow |  | `async (id:string, dms:DisplayMessage[]): Promise<void>` | 2 |
| 2240 | rewindApply | arrow |  | `async (turn:number, mode:RewindMode, force:string[]): Promise<RewindApplyResult>` | 2 |
| 2252 | rewindUndo | arrow |  | `async (sessionId?:string): Promise<RewindUndoResult>` | 2 |
| 2260 | respondAsk | arrow |  | `(key:string, answers:string[], sessionId?:string): void` | 1 |
| 2269 | respondPlan | arrow |  | `(key:string, decision:'approve' \| 'keep' \| 'ignore', feedback?:string, sessionId?:string): void` | 1 |
| 2299 | respondMount | arrow |  | `(key:string, path:string \| null, sessionId?:string): void` | 1 |
| 2321 | resolveProposal | arrow |  | `(toolId:string, status:'accepted' \| 'rejected'): void` | 5 |
| 2331 | resolveAutotask | arrow |  | `async (toolId:string, action:'create' \| 'dismiss', taskInput?:TaskCreateInput): Promise<ResolveAutotaskResult>` | 5 |
| 2357 | cancelTodoList | arrow |  | `(): void` | 2 |
| 2366 | stopSubagent | arrow |  | `(toolId:string): void` | 2 |
| 2372 | removeMember | arrow |  | `(sessionId:string, memberSessionId:string): void` | 2 |
| 2449 | useChat | function | export | `(): ChatContextValue` | 19 |

### `apps/desktop/src/renderer/src/store/extensions.tsx`（22 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 97 | rolesAllow | function | export | `(roles:string[] \| null, personaId:string): boolean` | 1 |
| 102 | recToSkill | function |  | `(rec:SkillRecord): Skill` | 0 |
| 121 | personaRecToPersona | function |  | `(rec:PersonaRecord): Persona` | 2 |
| 137 | personaToInput | function |  | `(p:Persona): PersonaUpsertInput` | 1 |
| 152 | kvFromMap | function |  | `(map:Record<string, McpValue> \| undefined): McpKV[]` | 2 |
| 160 | mapFromKv | function |  | `(rows:McpKV[]): Record<string, McpValue>` | 2 |
| 171 | baseFromConfig | function |  | `(c:McpServerConfig): Omit<
  McpServer,
  'enabled' \| 'role…` | 1 |
| 191 | viewToMcp | function |  | `(v:McpServerView): McpServer` | 1 |
| 205 | mcpToInput | function |  | `(m:McpServer): McpServerInput` | 1 |
| 220 | ExtensionsProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 308 | refresh | arrow |  | `(): void` | 7 |
| 336 | setterFor | arrow |  | `(kind:ExtKind): React.Dispatch<React.SetStateAction<An…` | 2 |
| 342 | patchLocal | arrow |  | `(kind:ExtKind, id:string, fn:(item: AnyExt) => AnyExt): void` | 2 |
| 345 | value | arrow |  | `()` | 0 |
| 347 | importErrKey | arrow |  | `(code:string): string` | 1 |
| 363 | importSkill | arrow |  | `(): void` | 1 |
| 385 | removeSkill | arrow |  | `async (id:string): Promise<boolean>` | 2 |
| 395 | addPersona | arrow |  | `(): void` | 1 |
| 413 | upsertPersona | arrow |  | `async (input:PersonaUpsertInput): Promise<Persona \| undefined>` | 5 |
| 422 | setPersonaAvatarImage | arrow |  | `async (id:string, dataUri:string): Promise<string>` | 1 |
| 436 | reorderPersonas | arrow |  | `(ids:string[]): void` | 1 |
| 545 | useExtensions | function | export | `(): ExtensionsContextValue` | 18 |

### `apps/desktop/src/renderer/src/store/models.tsx`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 67 | findActive | function | export | `(providers:Provider[], activeId:string \| null)` | 5 |
| 81 | hasUsableModel | function | export | `(providers:Provider[]): boolean` | 3 |
| 89 | normalizeModel | function |  | `(raw:unknown): ModelDef \| null` | 0 |
| 100 | normalizeProvider | function |  | `(raw:unknown): Provider \| null` | 0 |
| 114 | ModelsProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 199 | patchProvider | arrow |  | `(id:string, fn:(p: Provider) => Provider): void` | 8 |
| 202 | value | arrow |  | `()` | 0 |
| 330 | useModels | function | export | `(): ModelsContextValue` | 11 |

### `apps/desktop/src/renderer/src/store/profile.tsx`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 19 | ProfileProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 40 | saveAvatar | arrow |  | `async (spec:AvatarSpec, image:string): Promise<boolean>` | 1 |
| 59 | value | arrow |  | `()` | 0 |
| 63 | useProfile | function | export | `(): ProfileContextValue` | 3 |

### `apps/desktop/src/renderer/src/store/tasks.tsx`（7 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 45 | TasksProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 65 | create | arrow |  | `(input:TaskCreateInput): Promise<CreateTaskResult>` | 7 |
| 70 | setStatus | arrow |  | `async (id:string, status:TaskStatus): Promise<void>` | 8 |
| 75 | runNow | arrow |  | `(id:string): Promise<{ ok: boolean; reason?: string…` | 2 |
| 81 | update | arrow |  | `(input:TaskUpdateInput): Promise<TaskRecord \| null>` | 35 |
| 86 | remove | arrow |  | `async (id:string): Promise<void>` | 17 |
| 94 | useTasks | function | export | `(): TasksContextValue` | 3 |

### `apps/desktop/src/renderer/src/store/workspace.tsx`（21 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 70 | baseName | function |  | `(p:string): string` | 2 |
| 75 | WorkspaceProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 91 | activeProject | arrow |  | `()` | 0 |
| 100 | ensureChildren | arrow |  | `async (dir:string): Promise<void>` | 3 |
| 106 | applyOpen | arrow |  | `async (proj:Project): Promise<void>` | 1 |
| 116 | openFolder | arrow |  | `async (): Promise<void>` | 3 |
| 122 | setActiveProject | arrow |  | `(id:string): void` | 0 |
| 131 | closeProject | arrow |  | `(id:string): void` | 0 |
| 153 | toggleDir | arrow |  | `async (path:string): Promise<void>` | 0 |
| 163 | tree | arrow |  | `()` | 0 |
| 166 | walk | arrow |  | `(dir:string, depth:number): void` | 4 |
| 179 | openFile | arrow |  | `async (path:string): Promise<void>` | 0 |
| 205 | setActivePath | arrow |  | `(path:string): void` | 0 |
| 214 | closeTab | arrow |  | `(path:string): void` | 4 |
| 234 | editContent | arrow |  | `(path:string, text:string): void` | 0 |
| 238 | isDirty | arrow |  | `(path:string): boolean` | 0 |
| 243 | saveActive | arrow |  | `async (): Promise<void>` | 0 |
| 252 | contentOf | arrow |  | `(path:string): string \| undefined` | 0 |
| 253 | stateOf | arrow |  | `(path:string): FileState \| undefined` | 0 |
| 255 | value | arrow |  | `()` | 0 |
| 301 | useWorkspace | function | export | `(): WorkspaceValue` | 1 |

### `apps/desktop/src/renderer/src/theme/ThemeContext.tsx`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 24 | readConfigMode | function |  | `(): ThemeMode \| null` | 1 |
| 42 | getSystemTheme | function |  | `(): ResolvedTheme` | 0 |
| 46 | readStoredMode | function |  | `(): ThemeMode` | 0 |
| 59 | ThemeProvider | function | export | `({ children }:{ children: ReactNode }): React.JSX.Element` | 0 |
| 66 | onChange | arrow |  | `(e:MediaQueryListEvent): void` | 15 |
| 80 | setMode | arrow |  | `(next:ThemeMode): void` | 1 |
| 91 | value | arrow |  | `()` | 0 |
| 99 | useTheme | function | export | `(): ThemeContextValue` | 1 |

### `apps/desktop/src/renderer/src/theme/chatFontSize.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 13 | isChatFontSize | function |  | `(v:unknown): v is ChatFontSize` | 1 |
| 18 | readChatFontSize | function | export | `(): ChatFontSize` | 1 |
| 29 | applyChatFontSize | function | export | `(size:ChatFontSize): void` | 2 |
| 36 | saveChatFontSize | function | export | `(size:ChatFontSize): void` | 1 |

## D 共享、脚本与配置（17 文件 / 39 条）

### `.github/scripts/release-notes.mjs`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 30 | git | arrow |  | `(args)` | 2 |
| 33 | previousTag | function |  | `()` | 1 |

### `apps/desktop/electron.vite.config.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/scripts/adhoc-sign.cjs`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/scripts/after-pack.cjs`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/scripts/gen-icon.mjs`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | inBg | function |  | `(x, y, r=BG_R)` | 2 |
| 34 | inShape | function |  | `(x, y)` | 3 |
| 55 | render | function |  | `(size, ss=4, { pad = 0, r = BG_R }={})` | 6 |
| 60 | toLogo | arrow |  | `(v)` | 4 |
| 97 | crc32 | function |  | `(buf)` | 2 |
| 102 | chunk | function |  | `(type, data)` | 3 |
| 110 | png | function |  | `(size, rgba)` | 3 |
| 126 | ico | function |  | `(frames)` | 1 |

### `apps/desktop/scripts/linux-launcher.cjs`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/scripts/portable-zip.cjs`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 18 | rename | function |  | `async (from, to)` | 4 |

### `apps/desktop/src/shared/avatar-shape.ts`（4 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 28 | isAvatarShape | function | export | `(v:unknown): v is AvatarShape` | 5 |
| 33 | hashSeed | function | export | `(seed:string): number` | 3 |
| 46 | seededShape | function | export | `(seed:string): AvatarShape` | 4 |
| 70 | legacyAutoShape | function | export | `(seed:string): AvatarShape` | 2 |

### `apps/desktop/src/shared/browser.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/shared/context.ts`（12 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 102 | builtinContextWindow | function | export | `(modelId:string): number \| undefined` | 1 |
| 116 | capAutoWindow | function |  | `(modelId:string, window:number): number` | 3 |
| 121 | autoContextWindow | function | export | `(modelId:string, fallback=DEFAULT_CONTEXT_WINDOW): number` | 2 |
| 145 | autoOutputBudget | function | export | `(adapter:LimitAdapter, modelId:string): number \| undefined` | 3 |
| 155 | validLimit | function | export | `(v:unknown, range:{ min: number; max: number }): v is number` | 5 |
| 163 | formatTokens | function | export | `(n:number): string` | 8 |
| 178 | parseTokens | function | export | `(input:string): number \| null` | 1 |
| 191 | parseContextLimit | function | export | `(body:string): number \| undefined` | 3 |
| 225 | parseContextOverflow | function | export | `(body:string): ContextOverflow \| undefined` | 3 |
| 226 | pick | arrow |  | `(input:string, output:string, limit:string): ContextOverflow \| undefined` | 16 |
| 249 | isCjk | function |  | `(c:number): boolean` | 1 |
| 262 | estimateTextTokens | function | export | `(s:string): number` | 5 |

### `apps/desktop/src/shared/deliverables.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/shared/effort.ts`（8 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 32 | isEffortLevel | function | export | `(v:unknown): v is EffortLevel` | 3 |
| 129 | findRule | function |  | `(adapter:EffortAdapter, modelId:string): Rule` | 1 |
| 135 | endpointFormat | function |  | `(baseURL:string \| undefined): ThinkFormat \| undefined` | 1 |
| 159 | resolve | function |  | `(adapter:EffortAdapter, modelId:string, baseURL?:string): Resolved \| null` | 102 |
| 184 | supportedEffortLevels | function | export | `(adapter:EffortAdapter, modelId:string): ThinkLevel[]` | 2 |
| 190 | isToggleEffort | function | export | `(adapter:EffortAdapter, modelId:string): boolean` | 1 |
| 198 | clampEffort | function | export | `(adapter:EffortAdapter, modelId:string, level:EffortLevel): EffortLevel` | 2 |
| 221 | effortRequest | function | export | `(adapter:EffortAdapter, modelId:string, baseURL:string \| undefined, level:EffortLevel): EffortRequest \| undefined` | 1 |

### `apps/desktop/src/shared/limits.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|

### `apps/desktop/src/shared/mention.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 15 | mentionRanges | function | export | `(text:string, names:readonly string[]): { start: number; end: number }[]` | 2 |

### `apps/desktop/src/shared/quote.ts`（2 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 5 | isQuoteLine | arrow | export | `(line:string): boolean` | 6 |
| 8 | withoutQuotes | function | export | `(text:string): string` | 1 |

### `apps/desktop/src/shared/slash.ts`（1 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
| 11 | slashTokens | function | export | `(text:string): { start: number; end: number; name: st…` | 2 |

### `apps/desktop/src/shared/update.ts`（0 条）

| 行 | 名字 | 形态 | 导出 | 签名 | 调用点 |
|---:|---|---|---|---|---:|
