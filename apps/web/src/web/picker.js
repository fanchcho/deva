/**
 * Web 版目录选择器。
 *
 * 浏览器没有系统目录对话框，主进程里的 dialog.showOpenDialog 由 worker shim
 * 转成一次 /api/dir-pick 请求；服务端通过 SSE 把请求推到这里，用户选完目录后
 * 回传，worker 拿到路径再走原来的 trustRoot 流程。
 *
 * 只在页面里加一个受控的目录浏览弹层，不改动原 renderer 的任何业务代码。
 */
;(function () {
  'use strict'

  var rootEl = null
  var titleEl = null
  var rootsEl = null
  var pathEl = null
  var listEl = null
  var hintEl = null
  var upBtn = null
  var okBtn = null
  var cancelBtn = null
  var pick = null
  var state = { path: '', parent: null, roots: [], entries: [] }
  var busy = false

  // 跟随应用语言：配置里的 locale 优先，其次页面 lang / 系统语言；只有明确英文才用英文文案。
  var zh = (function () {
    var configured = window.__DEVA_CONFIG__ && window.__DEVA_CONFIG__.locale
    var locale = String(
      configured || document.documentElement.lang || navigator.language || 'zh'
    ).toLowerCase()
    return locale.indexOf('en') !== 0
  })()
  var T = zh
    ? {
        title: '选择文件夹',
        workspace: '我的工作区',
        cancel: '取消',
        ok: '选择此文件夹',
        up: '上一级',
        loading: '加载中…',
        applying: '正在应用…',
        empty: '这里是空目录',
        hint: '路径栏可直接编辑：输入不存在的文件夹后点「选择此文件夹」，会自动创建并挂载。',
        pathEmpty: '路径不能为空',
        close: '关闭'
      }
    : {
        title: 'Choose folder',
        workspace: 'My workspace',
        cancel: 'Cancel',
        ok: 'Use this folder',
        up: 'Up',
        loading: 'Loading…',
        applying: 'Applying…',
        empty: 'This folder is empty',
        hint: 'The path box is editable: type a folder and choose “Use this folder” — it is created if missing.',
        pathEmpty: 'Path cannot be empty',
        close: 'Close'
      }

  function csrf() {
    return window.__DEVA_CSRF__ || ''
  }

  function baseName(p) {
    var clean = String(p || '').replace(/\/+$/, '')
    if (!clean) return '/'
    var i = clean.lastIndexOf('/')
    return i < 0 ? clean : clean.slice(i + 1) || '/'
  }

  function build() {
    if (rootEl) return
    rootEl = document.createElement('div')
    rootEl.className = 'deva-picker'
    rootEl.id = 'deva-picker'
    rootEl.hidden = true
    rootEl.innerHTML =
      '<div class="deva-picker__backdrop"></div>' +
      '<div class="deva-picker__card" role="dialog" aria-modal="true" aria-labelledby="deva-picker-title">' +
      '<header class="deva-picker__head">' +
      '<h2 id="deva-picker-title"></h2>' +
      '<button type="button" class="deva-picker__close" data-act="cancel">×</button>' +
      '</header>' +
      '<div class="deva-picker__roots" id="deva-picker-roots"></div>' +
      '<div class="deva-picker__bar">' +
      '<button type="button" class="deva-picker__up" data-act="up">↑</button>' +
      '<input type="text" class="deva-picker__path" id="deva-picker-path" autocomplete="off" spellcheck="false" />' +
      '</div>' +
      '<div class="deva-picker__list" id="deva-picker-list" role="list"></div>' +
      '<p class="deva-picker__hint" id="deva-picker-hint"></p>' +
      '<footer class="deva-picker__foot">' +
      '<button type="button" class="deva-picker__btn" data-act="cancel"></button>' +
      '<button type="button" class="deva-picker__btn deva-picker__btn--primary" data-act="ok"></button>' +
      '</footer>' +
      '</div>'
    document.body.appendChild(rootEl)

    titleEl = rootEl.querySelector('.deva-picker__head h2')
    rootsEl = document.getElementById('deva-picker-roots')
    pathEl = document.getElementById('deva-picker-path')
    listEl = document.getElementById('deva-picker-list')
    hintEl = document.getElementById('deva-picker-hint')
    upBtn = rootEl.querySelector('.deva-picker__up')
    okBtn = rootEl.querySelector('.deva-picker__btn--primary')
    cancelBtn = rootEl.querySelector('.deva-picker__foot .deva-picker__btn:not(.deva-picker__btn--primary)')

    titleEl.textContent = T.title
    rootEl.querySelector('.deva-picker__close').setAttribute('aria-label', T.close)
    upBtn.setAttribute('aria-label', T.up)
    upBtn.title = T.up
    cancelBtn.textContent = T.cancel
    okBtn.textContent = T.ok

    rootEl.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return
      if (target.classList.contains('deva-picker__backdrop')) {
        cancel()
        return
      }
      var action = target.closest('[data-act]')
      if (!action) return
      var act = action.getAttribute('data-act')
      if (act === 'cancel') cancel()
      else if (act === 'ok') choose()
      else if (act === 'up' && state.parent) load(state.parent)
    })

    pathEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      choose()
    })

    document.addEventListener('keydown', function (event) {
      if (!rootEl || rootEl.hidden) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    })
  }

  function setHint(text, isError) {
    hintEl.textContent = text || ''
    hintEl.classList.toggle('is-error', Boolean(isError))
  }

  function setBusy(value) {
    busy = value
    okBtn.disabled = value
    cancelBtn.disabled = value
    pathEl.disabled = value
    upBtn.disabled = value || !state.parent
  }

  function renderRoots() {
    rootsEl.textContent = ''
    state.roots.forEach(function (root, index) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'deva-picker__root'
      btn.textContent = index === 0 ? T.workspace : baseName(root)
      btn.title = root
      if (state.path === root) btn.classList.add('is-active')
      btn.addEventListener('click', function () {
        load(root)
      })
      rootsEl.appendChild(btn)
    })
  }

  function render() {
    pathEl.value = state.path
    pathEl.title = state.path
    upBtn.disabled = busy || !state.parent
    listEl.textContent = ''
    if (state.parent) {
      var upRow = document.createElement('button')
      upRow.type = 'button'
      upRow.className = 'deva-picker__row deva-picker__row--up'
      upRow.setAttribute('role', 'listitem')
      var upIcon = document.createElement('span')
      upIcon.className = 'deva-picker__icon'
      upIcon.textContent = '↩'
      var upName = document.createElement('span')
      upName.className = 'deva-picker__name'
      upName.textContent = '..'
      upRow.appendChild(upIcon)
      upRow.appendChild(upName)
      upRow.title = state.parent
      upRow.addEventListener('click', function () {
        load(state.parent)
      })
      listEl.appendChild(upRow)
    }
    if (!state.entries.length) {
      var empty = document.createElement('p')
      empty.className = 'deva-picker__empty'
      empty.textContent = T.empty
      listEl.appendChild(empty)
    }
    state.entries.forEach(function (entry) {
      var row = document.createElement('button')
      row.type = 'button'
      row.className = 'deva-picker__row'
      row.setAttribute('role', 'listitem')
      var icon = document.createElement('span')
      icon.className = 'deva-picker__icon'
      icon.textContent = '📁'
      var name = document.createElement('span')
      name.className = 'deva-picker__name'
      name.textContent = entry.name
      row.appendChild(icon)
      row.appendChild(name)
      row.title = entry.path
      row.addEventListener('click', function () {
        load(entry.path)
      })
      listEl.appendChild(row)
    })
    rootsEl.querySelectorAll('.deva-picker__root').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.title === state.path)
    })
  }

  function load(dirPath) {
    if (!pick) return
    setHint(T.loading)
    setBusy(true)
    fetch('/api/fs/list?path=' + encodeURIComponent(dirPath), { headers: { accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body }
        })
      })
      .then(function (result) {
        if (!result.body || !result.body.ok) {
          throw new Error((result.body && result.body.error) || '无法读取目录')
        }
        state.path = result.body.path
        state.parent = result.body.parent
        state.roots = result.body.roots || []
        state.entries = result.body.entries || []
        render()
        setHint(T.hint)
        setBusy(false)
        okBtn.focus()
      })
      .catch(function (error) {
        setHint(String((error && error.message) || error), true)
        setBusy(false)
      })
  }

  function post(body) {
    return fetch('/api/dir-pick/' + encodeURIComponent(pick.id), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-deva-csrf': csrf()
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.error || '选择失败')
        return data
      })
    })
  }

  function choose() {
    if (!pick || busy) return
    var value = String(pathEl.value || '').trim()
    if (!value) {
      setHint(T.pathEmpty, true)
      pathEl.focus()
      return
    }
    var target = value.charAt(0) === '/'
      ? value
      : (state.path === '/' ? '' : state.path) + '/' + value
    setBusy(true)
    setHint(T.applying)
    post({ path: target, create: true })
      .then(function () {
        hide()
      })
      .catch(function (error) {
        setHint(String((error && error.message) || error), true)
        pathEl.disabled = false
        setBusy(false)
      })
  }

  function cancel() {
    if (!pick || busy) return
    setBusy(true)
    post({ canceled: true })
      .catch(function () {
        /* 服务端已超时也算取消 */
      })
      .then(function () {
        hide()
      })
  }

  function hide() {
    if (!rootEl) return
    rootEl.hidden = true
    document.documentElement.classList.remove('deva-picker-open')
    pick = null
    busy = false
    state = { path: '', parent: null, roots: [], entries: [] }
    listEl.textContent = ''
    rootsEl.textContent = ''
  }

  function show(payload) {
    if (!payload || !payload.id) return
    if (!rootEl) build()
    if (pick && pick.id === payload.id && !rootEl.hidden) return
    pick = payload
    state = { path: '', parent: null, roots: payload.roots || [], entries: [] }
    titleEl.textContent = T.title
    rootEl.hidden = false
    document.documentElement.classList.add('deva-picker-open')
    renderRoots()
    listEl.textContent = ''
    setHint('')
    setBusy(false)
    load((payload.roots && payload.roots[0]) || '')
  }

  function poll() {
    if (!rootEl || rootEl.hidden) {
      fetch('/api/dir-pick/pending', { headers: { accept: 'application/json' } })
        .then(function (res) {
          return res.json()
        })
        .then(function (body) {
          if (body && body.ok && body.picks && body.picks.length) show(body.picks[0])
        })
        .catch(function () {
          /* 未登录 / 网络抖动忽略 */
        })
    }
    setTimeout(poll, 4000)
  }

  function connect() {
    if (typeof EventSource === 'undefined') return
    var source = new EventSource('/api/events')
    source.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data)
        if (msg && msg.channel === 'deva:dir-pick') show(msg.payload)
      } catch {
        /* 其他通道的事件忽略 */
      }
    }
  }

  function start() {
    build()
    connect()
    poll()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
