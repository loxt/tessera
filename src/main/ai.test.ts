import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cancelAi, runAi } from './ai'

const fake = resolve(__dirname, '../../e2e/fake-claude.sh')
const dir = mkdtempSync(join(tmpdir(), 'tessera-ai-'))
const script = (name: string, body: string) => {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

afterEach(() => {
  delete process.env.TESSERA_CLAUDE_PATH
})

describe('runAi', () => {
  it('streams the answer and returns the final result', async () => {
    process.env.TESSERA_CLAUDE_PATH = fake
    const pieces: string[] = []
    const res = await runAi('t1', 'system', 'question', (t) => pieces.push(t))
    expect(res.ok).toBe(true)
    expect(res.text).toContain("select count(*) from orders where status = 'paid';")
    expect(pieces.join('')).toContain('Counting the paid orders')
    expect(res.costUsd).toBe(0.0012)
  })

  it('survives a CLI that exits before reading its input (no EPIPE crash)', async () => {
    process.env.TESSERA_CLAUDE_PATH = script('exits', 'exit 3')
    const res = await runAi('t2', 'system', 'x'.repeat(300_000), () => undefined)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exited with code 3/)
  })

  it('stops a process that writes far more than an answer', async () => {
    process.env.TESSERA_CLAUDE_PATH = script('flood', 'cat > /dev/null; yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | tr -d "\\n"')
    const res = await runAi('t3', 'system', 'q', () => undefined)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/more than an answer/)
  })

  it('refuses a request id that is already running, and honours a cancel', async () => {
    process.env.TESSERA_CLAUDE_PATH = script('slow', 'cat > /dev/null; sleep 30')
    const first = runAi('t4', 'system', 'q', () => undefined)
    expect((await runAi('t4', 'system', 'q', () => undefined)).error).toMatch(/already running/)
    await new Promise((r) => setTimeout(r, 200))
    cancelAi('t4')
    expect((await first).error).toMatch(/cancelled/)
  })

  it('caps how many questions run at once', async () => {
    process.env.TESSERA_CLAUDE_PATH = script('slow2', 'cat > /dev/null; sleep 30')
    const busy = ['c1', 'c2', 'c3'].map((id) => runAi(id, 's', 'q', () => undefined))
    await new Promise((r) => setTimeout(r, 100))
    expect((await runAi('c4', 's', 'q', () => undefined)).error).toMatch(/already answering 3/)
    ;['c1', 'c2', 'c3'].forEach(cancelAi)
    await Promise.all(busy)
  })

  it('ignores a custom path that is not named claude or sits in a world-writable folder', async () => {
    process.env.TESSERA_CLAUDE_PATH = fake
    const evil = script('claude', 'echo pwned; exit 0')
    chmodSync(dir, 0o777)
    const res = await runAi('t5', 's', 'q', () => undefined, evil)
    chmodSync(dir, 0o755)
    expect(res.text).toContain('Counting the paid orders') // fell back to the trusted one
  })
})
