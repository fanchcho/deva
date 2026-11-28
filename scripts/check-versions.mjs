import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export function checkVersions(root) {
  const desktop=JSON.parse(readFileSync(path.join(root,'apps/desktop/package.json'),'utf8')).version
  const web=JSON.parse(readFileSync(path.join(root,'apps/web/package.json'),'utf8')).version
  if (typeof desktop!=='string'||!desktop||desktop!==web) throw new Error(`Version mismatch: desktop=${desktop}, web=${web}`)
  return desktop
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Versions aligned: ${checkVersions(fileURLToPath(new URL('../',import.meta.url)))}`)
}
