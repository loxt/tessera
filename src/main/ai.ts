// Runs the locally installed Claude Code headless (`claude -p`) with the user's own login: no API key in
// Tessera, no tools, no MCP servers, no user settings or hooks, no saved session. The prompt goes in on
// stdin; text deltas stream back to the renderer as they arrive.
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { AiResult, AiStatus } from '@shared/api'

const TIMEOUT_MS = 5 * 60_000
const MAX_PROMPT_CHARS = 400_000
/** an answer past this is not an answer; stop the process */
const MAX_OUTPUT_CHARS = 2_000_000
const MAX_CONCURRENT = 3
/** a process that ignores SIGTERM gets SIGKILL after this */
const KILL_GRACE_MS = 3000
/** streamed text is batched into one IPC message per interval */
const FLUSH_MS = 40

const executable = async (p: string) => {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The path in prefs is renderer-writable, so it only runs when it looks like an install: absolute, named
 * `claude`, and neither the file nor its folder writable by everyone (not something dropped in /tmp).
 */
async function trustedCustomPath(p: string | undefined): Promise<string | undefined> {
  if (!p || !isAbsolute(p) || basename(p) !== 'claude') return undefined
  try {
    const [file, dir] = await Promise.all([stat(p), stat(dirname(p))])
    const worldWritable = (m: number) => (m & 0o002) !== 0
    return file.isFile() && !worldWritable(file.mode) && !worldWritable(dir.mode) ? p : undefined
  } catch {
    return undefined
  }
}

/** A packaged app does not get the shell's PATH, so look where installers put `claude`, then ask a login shell. */
async function findClaude(preferred?: string): Promise<string | null> {
  const home = homedir()
  const custom = await trustedCustomPath(preferred)
  const candidates = [custom, process.env.TESSERA_CLAUDE_PATH, process.env.LATTICE_CLAUDE_PATH, join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(
    (p): p is string => !!p
  )
  for (const p of candidates) if (await executable(p)) return p
  return new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { timeout: 5000 }, (err, out) => {
      const p = out?.trim().split('\n').pop()
      resolve(!err && p && p.startsWith('/') && basename(p) === 'claude' ? p : null)
    })
  })
}

export async function aiStatus(preferred?: string): Promise<AiStatus> {
  const path = await findClaude(preferred)
  if (!path) return { available: false, error: 'Claude Code was not found. Install it (claude.com/claude-code) or set its path in Settings.' }
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: 10_000 }, (err, out) => {
      if (err) resolve({ available: false, path, error: `Claude Code did not start: ${err.message}` })
      else resolve({ available: true, path, version: out.trim() })
    })
  })
}

/** live requests; `cancelled` covers a cancel that arrives before the process exists */
const requests = new Map<string, { child?: ChildProcess; cancelled: boolean }>()

/** Signals the whole process group: the CLI's own children must not keep its output pipe open. */
function signal(child: ChildProcess, sig: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, sig)
    else child.kill(sig)
  } catch {
    child.kill(sig) // the group is already gone
  }
}

/** SIGTERM, then SIGKILL if the process is still there after a grace period. */
function stop(child: ChildProcess): void {
  signal(child, 'SIGTERM')
  setTimeout(() => child.exitCode === null && child.signalCode === null && signal(child, 'SIGKILL'), KILL_GRACE_MS).unref()
}

/** Ends every running question (the app is quitting; detached processes would outlive it). */
export function stopAllAi(): void {
  for (const r of requests.values()) {
    r.cancelled = true
    if (r.child) signal(r.child, 'SIGKILL')
  }
}

export function cancelAi(requestId: string): void {
  const r = requests.get(requestId)
  if (!r) return
  r.cancelled = true
  if (r.child) stop(r.child)
}

/** One question to Claude; `onText` receives each streamed piece of the answer. */
export async function runAi(requestId: string, system: string, user: string, onText: (delta: string) => void, preferred?: string): Promise<AiResult> {
  const started = Date.now()
  const fail = (error: string): AiResult => ({ ok: false, text: '', error, durationMs: Date.now() - started })
  if (requests.has(requestId)) return fail('This request is already running.')
  if (requests.size >= MAX_CONCURRENT) return fail(`Claude is already answering ${MAX_CONCURRENT} questions; wait for one to finish.`)
  if (user.length > MAX_PROMPT_CHARS) return fail('The request is too large to send.')
  const entry: { child?: ChildProcess; cancelled: boolean } = { cancelled: false }
  requests.set(requestId, entry)
  const path = await findClaude(preferred)
  if (!path || entry.cancelled) {
    requests.delete(requestId)
    return fail(entry.cancelled ? 'Cancelled.' : 'Claude Code was not found. Install it or set its path in Settings.')
  }

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--system-prompt', system
  ]
  const home = homedir()
  const env = { ...process.env, PATH: [process.env.PATH, join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':') }

  return new Promise<AiResult>((resolve) => {
    // its own process group, so stop() reaches whatever the CLI starts
    const child = spawn(path, args, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    entry.child = child
    let text = ''
    let buffered = ''
    let stderr = ''
    let final: AiResult | null = null
    let tooLong = false
    const timer = setTimeout(() => stop(child), TIMEOUT_MS)
    // deltas batched per FLUSH_MS, so a fast stream is not one IPC message per token
    let pending = ''
    let flushTimer: NodeJS.Timeout | null = null
    const flush = () => {
      flushTimer = null
      if (pending) onText(pending)
      pending = ''
    }

    const onLine = (line: string) => {
      if (!line.trim()) return
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        return // not an event line (CLI notices)
      }
      if (ev.type === 'stream_event') {
        const inner = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
          text += inner.delta.text
          pending += inner.delta.text
          flushTimer ??= setTimeout(flush, FLUSH_MS)
        }
      } else if (ev.type === 'result') {
        const ok = ev.subtype === 'success' && !ev.is_error
        final = {
          ok,
          text: typeof ev.result === 'string' && ev.result ? ev.result : text,
          error: ok ? undefined : typeof ev.result === 'string' && ev.result ? ev.result : `Claude Code stopped (${String(ev.subtype)})`,
          costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined,
          durationMs: Date.now() - started
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
      if (text.length + buffered.length > MAX_OUTPUT_CHARS && !tooLong) {
        tooLong = true
        stop(child)
        return
      }
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      lines.forEach(onLine)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)))
    child.on('error', (err) => {
      final = { ok: false, text, error: `Claude Code did not start: ${err.message}`, durationMs: Date.now() - started }
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (flushTimer) clearTimeout(flushTimer)
      flush()
      requests.delete(requestId)
      if (!tooLong) onLine(buffered)
      if (final && !tooLong) return resolve(final)
      const why = tooLong
        ? 'wrote more than an answer should and was stopped'
        : signal
          ? Date.now() - started >= TIMEOUT_MS
            ? 'took too long and was stopped'
            : 'was cancelled'
          : `exited with code ${code}`
      resolve({ ok: false, text, error: `Claude Code ${why}${stderr.trim() ? `: ${stderr.trim().split('\n').pop()}` : ''}`, durationMs: Date.now() - started })
    })
    // a CLI that exits before reading its input makes the write fail (EPIPE); the close handler reports it
    child.stdin.on('error', () => undefined)
    child.stdin.end(user)
  })
}
