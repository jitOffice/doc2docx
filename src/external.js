/**
 * 外部可执行文件的调用机制：临时工作目录 + 子进程。
 *
 * 之所以独立成文件：将来若改为纯 TypeScript 实现（另发一个同 API 的包），
 * 那个实现不需要落盘也不需要子进程，本文件整体删除即可，index.js 的对外契约不变。
 */
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_TIMEOUT_MS = Number(process.env.DOC2DOCX_TIMEOUT_MS || 120000)

/** 建临时目录跑 fn，无论成败都清理。 */
async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    try { await fs.rm(dir, { recursive: true, force: true }) } catch (_) {}
  }
}

/**
 * 调用外部可执行文件。
 *
 * 关键：**退出码既不是失败的充分条件，也不是必要条件**。doc2x 捕获全部异常后仍以 0
 * 退出，且失败时会留下"包头已建、正文残缺"的产物。因此这里只回传执行结果，
 * 判定（自报错误行 + 产物有效性）交给调用方。
 */
function runBinary(file, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          error: error || null,
          killed: Boolean(error && (error.killed || error.signal)),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

/**
 * 在目录中取回产物：按候选扩展名找出新增文件并读入。
 * 产物名不可完全预知（含宏文档会输出 .docm），故按扩展名扫描而非拼死文件名。
 */
async function readProduced(dir, extensions, exclude = []) {
  const entries = await fs.readdir(dir)
  const skip = new Set(exclude.map((n) => n.toLowerCase()))
  for (const name of entries) {
    if (skip.has(name.toLowerCase())) continue
    if (!extensions.some((ext) => name.toLowerCase().endsWith(ext))) continue
    const full = path.join(dir, name)
    const stat = await fs.stat(full).catch(() => null)
    if (stat && stat.isFile() && stat.size > 0) {
      return { buffer: await fs.readFile(full), name }
    }
  }
  return null
}

/** 汇总子进程输出，供失败时拼装可读的错误信息。 */
function describeFailure(result, limit = 400) {
  if (result.killed) return `转换进程超时被终止（上限 ${DEFAULT_TIMEOUT_MS}ms）`
  const lines = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const flagged = lines.filter((l) => /\[E\]|error|fail|exception/i.test(l))
  const picked = (flagged.length ? flagged : lines).slice(-4).join('; ')
  return picked.slice(0, limit) || '转换器未产出文件且未给出错误信息'
}

module.exports = { DEFAULT_TIMEOUT_MS, withTempDir, runBinary, readProduced, describeFailure }
