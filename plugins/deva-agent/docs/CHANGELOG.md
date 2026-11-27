# 0.8.50

- macOS 钥匙串诊断：`security list-keychains`/`default-keychain` + `dump-keychain`（**不带 -d，只读属性**）枚举 genp 的 service/account，过滤 `/deva|safe ?storage|electron/i`；四候选 miss 后按「精确 service+account → 仅 service」重试，覆盖条目名与 Electron 默认名不同的情况。
- 拆分 `mac-keychain-item-missing` 与 `mac-keychain-item-invisible`：后者表示属性里能看到条目、但当前进程读不到密码（Data Protection keychain/access group 或需点「允许」），页面给「允许后重试 + 钥匙串诊断」而不是笼统「没有条目」。
- 新增「钥匙串诊断」入口（模型页按钮 + `get-keychain-diagnostics` RPC）：输出 keychain 路径、用户、genp 总数、匹配条目 service/account、每条 `key/keyLength/valueChars/decodedBytes/prefix/likelyFormat`；不含任何 Key/密文。
- 新增密文指纹 `likelyFormat=mac-cbc|win-gcm|ambiguous|invalid`：按 `decodedBytes` 精确判断；`win-gcm` 时明确提示「这份 v10 是 Windows 生成的，macOS 密码学上解不开」，给「桌面端在本机重存」或「模型页填一次」两条出路。
- 依据：Electron 33 `electron_browser_main_parts.cc:539-540`（service=`<app_name> Safe Storage`，account=`<app_name>`）；Chromium 130 `os_crypt_mac.mm`（AES-128-CBC v10）与 `os_crypt_win.cc`（AES-256-GCM v10）；`crypto/apple_keychain_mac.cc:56-68` 仍是 `SecKeychainFindGenericPassword`（传统 login keychain，跨进程读取受 ACL/用户授权约束）。

# 0.8.49

- 统一 safeStorage 解码器：Windows 与 macOS 共用 `lib/safe-storage.mjs` 的 v10 格式层（Windows=AES-256-GCM，macOS=AES-128-CBC，二者前缀同为 v10 但密码不同）。
- Windows 真机修复：不再把 `secrets.json` 的 v10 值直接喂 DPAPI。新链路为 `<userData>/Local State` → `os_crypt.encrypted_key`（base64(`DPAPI`+DPAPI(32B key))）→ DPAPI 解出 32B AES key → v10 AES-256-GCM 解密；依据 Chromium 130 `os_crypt_win.cc:42-48,191-240`。
- 归因修复：`0x80131501`「参数无效」只说明“不是合法 DPAPI blob”，不再推断跨用户/跨机器；新增 `blob-not-dpapi`、`local-state-missing`、`encrypted-key-invalid`、`key-unprotect-failed`、`gcm-auth-failed`、`legacy-raw-dpapi-ok`、`v10-detected`、`foreign-blob-proven`（仅同机不同用户且已确证时）。
- 用户/机器归属改为规范化比较（域\用户、机器名大小写不敏感；有 SID 比 SID），`XY-L275\XYXNY` 与 `xy-l275\xyxny` 判为同一用户，不再误报。
- 诊断仅输出路径/大小/条目/前缀类型/Local State 是否存在与 encrypted_key 长度和 DPAPI 前缀/owner 对比，不含密文、明文、encrypted_key 值或 SID 原文。

# 0.8.48

- 修复 macOS：桌面密钥在 darwin 上一律报 `platform-unsupported` —— 现在真正实现 macOS 解密链路（纯 Node：`security find-generic-password` 取 safeStorage 主密钥 → PBKDF2-SHA1(`saltysalt`, 1003, 128bit) → AES-128-CBC(IV=16×0x20) → 去 PKCS#7），依据 Electron 33 与 Chromium 130 源码。
- 修掉错误归因：`platform-unsupported` 不再被解释成「服务端不在那台 Windows 上」；darwin 失败按钥匙串真实原因给码（`mac-keychain-item-missing` / `mac-keychain-denied` / `mac-keychain-no-session` / `mac-keychain-timeout` / `mac-keychain-tool-missing` / `mac-keychain-error` / `mac-key-mismatch` / `mac-ciphertext-truncated` / `mac-unsupported-format`）。
- 修掉 `aclReadable:false` 的误判：非 Windows 平台改用真实可读性 + uid 判定（macOS 上 mode=600 且同用户应判为可读），不再拿 Windows ACL 口径套 POSIX。
- 安全边界不变：明文只留内存（TTL + 上限），不写回 `~/.deva`、不进插件状态、不进日志、不回前端；插件侧 Key 优先，手填可覆盖；账号级 `state.user` 凭据作用域保持（换 Profile/重启仍可读）。
- 新增 `lib/macos-keychain.mjs` 与 `tests/macos-keychain.test.mjs`（12 条注入式夹具：v10 正确解出、错 key、截断、无条目、拒绝授权、无会话、超时、非 v10、自检往返、非 darwin 不执行命令、失败分类、底层辅助函数）。

# 0.8.47

- 修复 0.8.46 在 Windows 上「读到了桌面 secrets.json、条目也对，但解密仍报 dpapi-failed」：解码器现在**真的把 powershell.exe 与 pwsh.exe 都试到**（0.8.46 在第一个变体非 ENOENT 失败就 break，pwsh 永远轮不到），并按运行时自适应程序集（PS5.1 用 `System.Security`，PS7 用 `System.Security.Cryptography.ProtectedData`）。
- stdout 只接受可校验的 base64（去 BOM/CR/噪声行）；输出被污染算独立原因码 `decrypt-output-invalid`，不再静默解成乱码或误报 dpapi-failed。
- 新增 DPAPI 自检（固定假字符串 protect→unprotect 往返，不碰用户密文），采集服务端进程身份、容器/WSL 检测、PowerShell 变体与版本、程序集/语言模式、往返结果；把「工具链坏了」与「密文属于别的用户/机器」彻底分开。
- 原因码细化：`decrypt-tool-missing` / `decrypt-assembly-unavailable` / `decrypt-language-mode-restricted` / `decrypt-output-invalid` / `decrypt-roundtrip-failed` / `dpapi-foreign-blob` / `ciphertext-invalid` / `platform-unsupported`；stderr 脱敏后只进诊断。
- 模型页与 401 报错按三类失败给不同下一步：工具链不可用（说缺什么）、自检成功但该密文解不开（明确「不是当前 Studio 进程这个 Windows 用户/机器存的，Studio 内部绕不过去」）、都没保存（维持原文案）。
- 「获取模型列表」结果新增 `authProbe`：列表请求不带 Authorization 时明确说「列表 200 不代表对话可用」；同一凭据在 `chat/completions` 被拒时单独给出结论。页面同步显示，不再把「能拉模型」当成凭据可用的证明。

# 0.8.46

- 无可用 Key 时把可操作原因（路径/结构/条目/原因码）直接放状态行，不再只藏在折叠诊断里。

# 0.8.45

- Key 输入框占位改短（只显示「已设置」），完整来源仍写在状态行，避免窄屏截断；无其它行为变化。

# 0.8.44

- 自定义模型 401 的根因修复：Windows 下桌面端已保存的 Key 现在由插件**只读**取用（`~/.deva/secrets.json`，按需 DPAPI 解密，明文只留内存、不落盘、不进日志、不回前端），用户不必两端各填一遍；插件侧显式保存的 Key 仍优先。
- 修掉「Studio 保存过、重开就丢」：插件凭据从 `state.profile`（userId + 会话 Profile）改为 `state.user`（账号级）；旧 Profile 作用域的记录读到后自动迁移。
- 模型页显示密钥来源（已设置（插件）/ 已设置（桌面端 Secrets，只读）/ 未设置），只显示状态不显示值；未设置时区分「没保存」「保存了读不回」「桌面有但解不开」，并给出 secrets.json 确切路径、是否存在、大小/结构、原因码。
- 401 报错改为按来源给下一步：桌面只读 Key 被拒 → 桌面端更新或手动覆盖；插件 Key 被拒 → Studio 侧更新；都没有 → 说明两端都查过以及桌面文件的实际状态。

# 0.8.43

- 零候选直接显示实际配置路径、缺失/解析错误、提供方与模型计数及重试，不再只藏在折叠诊断中。

# 0.8.42

- 记录实际直连请求序列化后的模型名和强度（缺省标为 omitted），不记录消息、请求头或凭据；采集失败不影响推理。

# 0.8.41

- 分开记录普通候选按钮和折叠原生 select 的几何信息，增加 bottom 字段，避免把折叠 select 当成列表不可见。
- 服务端日志版本从包清单读取；客户端下发版本从模块元数据识别，不依赖已移除的正文版本号。

# 0.8.40

- Studio 会话模型选择器改为展示桌面已启用模型与远端 `/models` 的去重目录，复用管理员批准与服务端凭据规则，远端失败保留本地项。
- “Agent 默认模型”跟随桌面/身份默认；选择具体模型只固定当前会话，运行时按对应 provider 路由，不再忽略会话选择。兼容旧 `deva-direct` 会话。
- 导航仍为“模型”，版本不出现在正文；不改桌面默认，不另存模型配置真源。

# 0.8.39

- 导航只显示视图名，主状态行不再显示版本。
- 增加管理员批准路径、完整地址复制与追加JSON说明；不自动批准、不改变网络策略。

# 0.8.38

- 获取模型列表一次读取桌面配置并刷新远端，合并去重；远端失败保留本地候选。
- 候选以普通按钮展示，原生选择器保留在折叠区。顶部保留版本、计数、阶段与失败摘要。
