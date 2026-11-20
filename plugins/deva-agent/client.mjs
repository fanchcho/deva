/**
 * Agent 设置页：两个独立页面，同一个 client 入口按 ctx.view 分流。
 *
 *  · identity：选这个 Agent 用哪个人设说话（存 user+profile 作用域）。
 *  · mcp：直接管理 Studio 自己的 MCP 服务表——新增、改配置、启停、测试、删除，
 *         与 Studio 的「MCP」页面是同一份数据；再勾选本 Agent 用哪些服务。
 *
 * 版式对齐 Studio 原生 MCP 页（McpView + McpServerCard）：汇总卡、搜索/添加工具行、
 * 服务卡片网格（名称 + 传输/来源/状态徽章 + 工具列表 + 文字按钮），新增/编辑用
 * JSON 配置弹窗。颜色的来源只有宿主主题桥那一份变量，深浅色主题都跟着 Studio 走。
 *
 * 页面只做展示与调用 RPC：MCP 连接配置只有 Studio 一份，读写都走 Studio 的
 * /api/ekko/mcp/servers（经宿主通道）；插件只存「用哪些服务名」（user+profile 作用域）。
 * 连接配置每轮运行时现取，所以在这里或 Studio 里改完，下一轮对话就生效。
 */
const labels = {
  "zh": {
    "title": "身份",
    "hint": "选择这个 Agent 用哪个人设说话。保存后下一轮生效。",
    "save": "保存",
    "saved": "已保存：{name}",
    "none": "未读取到身份目录",
    "mcpTitle": "MCP 服务器",
    "mcpHint": "服务配置只有一份，存在 Studio 里：这里增删改与 Studio 的「MCP」页面完全等价。勾选本 Agent 要用的服务，连接配置每轮现取，下一轮生效。",
    "search": "搜索服务器...",
    "add": "+ 添加服务器",
    "reload": "刷新",
    "openStudio": "在 Studio 中打开",
    "summaryTotal": "总计",
    "summaryEnabled": "已启用",
    "summaryManaged": "Studio 管理",
    "summaryTools": "工具",
    "selectionCount": "已勾选 {count} 个服务",
    "connectedStatus": "已连接",
    "disconnectedStatus": "未连接",
    "disabledStatus": "已禁用",
    "useForAgent": "本 Agent 使用",
    "toolList": "工具列表",
    "toolCount": "{count} 个工具",
    "moreTools": "+{count} 个",
    "untested": "尚未测试",
    "edit": "编辑",
    "test": "测试",
    "enable": "启用",
    "disable": "禁用",
    "remove": "删除",
    "testing": "测试中…",
    "testSuccess": "测试成功 — {count} 个工具可用",
    "testFailed": "连接测试失败",
    "saveSelection": "保存勾选",
    "savedSelection": "已勾选 {count} 个 MCP 服务",
    "mcpNone": "尚未配置 MCP 服务",
    "mcpEmpty": "未勾选任何 MCP 服务：本轮不会连接 Studio 的 MCP。",
    "mcpGone": "Studio 里已不存在",
    "addTitle": "添加服务",
    "editTitle": "编辑服务",
    "configHint": "本地 MCP 使用 command/args/env；远程 MCP 使用 type: streamable_http、url 和可选 headers。",
    "invalidJson": "JSON 格式错误",
    "invalidConfig": "配置格式错误",
    "invalidServerConfig": "服务器配置无效",
    "missingCommandOrUrl": "必须包含 command 或 url",
    "saveAction": "保存",
    "cancel": "取消",
    "confirmRemove": "确定从 Studio 删除 MCP 服务「{name}」？"
  },
  "en": {
    "title": "Identity",
    "hint": "Choose which persona this agent speaks with. Applied from the next turn.",
    "save": "Save",
    "saved": "Saved: {name}",
    "none": "No identities available",
    "mcpTitle": "MCP servers",
    "mcpHint": "There is one copy of every server config, and it lives in Studio: changes here are the same as on Studio’s MCP page. Tick the servers this agent should use; connection config is read fresh each turn.",
    "search": "Search servers...",
    "add": "+ Add Server",
    "reload": "Refresh",
    "openStudio": "Open in Studio",
    "summaryTotal": "Total",
    "summaryEnabled": "Enabled",
    "summaryManaged": "Studio-managed",
    "summaryTools": "Tools",
    "selectionCount": "Selected {count} of them",
    "connectedStatus": "Connected",
    "disconnectedStatus": "Disconnected",
    "disabledStatus": "Disabled",
    "useForAgent": "Use for this agent",
    "toolList": "Tools",
    "toolCount": "{count} tools",
    "moreTools": "+{count}",
    "untested": "Not tested yet",
    "edit": "Edit",
    "test": "Test",
    "enable": "Enable",
    "disable": "Disable",
    "remove": "Delete",
    "testing": "Testing…",
    "testSuccess": "Test succeeded — {count} tools available",
    "testFailed": "Connection test failed",
    "saveSelection": "Save selection",
    "savedSelection": "Selected {count} MCP servers",
    "mcpNone": "No MCP servers configured yet",
    "mcpEmpty": "No MCP servers selected: Studio MCP is not connected for this agent.",
    "mcpGone": "Missing from Studio",
    "addTitle": "Add server",
    "editTitle": "Edit server",
    "configHint": "Local MCP uses command/args/env; remote MCP uses type: streamable_http, url and optional headers.",
    "invalidJson": "Invalid JSON",
    "invalidConfig": "Invalid config shape",
    "invalidServerConfig": "Invalid server config",
    "missingCommandOrUrl": "Needs a non-empty command or url",
    "saveAction": "Save",
    "cancel": "Cancel",
    "confirmRemove": "Delete MCP server “{name}” from Studio?"
  },
  "zh-TW": {
    "title": "身分",
    "hint": "選擇這個 Agent 使用哪個人設。儲存後下一輪生效。",
    "save": "儲存",
    "saved": "已儲存：{name}",
    "none": "未讀取到身分目錄",
    "mcpTitle": "MCP 伺服器",
    "mcpHint": "服務設定只有一份，存在 Studio 裡：這裡增刪改與 Studio 的「MCP」頁面完全等價。勾選本 Agent 要用的服務，連線設定每輪現取，下一輪生效。",
    "search": "搜尋伺服器...",
    "add": "+ 新增伺服器",
    "reload": "重新整理",
    "openStudio": "在 Studio 中開啟",
    "summaryTotal": "總計",
    "summaryEnabled": "已啟用",
    "summaryManaged": "Studio 管理",
    "summaryTools": "工具",
    "selectionCount": "已勾選 {count} 個服務",
    "connectedStatus": "已連線",
    "disconnectedStatus": "未連線",
    "disabledStatus": "已停用",
    "useForAgent": "本 Agent 使用",
    "toolList": "工具清單",
    "toolCount": "{count} 個工具",
    "moreTools": "+{count} 個",
    "untested": "尚未測試",
    "edit": "編輯",
    "test": "測試",
    "enable": "啟用",
    "disable": "停用",
    "remove": "刪除",
    "testing": "測試中…",
    "testSuccess": "測試成功 — {count} 個工具可用",
    "testFailed": "連線測試失敗",
    "saveSelection": "儲存勾選",
    "savedSelection": "已勾選 {count} 個 MCP 服務",
    "mcpNone": "尚未設定 MCP 服務",
    "mcpEmpty": "未勾選任何 MCP 服務：本輪不會連線 Studio 的 MCP。",
    "mcpGone": "Studio 裡已不存在",
    "addTitle": "新增服務",
    "editTitle": "編輯服務",
    "configHint": "本地 MCP 使用 command/args/env；遠端 MCP 使用 type: streamable_http、url 與選填 headers。",
    "invalidJson": "JSON 格式錯誤",
    "invalidConfig": "設定格式錯誤",
    "invalidServerConfig": "伺服器設定無效",
    "missingCommandOrUrl": "必須包含 command 或 url",
    "saveAction": "儲存",
    "cancel": "取消",
    "confirmRemove": "確定從 Studio 刪除 MCP 服務「{name}」？"
  },
  "ja": {
    "title": "アイデンティティ",
    "hint": "この Agent が使うペルソナを選択します。保存は次ターンから有効です。",
    "save": "保存",
    "saved": "保存しました：{name}",
    "none": "アイデンティティが見つかりません",
    "mcpTitle": "MCP サーバー",
    "mcpHint": "サーバー設定は Studio に 1 つだけあります。ここでの変更は Studio の MCP ページと完全に同じです。この Agent が使うサーバーにチェックを入れてください。接続設定は毎ターン読み直されます。",
    "search": "サーバーを検索...",
    "add": "+ サーバーを追加",
    "reload": "更新",
    "openStudio": "Studio で開く",
    "summaryTotal": "合計",
    "summaryEnabled": "有効",
    "summaryManaged": "Studio 管理",
    "summaryTools": "ツール",
    "selectionCount": "{count} 件選択",
    "connectedStatus": "接続済み",
    "disconnectedStatus": "未接続",
    "disabledStatus": "無効",
    "useForAgent": "この Agent で使用",
    "toolList": "ツール一覧",
    "toolCount": "{count} 個のツール",
    "moreTools": "+{count} 個",
    "untested": "未テスト",
    "edit": "編集",
    "test": "テスト",
    "enable": "有効化",
    "disable": "無効化",
    "remove": "削除",
    "testing": "テスト中…",
    "testSuccess": "テスト成功 — {count} 個のツールが利用可能",
    "testFailed": "接続テストに失敗しました",
    "saveSelection": "選択を保存",
    "savedSelection": "{count} 個の MCP サーバーを選択しました",
    "mcpNone": "MCP サーバーが未設定です",
    "mcpEmpty": "MCP サーバーが未選択です：この Agent では Studio の MCP に接続しません。",
    "mcpGone": "Studio に存在しません",
    "addTitle": "サーバーを追加",
    "editTitle": "サーバーを編集",
    "configHint": "ローカル MCP は command/args/env、リモート MCP は type: streamable_http、url と任意の headers を使います。",
    "invalidJson": "JSON の形式が正しくありません",
    "invalidConfig": "設定の形式が正しくありません",
    "invalidServerConfig": "サーバー設定が無効です",
    "missingCommandOrUrl": "command または url が必要です",
    "saveAction": "保存",
    "cancel": "キャンセル",
    "confirmRemove": "Studio から MCP サーバー「{name}」を削除しますか？"
  },
  "ko": {
    "title": "아이덴티티",
    "hint": "이 Agent가 사용할 페르소나를 선택합니다. 저장하면 다음 턴부터 적용됩니다.",
    "save": "저장",
    "saved": "저장됨: {name}",
    "none": "아이덴티티를 불러오지 못했습니다",
    "mcpTitle": "MCP 서버",
    "mcpHint": "서버 설정은 Studio에 한 벌만 있습니다. 여기서의 변경은 Studio의 MCP 페이지와 완전히 같습니다. 이 Agent가 사용할 서버를 선택하세요. 연결 설정은 매 턴 새로 읽습니다.",
    "search": "서버 검색...",
    "add": "+ 서버 추가",
    "reload": "새로고침",
    "openStudio": "Studio에서 열기",
    "summaryTotal": "전체",
    "summaryEnabled": "사용 중",
    "summaryManaged": "Studio 관리",
    "summaryTools": "도구",
    "selectionCount": "{count}개 선택",
    "connectedStatus": "연결됨",
    "disconnectedStatus": "연결 안 됨",
    "disabledStatus": "사용 안 함",
    "useForAgent": "이 Agent에서 사용",
    "toolList": "도구 목록",
    "toolCount": "도구 {count}개",
    "moreTools": "+{count}개",
    "untested": "아직 테스트하지 않음",
    "edit": "편집",
    "test": "테스트",
    "enable": "사용",
    "disable": "사용 안 함",
    "remove": "삭제",
    "testing": "테스트 중…",
    "testSuccess": "테스트 성공 — 도구 {count}개 사용 가능",
    "testFailed": "연결 테스트 실패",
    "saveSelection": "선택 저장",
    "savedSelection": "MCP 서버 {count}개를 선택했습니다",
    "mcpNone": "구성된 MCP 서버가 없습니다",
    "mcpEmpty": "선택한 MCP 서버가 없습니다: 이 Agent는 Studio MCP에 연결하지 않습니다.",
    "mcpGone": "Studio에 없음",
    "addTitle": "서버 추가",
    "editTitle": "서버 편집",
    "configHint": "로컬 MCP는 command/args/env, 원격 MCP는 type: streamable_http, url과 선택적 headers를 사용합니다.",
    "invalidJson": "JSON 형식 오류",
    "invalidConfig": "설정 형식 오류",
    "invalidServerConfig": "서버 설정이 올바르지 않습니다",
    "missingCommandOrUrl": "command 또는 url이 필요합니다",
    "saveAction": "저장",
    "cancel": "취소",
    "confirmRemove": "Studio에서 MCP 서버 “{name}”을(를) 삭제할까요?"
  },
  "fr": {
    "title": "Identité",
    "hint": "Choisissez la personnalité de cet agent. Appliqué à partir du tour suivant.",
    "save": "Enregistrer",
    "saved": "Enregistré : {name}",
    "none": "Aucune identité disponible",
    "mcpTitle": "Serveurs MCP",
    "mcpHint": "La configuration de chaque serveur n’existe qu’une fois, dans Studio : les modifications ici sont identiques à celles de la page MCP de Studio. Cochez les serveurs à utiliser ; la configuration est relue à chaque tour.",
    "search": "Rechercher un serveur...",
    "add": "+ Ajouter un serveur",
    "reload": "Actualiser",
    "openStudio": "Ouvrir dans Studio",
    "summaryTotal": "Total",
    "summaryEnabled": "Activés",
    "summaryManaged": "Gérés par Studio",
    "summaryTools": "Outils",
    "selectionCount": "{count} sélectionnés",
    "connectedStatus": "Connecté",
    "disconnectedStatus": "Déconnecté",
    "disabledStatus": "Désactivé",
    "useForAgent": "Utiliser pour cet agent",
    "toolList": "Outils",
    "toolCount": "{count} outils",
    "moreTools": "+{count}",
    "untested": "Pas encore testé",
    "edit": "Modifier",
    "test": "Tester",
    "enable": "Activer",
    "disable": "Désactiver",
    "remove": "Supprimer",
    "testing": "Test en cours…",
    "testSuccess": "Test réussi — {count} outils disponibles",
    "testFailed": "Échec du test de connexion",
    "saveSelection": "Enregistrer la sélection",
    "savedSelection": "{count} serveurs MCP sélectionnés",
    "mcpNone": "Aucun serveur MCP configuré",
    "mcpEmpty": "Aucun serveur MCP sélectionné : le MCP de Studio n’est pas connecté pour cet agent.",
    "mcpGone": "Absent de Studio",
    "addTitle": "Ajouter un serveur",
    "editTitle": "Modifier le serveur",
    "configHint": "MCP local : command/args/env ; MCP distant : type: streamable_http, url et headers facultatifs.",
    "invalidJson": "JSON invalide",
    "invalidConfig": "Structure de configuration invalide",
    "invalidServerConfig": "Configuration de serveur invalide",
    "missingCommandOrUrl": "Un command ou une url non vide est requis",
    "saveAction": "Enregistrer",
    "cancel": "Annuler",
    "confirmRemove": "Supprimer le serveur MCP « {name} » de Studio ?"
  },
  "es": {
    "title": "Identidad",
    "hint": "Elige con qué persona habla este Agent. Se aplica desde el siguiente turno.",
    "save": "Guardar",
    "saved": "Guardado: {name}",
    "none": "No se encontraron identidades",
    "mcpTitle": "Servidores MCP",
    "mcpHint": "La configuración de cada servidor existe una sola vez, en Studio: los cambios aquí son idénticos a los de la página MCP de Studio. Marca los servidores que usará este Agent; la configuración se lee en cada turno.",
    "search": "Buscar servidores...",
    "add": "+ Añadir servidor",
    "reload": "Actualizar",
    "openStudio": "Abrir en Studio",
    "summaryTotal": "Total",
    "summaryEnabled": "Activados",
    "summaryManaged": "Gestionados por Studio",
    "summaryTools": "Herramientas",
    "selectionCount": "{count} seleccionados",
    "connectedStatus": "Conectado",
    "disconnectedStatus": "Desconectado",
    "disabledStatus": "Desactivado",
    "useForAgent": "Usar con este Agent",
    "toolList": "Herramientas",
    "toolCount": "{count} herramientas",
    "moreTools": "+{count}",
    "untested": "Sin probar",
    "edit": "Editar",
    "test": "Probar",
    "enable": "Activar",
    "disable": "Desactivar",
    "remove": "Eliminar",
    "testing": "Probando…",
    "testSuccess": "Prueba correcta — {count} herramientas disponibles",
    "testFailed": "Falló la prueba de conexión",
    "saveSelection": "Guardar selección",
    "savedSelection": "{count} servidores MCP seleccionados",
    "mcpNone": "No hay servidores MCP configurados",
    "mcpEmpty": "Ningún servidor MCP seleccionado: el MCP de Studio no se conecta para este Agent.",
    "mcpGone": "Ya no existe en Studio",
    "addTitle": "Añadir servidor",
    "editTitle": "Editar servidor",
    "configHint": "MCP local usa command/args/env; MCP remoto usa type: streamable_http, url y headers opcionales.",
    "invalidJson": "JSON no válido",
    "invalidConfig": "Formato de configuración no válido",
    "invalidServerConfig": "Configuración de servidor no válida",
    "missingCommandOrUrl": "Requiere command o url no vacío",
    "saveAction": "Guardar",
    "cancel": "Cancelar",
    "confirmRemove": "¿Eliminar el servidor MCP «{name}» de Studio?"
  },
  "de": {
    "title": "Identität",
    "hint": "Wähle die Persona, mit der dieser Agent spricht. Gilt ab dem nächsten Turn.",
    "save": "Speichern",
    "saved": "Gespeichert: {name}",
    "none": "Keine Identitäten gefunden",
    "mcpTitle": "MCP-Server",
    "mcpHint": "Die Konfiguration jedes Servers existiert nur einmal, in Studio: Änderungen hier entsprechen genau denen auf Studios MCP-Seite. Hake die Server an, die dieser Agent nutzen soll; die Konfiguration wird in jedem Turn neu gelesen.",
    "search": "Server suchen...",
    "add": "+ Server hinzufügen",
    "reload": "Aktualisieren",
    "openStudio": "In Studio öffnen",
    "summaryTotal": "Gesamt",
    "summaryEnabled": "Aktiv",
    "summaryManaged": "Studio-verwaltet",
    "summaryTools": "Werkzeuge",
    "selectionCount": "{count} ausgewählt",
    "connectedStatus": "Verbunden",
    "disconnectedStatus": "Getrennt",
    "disabledStatus": "Deaktiviert",
    "useForAgent": "Für diesen Agent nutzen",
    "toolList": "Werkzeuge",
    "toolCount": "{count} Werkzeuge",
    "moreTools": "+{count}",
    "untested": "Noch nicht getestet",
    "edit": "Bearbeiten",
    "test": "Testen",
    "enable": "Aktivieren",
    "disable": "Deaktivieren",
    "remove": "Löschen",
    "testing": "Wird getestet…",
    "testSuccess": "Test erfolgreich — {count} Werkzeuge verfügbar",
    "testFailed": "Verbindungstest fehlgeschlagen",
    "saveSelection": "Auswahl speichern",
    "savedSelection": "{count} MCP-Server ausgewählt",
    "mcpNone": "Noch keine MCP-Server konfiguriert",
    "mcpEmpty": "Keine MCP-Server ausgewählt: Studio-MCP wird für diesen Agent nicht verbunden.",
    "mcpGone": "In Studio nicht mehr vorhanden",
    "addTitle": "Server hinzufügen",
    "editTitle": "Server bearbeiten",
    "configHint": "Lokales MCP nutzt command/args/env; entferntes MCP nutzt type: streamable_http, url und optionale headers.",
    "invalidJson": "Ungültiges JSON",
    "invalidConfig": "Ungültiges Konfigurationsformat",
    "invalidServerConfig": "Ungültige Serverkonfiguration",
    "missingCommandOrUrl": "command oder url erforderlich",
    "saveAction": "Speichern",
    "cancel": "Abbrechen",
    "confirmRemove": "MCP-Server „{name}“ aus Studio löschen?"
  },
  "pt": {
    "title": "Identidade",
    "hint": "Escolha com qual persona este Agent fala. Aplica-se a partir do próximo turno.",
    "save": "Salvar",
    "saved": "Salvo: {name}",
    "none": "Nenhuma identidade encontrada",
    "mcpTitle": "Servidores MCP",
    "mcpHint": "A configuração de cada servidor existe uma única vez, no Studio: alterações aqui são idênticas às da página MCP do Studio. Marque os servidores que este Agent deve usar; a configuração é lida a cada turno.",
    "search": "Pesquisar servidores...",
    "add": "+ Adicionar servidor",
    "reload": "Atualizar",
    "openStudio": "Abrir no Studio",
    "summaryTotal": "Total",
    "summaryEnabled": "Ativos",
    "summaryManaged": "Gerenciados pelo Studio",
    "summaryTools": "Ferramentas",
    "selectionCount": "{count} selecionados",
    "connectedStatus": "Conectado",
    "disconnectedStatus": "Desconectado",
    "disabledStatus": "Desativado",
    "useForAgent": "Usar neste Agent",
    "toolList": "Ferramentas",
    "toolCount": "{count} ferramentas",
    "moreTools": "+{count}",
    "untested": "Ainda não testado",
    "edit": "Editar",
    "test": "Testar",
    "enable": "Ativar",
    "disable": "Desativar",
    "remove": "Excluir",
    "testing": "Testando…",
    "testSuccess": "Teste concluído — {count} ferramentas disponíveis",
    "testFailed": "Falha no teste de conexão",
    "saveSelection": "Salvar seleção",
    "savedSelection": "{count} servidores MCP selecionados",
    "mcpNone": "Nenhum servidor MCP configurado",
    "mcpEmpty": "Nenhum servidor MCP selecionado: o MCP do Studio não é conectado para este Agent.",
    "mcpGone": "Não existe mais no Studio",
    "addTitle": "Adicionar servidor",
    "editTitle": "Editar servidor",
    "configHint": "MCP local usa command/args/env; MCP remoto usa type: streamable_http, url e headers opcionais.",
    "invalidJson": "JSON inválido",
    "invalidConfig": "Formato de configuração inválido",
    "invalidServerConfig": "Configuração de servidor inválida",
    "missingCommandOrUrl": "Requer command ou url não vazio",
    "saveAction": "Salvar",
    "cancel": "Cancelar",
    "confirmRemove": "Excluir o servidor MCP “{name}” do Studio?"
  },
  "ru": {
    "title": "Идентичность",
    "hint": "Выберите, от чьего лица говорит этот Agent. Применится со следующего хода.",
    "save": "Сохранить",
    "saved": "Сохранено: {name}",
    "none": "Идентичности не найдены",
    "mcpTitle": "MCP-серверы",
    "mcpHint": "Конфигурация каждого сервера существует в единственном экземпляре — в Studio: изменения здесь полностью совпадают с изменениями на странице MCP в Studio. Отметьте серверы для этого Agent; конфигурация читается заново каждый ход.",
    "search": "Поиск серверов...",
    "add": "+ Добавить сервер",
    "reload": "Обновить",
    "openStudio": "Открыть в Studio",
    "summaryTotal": "Всего",
    "summaryEnabled": "Включено",
    "summaryManaged": "Управляется Studio",
    "summaryTools": "Инструменты",
    "selectionCount": "Выбрано: {count}",
    "connectedStatus": "Подключён",
    "disconnectedStatus": "Не подключён",
    "disabledStatus": "Отключён",
    "useForAgent": "Использовать для этого Agent",
    "toolList": "Инструменты",
    "toolCount": "{count} инструментов",
    "moreTools": "+{count}",
    "untested": "Ещё не проверялся",
    "edit": "Изменить",
    "test": "Проверить",
    "enable": "Включить",
    "disable": "Отключить",
    "remove": "Удалить",
    "testing": "Проверка…",
    "testSuccess": "Проверка успешна — доступно инструментов: {count}",
    "testFailed": "Проверка подключения не удалась",
    "saveSelection": "Сохранить выбор",
    "savedSelection": "Выбрано MCP-серверов: {count}",
    "mcpNone": "MCP-серверы не настроены",
    "mcpEmpty": "MCP-серверы не выбраны: Studio MCP не подключается для этого Agent.",
    "mcpGone": "Отсутствует в Studio",
    "addTitle": "Добавить сервер",
    "editTitle": "Изменить сервер",
    "configHint": "Локальный MCP использует command/args/env; удалённый — type: streamable_http, url и необязательные headers.",
    "invalidJson": "Неверный JSON",
    "invalidConfig": "Неверный формат конфигурации",
    "invalidServerConfig": "Недопустимая конфигурация сервера",
    "missingCommandOrUrl": "Требуется непустой command или url",
    "saveAction": "Сохранить",
    "cancel": "Отмена",
    "confirmRemove": "Удалить MCP-сервер «{name}» из Studio?"
  },
  "ar": {
    "title": "الهوية",
    "hint": "اختر الشخصية التي يتحدث بها هذا الوكيل. تُطبَّق من الجولة التالية.",
    "save": "حفظ",
    "saved": "تم الحفظ: {name}",
    "none": "لم يتم العثور على هويات",
    "mcpTitle": "خوادم MCP",
    "mcpHint": "لكل خادم نسخة واحدة من الإعدادات، وهي في Studio: التغييرات هنا مطابقة تمامًا لصفحة MCP في Studio. حدّد الخوادم التي يستخدمها هذا الوكيل؛ تُقرأ الإعدادات من جديد في كل جولة.",
    "search": "بحث في الخوادم...",
    "add": "+ إضافة خادم",
    "reload": "تحديث",
    "openStudio": "فتح في Studio",
    "summaryTotal": "الإجمالي",
    "summaryEnabled": "المفعّلة",
    "summaryManaged": "تديرها Studio",
    "summaryTools": "الأدوات",
    "selectionCount": "المحدد: {count}",
    "connectedStatus": "متصل",
    "disconnectedStatus": "غير متصل",
    "disabledStatus": "معطّل",
    "useForAgent": "استخدام لهذا الوكيل",
    "toolList": "الأدوات",
    "toolCount": "{count} أدوات",
    "moreTools": "+{count}",
    "untested": "لم يُختبر بعد",
    "edit": "تعديل",
    "test": "اختبار",
    "enable": "تفعيل",
    "disable": "تعطيل",
    "remove": "حذف",
    "testing": "جارٍ الاختبار…",
    "testSuccess": "نجح الاختبار — {count} أدوات متاحة",
    "testFailed": "فشل اختبار الاتصال",
    "saveSelection": "حفظ التحديد",
    "savedSelection": "تم تحديد {count} من خوادم MCP",
    "mcpNone": "لم تُضبط خوادم MCP بعد",
    "mcpEmpty": "لم يتم تحديد أي خادم MCP: لن يتصل هذا الوكيل بـ Studio MCP.",
    "mcpGone": "لم يعد موجودًا في Studio",
    "addTitle": "إضافة خادم",
    "editTitle": "تعديل الخادم",
    "configHint": "يستخدم MCP المحلي command/args/env؛ ويستخدم MCP البعيد type: streamable_http وurl وheaders اختيارية.",
    "invalidJson": "صيغة JSON غير صحيحة",
    "invalidConfig": "صيغة الإعدادات غير صحيحة",
    "invalidServerConfig": "إعدادات الخادم غير صالحة",
    "missingCommandOrUrl": "يلزم وجود command أو url غير فارغ",
    "saveAction": "حفظ",
    "cancel": "إلغاء",
    "confirmRemove": "حذف خادم MCP «{name}» من Studio؟"
  },
  "tr": {
    "title": "Kimlik",
    "hint": "Bu Agent’ın hangi kişilikle konuşacağını seçin. Sonraki turdan itibaren geçerli olur.",
    "save": "Kaydet",
    "saved": "Kaydedildi: {name}",
    "none": "Kimlik bulunamadı",
    "mcpTitle": "MCP sunucuları",
    "mcpHint": "Her sunucunun yapılandırması yalnızca bir yerde, Studio’da bulunur: buradaki değişiklikler Studio’nun MCP sayfasıyla birebir aynıdır. Bu Agent’ın kullanacağı sunucuları işaretleyin; bağlantı yapılandırması her turda yeniden okunur.",
    "search": "Sunucu ara...",
    "add": "+ Sunucu ekle",
    "reload": "Yenile",
    "openStudio": "Studio’da aç",
    "summaryTotal": "Toplam",
    "summaryEnabled": "Etkin",
    "summaryManaged": "Studio yönetiminde",
    "summaryTools": "Araçlar",
    "selectionCount": "{count} seçili",
    "connectedStatus": "Bağlı",
    "disconnectedStatus": "Bağlı değil",
    "disabledStatus": "Devre dışı",
    "useForAgent": "Bu Agent için kullan",
    "toolList": "Araçlar",
    "toolCount": "{count} araç",
    "moreTools": "+{count}",
    "untested": "Henüz test edilmedi",
    "edit": "Düzenle",
    "test": "Test et",
    "enable": "Etkinleştir",
    "disable": "Devre dışı bırak",
    "remove": "Sil",
    "testing": "Test ediliyor…",
    "testSuccess": "Test başarılı — {count} araç kullanılabilir",
    "testFailed": "Bağlantı testi başarısız",
    "saveSelection": "Seçimi kaydet",
    "savedSelection": "{count} MCP sunucusu seçildi",
    "mcpNone": "Henüz MCP sunucusu yapılandırılmadı",
    "mcpEmpty": "Hiç MCP sunucusu seçilmedi: bu Agent için Studio MCP bağlanmaz.",
    "mcpGone": "Studio’da artık yok",
    "addTitle": "Sunucu ekle",
    "editTitle": "Sunucuyu düzenle",
    "configHint": "Yerel MCP command/args/env kullanır; uzak MCP type: streamable_http, url ve isteğe bağlı headers kullanır.",
    "invalidJson": "JSON biçimi hatalı",
    "invalidConfig": "Yapılandırma biçimi hatalı",
    "invalidServerConfig": "Sunucu yapılandırması geçersiz",
    "missingCommandOrUrl": "Boş olmayan command veya url gerekir",
    "saveAction": "Kaydet",
    "cancel": "İptal",
    "confirmRemove": "MCP sunucusu “{name}” Studio’dan silinsin mi?"
  }
}

function pickLocale(locale) {
  const requested = String(locale || 'en').replaceAll('_', '-').toLowerCase()
  if (labels[requested]) return requested
  const base = requested.split('-')[0]
  return labels[base] ? base : 'en'
}

function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match))
}

/**
 * 样式表和宿主原生页对齐：同一套主题变量、同样的卡片/徽章/栅格尺寸。
 * 宿主通过 init 只注入一部分变量，所以每个 var() 都带 fallback；
 * 强调色上的文字用 --bg-card 取反色，深浅主题都成立。
 */
const STYLE_ID = 'deva-agent-settings-style'
const STYLES = `
.deva-settings{display:flex;flex-direction:column;padding:calc(20px * var(--spacing-scale,1));min-width:0;color:var(--text-primary,#1a1a1a);font-family:var(--font-family,inherit);font-size:var(--font-size-base,14px);line-height:var(--line-height,1.4)}
.deva-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.deva-header h2{margin:0;font-size:calc(var(--font-size-base,14px) * 16 / 14);font-weight:600;color:var(--text-primary,#1a1a1a)}
.deva-header p{margin:6px 0 0;max-width:70ch;color:var(--text-secondary,#666);font-size:calc(var(--font-size-base,14px) * 12 / 14);line-height:1.5}
.deva-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.deva-summary{display:grid;gap:calc(12px * var(--spacing-scale,1));grid-template-columns:repeat(auto-fill,minmax(140px,1fr));margin-bottom:16px}
.deva-summary-card{display:flex;flex-direction:column;gap:calc(6px * var(--spacing-scale,1));padding:calc(14px * var(--spacing-scale,1));border:var(--border-width,1px) solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,8px);background:var(--theme-card-bg,var(--bg-card,#fff))}
.deva-summary-card strong{font-size:calc(var(--font-size-base,14px) * 24 / 14);line-height:var(--line-height,1.4);font-weight:700}
.deva-summary-card.ok strong{color:var(--success,#2e7d32)}
.deva-summary-card.info strong{color:var(--accent-primary,#333)}
.deva-summary-label{font-size:calc(var(--font-size-base,14px) * 11 / 14);color:var(--text-muted,#999);text-transform:uppercase;letter-spacing:.04em}
.deva-toolbar{display:flex;align-items:center;gap:calc(10px * var(--spacing-scale,1));flex-wrap:wrap;margin-bottom:16px}
.deva-search{flex:1;min-width:0;max-width:360px;height:var(--control-height,30px);padding:0 10px;box-sizing:border-box;border:1px solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,6px);background:var(--bg-input,#fff);color:inherit;font:inherit;font-size:calc(var(--font-size-base,14px) * 13 / 14)}
.deva-search:focus{outline:none;border-color:var(--accent-primary,#333)}
.deva-btn{height:var(--control-height,30px);padding:0 14px;box-sizing:border-box;border:1px solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,6px);background:var(--bg-input,#fff);color:var(--text-primary,#1a1a1a);font:inherit;font-size:calc(var(--font-size-base,14px) * 13 / 14);cursor:pointer;white-space:nowrap}
.deva-btn:hover{border-color:var(--accent-primary,#333)}
.deva-btn:disabled{opacity:.55;cursor:default}
.deva-btn.primary{background:var(--accent-primary,#333);border-color:var(--accent-primary,#333);color:var(--bg-card,#fff)}
.deva-btn.primary:hover{opacity:.9;border-color:var(--accent-primary,#333)}
.deva-btn.ghost{height:auto;padding:2px 8px;border-color:transparent;background:transparent;color:var(--text-secondary,#666)}
.deva-btn.ghost:hover{background:rgba(var(--accent-primary-rgb,51,51,51),.08);color:var(--text-primary,#1a1a1a)}
.deva-grid{display:grid;gap:calc(14px * var(--spacing-scale,1));grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))}
.deva-card{background:var(--theme-card-bg,var(--bg-card,#fff));border:var(--border-width,1px) solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,8px);padding:calc(16px * var(--spacing-scale,1));transition:border-color .15s}
.deva-card:hover{border-color:rgba(var(--accent-primary-rgb,51,51,51),.3)}
.deva-card.off{opacity:.7}
.deva-card.bad{border-color:color-mix(in srgb,var(--error,#c62828) 30%,transparent)}
.deva-card-head{display:flex;align-items:center;justify-content:space-between;gap:calc(12px * var(--spacing-scale,1));margin-bottom:12px}
.deva-name{margin:0;max-width:70%;font-size:calc(var(--font-size-base,14px) * 15 / 14);font-weight:600;color:var(--text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.deva-check{width:15px;height:15px;margin:0;flex:none;cursor:pointer;accent-color:var(--accent-primary,#333)}
.deva-use{display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary,#666);font-size:calc(var(--font-size-base,14px) * 12 / 14);cursor:pointer;white-space:nowrap}
.deva-badges{display:flex;align-items:center;justify-content:flex-end;gap:calc(6px * var(--spacing-scale,1));flex-wrap:wrap;min-width:0}
.deva-badge{font-size:calc(var(--font-size-base,14px) * 11 / 14);padding:2px 8px;border-radius:var(--radius-component,10px);font-weight:500;white-space:nowrap}
.deva-badge.transport{background:rgba(var(--accent-primary-rgb,51,51,51),.12);color:var(--accent-primary,#333)}
.deva-badge.context{background:rgba(var(--accent-primary-rgb,51,51,51),.08);color:var(--text-secondary,#666)}
.deva-badge.ok{background:color-mix(in srgb,var(--success,#2e7d32) 12%,transparent);color:var(--success,#2e7d32)}
.deva-badge.off{background:color-mix(in srgb,var(--text-muted,#999) 12%,transparent);color:var(--text-muted,#999)}
.deva-badge.bad{background:color-mix(in srgb,var(--error,#c62828) 12%,transparent);color:var(--error,#c62828)}
.deva-card-body{display:flex;flex-direction:column;gap:calc(8px * var(--spacing-scale,1));margin-bottom:14px}
.deva-info{display:flex;align-items:center;justify-content:space-between;gap:8px}
.deva-info-label{font-size:calc(var(--font-size-base,14px) * 12 / 14);color:var(--text-muted,#999)}
.deva-info-value{font-size:calc(var(--font-size-base,14px) * 12 / 14);color:var(--text-secondary,#666)}
.deva-tools{display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px 6px;height:88px;overflow-y:auto}
.deva-tool{display:inline-flex;align-items:center;min-height:22px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 6px;border-radius:var(--radius-component,3px);background:rgba(var(--accent-primary-rgb,51,51,51),.08);color:var(--text-secondary,#666);cursor:default;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:calc(var(--font-size-base,14px) * 10 / 14)}
.deva-tool:hover{background:rgba(var(--accent-primary-rgb,51,51,51),.16)}
.deva-tool.more{background:rgba(var(--accent-primary-rgb,51,51,51),.15);color:var(--accent-primary,#333);font-weight:500}
.deva-card-error{color:var(--error,#c62828);font-size:calc(var(--font-size-base,14px) * 11 / 14);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.deva-tools-empty{display:flex;align-items:center;justify-content:center;height:88px}
.deva-muted{color:var(--text-muted,#999);font-size:calc(var(--font-size-base,14px) * 12 / 14)}
.deva-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:calc(10px * var(--spacing-scale,1));border-top:var(--border-width,1px) solid var(--border-light,#ebebeb)}
.deva-actions{display:flex;align-items:center;gap:calc(8px * var(--spacing-scale,1));flex-wrap:wrap}
.deva-alert{padding:10px 12px;border-radius:var(--radius-component,6px);border:var(--border-width,1px) solid color-mix(in srgb,var(--error,#c62828) 40%,transparent);background:color-mix(in srgb,var(--error,#c62828) 8%,transparent);color:var(--error,#c62828);font-size:calc(var(--font-size-base,14px) * 12 / 14)}
.deva-status{min-height:18px;font-size:calc(var(--font-size-base,14px) * 12 / 14);color:var(--text-secondary,#666)}
.deva-status.error{color:var(--error,#c62828)}
.deva-empty{padding:24px;text-align:center;color:var(--text-muted,#999);border:var(--border-width,1px) dashed var(--border-color,#e0e0e0);border-radius:var(--radius-component,8px)}
.deva-overlay{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--theme-overlay-bg,rgba(0,0,0,.35))}
.deva-modal{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:16px;border:var(--border-width,1px) solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,8px);background:var(--theme-card-bg,var(--bg-card,#fff));box-shadow:0 12px 32px rgba(0,0,0,.18)}
.deva-modal h3{margin:0 0 12px;font-size:calc(var(--font-size-base,14px) * 15 / 14);font-weight:600;color:var(--text-primary,#1a1a1a)}
.deva-textarea{display:block;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,6px);background:var(--bg-input,#fff);color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:calc(var(--font-size-base,14px) * 13 / 14);line-height:1.5;resize:vertical}
.deva-textarea:focus{outline:none;border-color:var(--accent-primary,#333)}
.deva-textarea.invalid{border-color:var(--error,#c62828)}
.deva-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.deva-select{min-width:220px;max-width:100%;height:var(--control-height,32px);padding:0 10px;box-sizing:border-box;border:1px solid var(--border-color,#e0e0e0);border-radius:var(--radius-component,6px);background:var(--bg-input,#fff);color:inherit;font:inherit;font-size:calc(var(--font-size-base,14px) * 13 / 14)}
.deva-select:focus{outline:none;border-color:var(--accent-primary,#333)}
@media (max-width:768px){.deva-summary{grid-template-columns:repeat(2,1fr)}.deva-toolbar{flex-direction:column;align-items:stretch}.deva-search{max-width:none}.deva-grid{grid-template-columns:1fr}}
`

function ensureStyles() {
  const doc = document
  if (!doc?.head || typeof doc.getElementById !== 'function') return
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLES
  doc.head.append(style)
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label, className = 'deva-btn') {
  const element = el('button', className)
  element.type = 'button'
  element.textContent = label
  return element
}

function errorText(error) {
  return String(error?.message || error)
}

/** JSON 配置 → [name, config] 列表；错误信息与 Studio 弹窗一致（JSON / 结构 / 缺 command|url）。 */
function parseConfigs(raw, text) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(text.invalidJson)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(text.invalidConfig)
  const entries = Object.entries(parsed)
  if (!entries.length) throw new Error(text.invalidConfig)
  for (const [name, config] of entries) {
    if (!name.trim() || !config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error(`${name || text.invalidConfig}: ${text.invalidServerConfig}`)
    }
    const command = typeof config.command === 'string' && config.command.trim()
    const url = typeof config.url === 'string' && config.url.trim()
    if (!command && !url) throw new Error(`${name}: ${text.missingCommandOrUrl}`)
  }
  return entries
}

function prettyConfig(name, config) {
  return JSON.stringify(config ? { [name]: config } : {}, null, 2)
}

/** 新增时的占位模板，与 Studio 弹窗的默认文本一致。 */
const NEW_CONFIG_TEMPLATE = `{
  "local-tools": {
    "command": "node",
    "args": ["server.mjs"],
    "enabled": true
  }
}`

/** @param {HTMLElement} root @param {import('./sdk/src/index.ts').ClientContext} ctx */
export async function mount(root, ctx) {
  const locale = pickLocale(ctx.locale)
  const text = labels[locale]
  root.lang = locale
  root.dir = locale === 'ar' ? 'rtl' : 'ltr'
  root.innerHTML = ''
  ensureStyles()

  const container = el('div', 'deva-settings')
  root.append(container)

  // 两个页面共用一个客户端入口：路由变化会重新挂载，按 view 只渲染对应那一段
  if (ctx.view === 'mcp') await mountMcp(container, ctx, text)
  else await mountIdentity(container, ctx, text)
}

async function mountIdentity(container, ctx, text) {
  const heading = el('div')
  heading.append(el('h2', '', text.title), el('p', '', text.hint))
  const header = el('div', 'deva-header')
  header.append(heading)
  container.append(header)

  const card = el('div', 'deva-card')
  const body = el('div', 'deva-card-body')
  const select = el('select', 'deva-select')
  const save = button(text.save, 'deva-btn primary')
  save.style.alignSelf = 'flex-start'
  const status = el('div', 'deva-status')

  body.append(select, save)
  card.append(body, status)
  container.append(card)

  let identities = []
  try {
    const snapshot = await ctx.rpc.call('get-identities')
    identities = Array.isArray(snapshot?.identities) ? snapshot.identities : []
    // 用 DOM 构造选项而不是拼 HTML：身份名来自插件目录，仍然不当作可注入的标记
    for (const item of identities) {
      const option = document.createElement('option')
      option.value = String(item.id)
      option.textContent = String(item.name)
      select.append(option)
    }
    const selected = identities.find(item => item.id === snapshot?.selected)
    if (selected) select.value = String(selected.id)
    status.textContent = identities.length ? '' : text.none
  } catch (error) {
    status.textContent = errorText(error)
    status.className = 'deva-status error'
  }

  save.onclick = async () => {
    save.disabled = true
    try {
      const result = await ctx.rpc.call('save-selection', { identity: select.value })
      const name = identities.find(item => item.id === result?.selected)?.name || select.value
      status.className = 'deva-status'
      status.textContent = format(text.saved, { name })
      ctx.ui.notify(status.textContent, 'success')
    } catch (error) {
      status.className = 'deva-status error'
      status.textContent = errorText(error)
      ctx.ui.notify(status.textContent, 'error')
    } finally {
      save.disabled = false
    }
  }
}

async function mountMcp(container, ctx, text) {
  const header = el('div', 'deva-header')
  const heading = el('div')
  heading.append(el('h2', '', text.mcpTitle), el('p', '', text.mcpHint))
  const headerActions = el('div', 'deva-header-actions')
  const reload = button(text.reload, 'deva-btn')
  headerActions.append(reload)
  // 宿主原生 MCP 页面入口（能跳转时才给按钮，避免点了没反应）
  if (typeof ctx.ui?.navigate === 'function') {
    const openStudio = button(text.openStudio, 'deva-btn ghost')
    openStudio.onclick = () => ctx.ui.navigate('/ekko/mcp')
    headerActions.append(openStudio)
  }
  header.append(heading, headerActions)

  const alert = el('div', 'deva-alert')
  alert.style.display = 'none'

  // 与 Studio 原生页一致：固定四张汇总卡（总计 / 已启用 / Studio 管理 / 工具）。
  const summary = el('div', 'deva-summary')
  const card = (label, kind = '') => {
    const box = el('div', `deva-summary-card ${kind}`.trim())
    box.append(el('span', 'deva-summary-label', label), el('strong', '', '0'))
    summary.append(box)
    return box.children[1]
  }
  const totalValue = card(text.summaryTotal)
  const enabledValue = card(text.summaryEnabled, 'ok')
  const managedValue = card(text.summaryManaged)
  const toolsValue = card(text.summaryTools)

  const toolbar = el('div', 'deva-toolbar')
  const search = el('input', 'deva-search')
  search.type = 'search'
  search.placeholder = text.search
  const addButton = button(text.add, 'deva-btn primary')
  // Deva 独有：勾选计数与保存入口放工具栏，不额外占一张汇总卡
  const selectionInfo = el('span', 'deva-muted')
  const saveSelection = button(text.saveSelection, 'deva-btn')
  toolbar.append(search, addButton, selectionInfo, saveSelection)

  const grid = el('div', 'deva-grid')
  const status = el('div', 'deva-status')
  const modalHost = el('div')

  container.append(header, alert, summary, toolbar, grid, status, modalHost)

  /** @type {Array<{name: string, transport: string, managed: boolean, enabled: boolean}>} */
  let servers = []
  /** 勾选状态只在这里维护；点「保存勾选」才写回后端。 */
  const checked = new Set()
  /** 测试过的服务工具清单：name → tools[]。 */
  const tools = new Map()
  /** 最近一次测试失败的原因：name → message（Studio 原生卡片也在卡片里显示这一行）。 */
  const errors = new Map()
  /** 测试中的服务名。 */
  const testing = new Set()
  let filter = ''
  let editor = null
  let busy = false

  function setAlert(message) {
    alert.textContent = message || ''
    alert.style.display = message ? '' : 'none'
  }

  function setStatus(message, level) {
    status.textContent = message || ''
    status.className = level === 'error' ? 'deva-status error' : 'deva-status'
  }

  function refreshSummary() {
    totalValue.textContent = String(servers.length)
    enabledValue.textContent = String(servers.filter(server => server.enabled !== false).length)
    managedValue.textContent = String(servers.filter(server => server.managed).length)
    let toolCount = 0
    for (const list of tools.values()) toolCount += list.length
    toolsValue.textContent = String(toolCount)
    selectionInfo.textContent = format(text.selectionCount, { count: checked.size })
  }

  function visibleServers() {
    const needle = filter.trim().toLowerCase()
    if (!needle) return servers
    return servers.filter(server => server.name.toLowerCase().includes(needle)
      || String(server.transport || 'stdio').toLowerCase().includes(needle)
      || (server.managed ? 'studio' : '').includes(needle))
  }

  function render() {
    grid.innerHTML = ''
    refreshSummary()
    if (!servers.length) {
      grid.append(el('div', 'deva-empty', text.mcpNone))
      return
    }
    const visible = visibleServers()
    if (!visible.length) {
      grid.append(el('div', 'deva-empty', text.mcpNone))
      return
    }
    for (const server of visible) grid.append(renderCard(server))
  }

  function renderCard(server) {
    const disabled = server.enabled === false
    const failure = errors.get(server.name)
    const state = disabled ? 'off' : failure ? 'bad' : 'ok'
    const item = el('div', `deva-card${disabled ? ' off' : ''}${failure ? ' bad' : ''}`)

    const head = el('div', 'deva-card-head')
    head.append(el('h3', 'deva-name', server.name))

    // 徽章顺序与 Studio 原生卡片一致：传输方式、来源、连接状态
    const badges = el('div', 'deva-badges')
    const transport = String(server.transport || 'stdio')
    badges.append(el('span', 'deva-badge transport', transport === 'http' ? 'streamable_http' : transport))
    if (server.managed) badges.append(el('span', 'deva-badge context', text.summaryManaged))
    const stateLabel = disabled ? text.disabledStatus : failure ? text.disconnectedStatus : text.connectedStatus
    badges.append(el('span', `deva-badge ${state}`, stateLabel))
    head.append(badges)

    const body = el('div', 'deva-card-body')
    if (failure) {
      const row = el('div')
      row.append(el('span', 'deva-card-error', failure))
      body.append(row)
    }
    const known = tools.get(server.name)
    const count = Array.isArray(known) ? known.length : null
    const info = el('div', 'deva-info')
    info.append(
      el('span', 'deva-info-label', text.toolList),
      el('span', 'deva-info-value', count === null ? text.untested : format(text.toolCount, { count })),
    )
    body.append(info)
    if (Array.isArray(known) && known.length) {
      const list = el('div', 'deva-tools')
      for (const tool of known.slice(0, 20)) {
        const tag = el('span', 'deva-tool', String(tool?.name ?? ''))
        if (tool?.description) tag.title = String(tool.description)
        list.append(tag)
      }
      if (known.length > 20) {
        list.append(el('span', 'deva-tool more', format(text.moreTools, { count: known.length - 20 })))
      }
      body.append(list)
    } else {
      const empty = el('div', 'deva-tools-empty')
      empty.append(el('span', 'deva-muted', count === null ? text.untested : format(text.toolCount, { count: 0 })))
      body.append(empty)
    }

    const foot = el('div', 'deva-card-foot')
    const actions = el('div', 'deva-actions')
    const edit = button(text.edit, 'deva-btn ghost')
    const test = button(testing.has(server.name) ? text.testing : text.test, 'deva-btn ghost')
    const toggle = button(server.enabled ? text.disable : text.enable, 'deva-btn ghost')
    const remove = button(text.remove, 'deva-btn ghost')

    edit.onclick = () => openEditor(server.name, 'edit')
    test.onclick = () => runTest(server.name, test)
    toggle.onclick = () => toggleServer(server.name, !server.enabled, toggle)
    remove.onclick = () => removeServer(server.name, remove)
    actions.append(edit, test, toggle, remove)

    // Deva 独有：挑本 Agent 用哪些服务。Studio 卡片这个位置是启停开关，这里放勾选，保持一致的分区。
    const use = el('label', 'deva-use')
    const box = el('input', 'deva-check')
    box.type = 'checkbox'
    box.checked = checked.has(server.name)
    box.setAttribute?.('aria-label', `${text.useForAgent}: ${server.name}`)
    box.onchange = () => {
      if (box.checked) checked.add(server.name)
      else checked.delete(server.name)
      refreshSummary()
    }
    use.append(box, el('span', '', text.useForAgent))

    foot.append(actions, use)
    item.append(head, body, foot)
    return item
  }

  async function load({ note } = {}) {
    reload.disabled = true
    addButton.disabled = true
    setAlert('')
    try {
      const snapshot = await ctx.rpc.call('get-mcp-servers')
      servers = Array.isArray(snapshot?.servers) ? snapshot.servers : []
      const selected = Array.isArray(snapshot?.selected) ? snapshot.selected : []
      const available = new Set(servers.map(server => server.name))
      checked.clear()
      for (const name of selected) checked.add(name)
      for (const name of [...tools.keys()]) if (!available.has(name)) tools.delete(name)
      for (const name of [...errors.keys()]) if (!available.has(name)) errors.delete(name)
      render()
      // 已选但 Studio 里没有的服务：如实提示，运行时也会在提示词里点名，不静默丢弃。
      const gone = selected.filter(name => !available.has(name))
      const notes = []
      if (note) notes.push(note)
      if (gone.length) notes.push(`${text.mcpGone}: ${gone.join('、')}`)
      if (!selected.length && servers.length) notes.push(text.mcpEmpty)
      setStatus(notes.join('；'))
    } catch (error) {
      servers = []
      grid.innerHTML = ''
      refreshSummary()
      setAlert(errorText(error))
      setStatus('')
    } finally {
      reload.disabled = false
      addButton.disabled = false
    }
  }

  async function withBusy(target, run) {
    if (busy) return
    busy = true
    target.disabled = true
    try {
      await run()
    } finally {
      busy = false
      target.disabled = false
    }
  }

  async function runTest(name, target) {
    testing.add(name)
    errors.delete(name)
    await withBusy(target, async () => {
      render()
      try {
        const result = await ctx.rpc.call('test-mcp-server', { name })
        const list = Array.isArray(result?.tools) ? result.tools : []
        tools.set(name, list)
        testing.delete(name)
        render()
        const message = format(text.testSuccess, { count: list.length })
        setStatus(message)
        ctx.ui.notify(message, 'success')
      } catch (error) {
        testing.delete(name)
        errors.set(name, errorText(error))
        render()
        const message = `${text.testFailed}: ${errorText(error)}`
        setStatus(message, 'error')
        ctx.ui.notify(message, 'error')
      }
    })
  }

  async function toggleServer(name, enabled, target) {
    await withBusy(target, async () => {
      try {
        await ctx.rpc.call('set-mcp-server-enabled', { name, enabled })
        await load()
      } catch (error) {
        setStatus(errorText(error), 'error')
        ctx.ui.notify(errorText(error), 'error')
      }
    })
  }

  async function removeServer(name, target) {
    if (typeof ctx.ui?.confirm === 'function') {
      const ok = await ctx.ui.confirm(format(text.confirmRemove, { name }))
      if (!ok) return
    }
    await withBusy(target, async () => {
      try {
        await ctx.rpc.call('delete-mcp-server', { name })
        checked.delete(name)
        tools.delete(name)
        errors.delete(name)
        await load()
      } catch (error) {
        setStatus(errorText(error), 'error')
        ctx.ui.notify(errorText(error), 'error')
      }
    })
  }

  async function openEditor(name, mode) {
    let config = {}
    if (mode === 'edit') {
      try {
        const result = await ctx.rpc.call('get-mcp-server', { name })
        config = result?.config && typeof result.config === 'object' ? result.config : {}
      } catch (error) {
        setStatus(errorText(error), 'error')
        ctx.ui.notify(errorText(error), 'error')
        return
      }
    }
    editor = { mode, name, config }
    renderEditor()
  }

  function closeEditor() {
    editor = null
    modalHost.innerHTML = ''
  }

  function renderEditor() {
    modalHost.innerHTML = ''
    if (!editor) return
    const { mode, name, config } = editor

    const overlay = el('div', 'deva-overlay')
    const modal = el('div', 'deva-modal')
    modal.append(el('h3', '', mode === 'edit' ? text.editTitle : text.addTitle))

    const area = el('textarea', 'deva-textarea')
    area.rows = 16
    area.spellcheck = false
    area.value = mode === 'edit' ? prettyConfig(name, config) : NEW_CONFIG_TEMPLATE
    area.oninput = () => {
      area.className = 'deva-textarea'
      formStatus.textContent = ''
    }

    const formStatus = el('div', 'deva-status error')
    const hint = el('div', 'deva-muted', text.configHint)

    const cancel = button(text.cancel, 'deva-btn')
    const save = button(text.saveAction, 'deva-btn primary')
    cancel.onclick = () => closeEditor()

    save.onclick = () => withBusy(save, async () => {
      let entries
      try {
        entries = parseConfigs(area.value, text)
      } catch (error) {
        area.className = 'deva-textarea invalid'
        formStatus.textContent = errorText(error)
        return
      }
      formStatus.textContent = ''
      try {
        if (mode === 'edit') {
          const next = entries.find(([key]) => key === name)?.[1] ?? entries[0][1]
          await ctx.rpc.call('update-mcp-server', { name, config: next })
        } else {
          for (const [serverName, serverConfig] of entries) {
            await ctx.rpc.call('create-mcp-server', { name: serverName.trim(), config: serverConfig })
          }
        }
        closeEditor()
        await load()
        setStatus(text.saved)
      } catch (error) {
        formStatus.textContent = errorText(error)
        ctx.ui.notify(errorText(error), 'error')
      }
    })

    const foot = el('div', 'deva-modal-foot')
    foot.append(cancel, save)
    modal.append(area, formStatus, hint, foot)
    overlay.append(modal)
    modalHost.append(overlay)
  }

  search.oninput = () => {
    filter = search.value
    render()
  }
  addButton.onclick = () => openEditor('', 'create')
  reload.onclick = () => load()

  saveSelection.onclick = async () => {
    await withBusy(saveSelection, async () => {
      try {
        const result = await ctx.rpc.call('save-mcp-selection', { servers: [...checked] })
        const count = Array.isArray(result?.selected) ? result.selected.length : checked.size
        const message = format(text.savedSelection, { count })
        setStatus(message)
        ctx.ui.notify(message, 'success')
      } catch (error) {
        setStatus(errorText(error), 'error')
        ctx.ui.notify(errorText(error), 'error')
      }
    })
  }

  await load()
}
