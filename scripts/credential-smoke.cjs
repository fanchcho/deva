// Manual real-OS test; synthetic value only, no credential is written to disk.
const { app, safeStorage } = require('electron')
app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential store unavailable')
  const value = 'deva-synthetic-credential-smoke'
  if (safeStorage.decryptString(safeStorage.encryptString(value)) !== value) throw new Error('Credential round-trip failed')
  console.log(`Credential round-trip passed: ${process.platform}`)
  app.quit()
}).catch(error => { console.error(error.message); app.exit(1) })
