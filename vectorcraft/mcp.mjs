import { spawn } from 'node:child_process'

/** One explicitly headless, file-confined process. Never attaches to a desktop app. */
export class VectorcraftMcp {
  constructor(executable, directory, signal) {
    signal?.throwIfAborted()
    this.pending = new Map()
    this.sequence = 0
    this.buffer = ''
    this.error = null
    this.child = spawn(
      executable,
      [
        'mcp',
        '--headless',
        '--automation-read-root',
        directory,
        '--automation-write-root',
        directory,
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          VECTORCRAFT_NO_PREFS: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
    this.closed = new Promise((resolve) => {
      this.child.once('close', resolve)
      this.child.once('error', resolve)
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk
      if (this.buffer.length > 8 * 1024 * 1024)
        return this.stop(new Error('工具返回的数据过多，请缩小这次处理。'))
      let newline
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (!line.trim()) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          this.stop(new Error('工具连接返回格式有误。'))
          return
        }
        const row = this.pending.get(message.id)
        if (!row) continue
        this.pending.delete(message.id)
        if (message.error) row.reject(new Error(String(message.error.message || '工具请求失败。')))
        else row.resolve(message.result)
      }
    })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => this.stop(new Error('工具连接已关闭。')))
    this.child.on('error', () => this.stop(new Error('VectorCraft 未能启动，请先准备好本地 CLI。')))
    this.child.on('close', () => this.fail(new Error('VectorCraft 连接已结束。')))
    this.signal = signal
    this.abort = () => this.stop(new Error('已取消这次工具查找或计算。'))
    signal?.addEventListener('abort', this.abort, { once: true })
    this.timer = setTimeout(
      () => this.stop(new Error('工具计算时间较长，请换一种更简单的处理。')),
      60000
    )
  }
  fail(error) {
    this.error ??= error
    for (const row of this.pending.values()) row.reject(this.error)
    this.pending.clear()
  }
  stop(error) {
    this.fail(error)
    this.child.kill('SIGTERM')
    this.force ??= setTimeout(() => this.child.kill('SIGKILL'), 1200)
  }
  async request(method, params = {}) {
    if (this.error) throw this.error
    const id = ++this.sequence
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return promise
  }
  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'intent-tool-demo', version: '2' },
    })
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    )
    return this
  }
  async tool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args })
    const text =
      result.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n') || ''
    if (result.isError) throw new Error(text.slice(0, 1800) || '这个功能暂时没有运行成功。')
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  async command(command, params = {}) {
    return this.tool('run_command', { command, params })
  }
  async close() {
    clearTimeout(this.timer)
    this.signal?.removeEventListener('abort', this.abort)
    this.child.stdin.end()
    this.force ??= setTimeout(() => this.child.kill('SIGKILL'), 1200)
    await this.closed
    clearTimeout(this.force)
  }
}
