import { spawn, type ChildProcess } from 'node:child_process'

export interface MsysKillTarget {
  bash: string
  tag: string
}


/**
 * win + Git Bash 杀树脚本（另起一个 MSYS bash 执行，$1 = 目标 tag）。
 * MSYS 模拟 fork，管道成员之间的 Windows 父进程链是断的（中间层 bash 早已退出），taskkill /T 从启动器
 * 出发只杀得到启动器本身；npm / tail 等成了孤儿，继续攥着 stdout 管道——超时、中止都「杀了没用」。
 * 故 spawn 时注入唯一 DEVA_EXEC_TAG（子孙自然继承），此处扫 /proc/<pid>/environ **精确匹配**找回整棵树：
 * ① 按各进程 winpid 执行 taskkill /T /F，带走 node 等原生进程再 spawn 的原生子孙（那段 Windows 父链完整）；
 * ② 按 MSYS 进程组（管道成员同组）kill -9 并逐个补刀，兜住扫描之后才 fork 出来的。
 * pgid ≤ 1 不杀组（kill -- -1 等于杀全部）；taskkill 参数禁用 MSYS 路径转换（否则 /T 会被改写成路径）。
 */
const MSYS_KILL_SCRIPT = `tag="DEVA_EXEC_TAG=$1"
pids= pgs= wins=
for d in /proc/[0-9]*; do
  hit=
  while IFS= read -r -d '' e; do [ "$e" = "$tag" ] && { hit=1; break; }; done < "$d/environ"
  [ -n "$hit" ] || continue
  p=\${d#/proc/} pg= w=
  read -r pg < "$d/pgid"
  read -r w < "$d/winpid"
  pids="$pids $p" pgs="$pgs $pg" wins="$wins $w"
done 2>/dev/null
set --
for w in $wins; do case $w in *[!0-9]*) ;; *) set -- "$@" /PID "$w" ;; esac; done
[ $# -gt 0 ] && MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' taskkill /T /F "$@" >/dev/null 2>&1
for pg in $pgs; do case $pg in *[!0-9]*) ;; *) [ "$pg" -gt 1 ] && kill -9 -- "-$pg" ;; esac; done 2>/dev/null
for p in $pids; do kill -9 "$p"; done 2>/dev/null
exit 0`

/**
 * 杀掉子进程「整棵树」。posix 杀进程组（spawn 时 detached 建了组）；win 依次：
 * 有 msys 时先跑 MSYS_KILL_SCRIPT → taskkill /T /F 启动器 → 最后才 child.kill()。
 * 顺序不能反：先杀启动器会让其子进程的父链断掉，/T 就再也找不到它们（还会报「没有找到进程」）。
 */
export function killTree(child: ChildProcess, msys?: MsysKillTarget,
  { platform = process.platform, spawnProcess = spawn, killProcess = process.kill } = {}): void {
  const pid = child.pid
  if (!pid) return
  if (platform === 'win32') {
    const finalKill = (): void => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    let tkStarted = false
    const taskkill = (): void => {
      if (tkStarted) return // spawn 失败时 error 与 exit 可能先后都来
      tkStarted = true
      try {
        const tk = spawnProcess('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        tk.once('exit', finalKill)
        tk.once('error', finalKill)
      } catch {
        finalKill()
      }
    }
    if (!msys) {
      taskkill()
      return
    }
    try {
      const env = { ...process.env }
      delete env.DEVA_EXEC_TAG // 杀手自己绝不能带目标 tag
      const k = spawnProcess(
        msys.bash,
        ['--noprofile', '--norc', '-c', MSYS_KILL_SCRIPT, 'deva-kill', msys.tag],
        { env, windowsHide: true, stdio: 'ignore', timeout: 5000 }
      )
      k.once('exit', taskkill)
      k.once('error', taskkill)
    } catch {
      taskkill()
    }
  } else {
    try {
      killProcess(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }
}

