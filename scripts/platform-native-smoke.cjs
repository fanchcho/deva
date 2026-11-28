// Run only on a real Windows/macOS host. All files and child processes are synthetic.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(root, '.tmp/full-scan-optimization/risks/platform/native-'))
app.setPath('userData', dir)
app.whenReady().then(async () => {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Real Windows/macOS required')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential store unavailable')
  const secret = 'deva-native-synthetic-value', file = path.join(dir, 'encrypted.bin')
  fs.writeFileSync(file, safeStorage.encryptString(secret), { mode: 0o600 })
  if (safeStorage.decryptString(fs.readFileSync(file)) !== secret) throw new Error('Credential disk round-trip failed')
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o777) !== 0o600) throw new Error('Private file mode failed')
  fs.renameSync(file, file + '.renamed')
  console.log('PASS credential read/write and private atomic rename')
  const requireDesktop = createRequire(path.join(root, 'apps/desktop/package.json'))
  const pty = requireDesktop('@lydell/node-pty')
  await new Promise((resolve, reject) => {
    const win = process.platform === 'win32'
    const proc = pty.spawn(win ? 'powershell.exe' : '/bin/sh', win ? ['-NoProfile', '-NonInteractive', '-Command', "Write-Output 'PTY_NATIVE_OK'"] : ['-c', 'printf PTY_NATIVE_OK'], { cwd: dir, env: { ...process.env }, cols: 80, rows: 24, name: 'xterm-256color' })
    let output = ''
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Native PTY timeout')) }, 15000)
    proc.onData(data => { output += data })
    proc.onExit(({ exitCode }) => {
      clearTimeout(timer)
      if (exitCode === 0 && output.includes('PTY_NATIVE_OK')) resolve()
      else reject(new Error(`Native PTY failed: exit ${exitCode}`))
    })
  })
  console.log(`PASS native PTY: ${process.platform}`)
  app.quit()
}).catch(error => { console.error(error.message); app.exit(1) })
