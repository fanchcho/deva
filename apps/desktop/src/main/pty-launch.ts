import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { spawn as PtySpawn } from '@lydell/node-pty'

interface LaunchRequest { cwd: string | null; cols: number; rows: number; shellPath?: string; shellArgs?: string[] }
/** Native boundary: injectable without loading a native PTY in pure-logic platform tests. */
export function launchPty(request: LaunchRequest, {
  spawn, platform = process.platform, env = process.env, exists = existsSync, home = homedir
}: { spawn: typeof PtySpawn; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: typeof existsSync; home?: typeof homedir }): ReturnType<typeof PtySpawn> {
  const shell = platform === 'win32' ? 'powershell.exe' : env.SHELL || '/bin/bash'
  return spawn(request.shellPath || shell, request.shellArgs ?? [], {
    name: 'xterm-256color', cols: request.cols || 80, rows: request.rows || 24,
    cwd: request.cwd && exists(request.cwd) ? request.cwd : home(), env: { ...env }
  })
}
