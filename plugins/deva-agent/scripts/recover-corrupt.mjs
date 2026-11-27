// Explicit offline recovery. Does not switch the configured root or alter the source.
import { readJsonFile, recoverCorruptFile } from '../lib/corrupt-files.mjs'
const [file, confirmation] = process.argv.slice(2)
if (!file || confirmation !== '--confirm') throw new Error('Usage: node scripts/recover-corrupt.mjs <file.json> --confirm')
try { readJsonFile(file) } catch (error) {
  if (!error.readOnly) throw error
}
console.log(JSON.stringify(recoverCorruptFile(file, true), null, 2))
