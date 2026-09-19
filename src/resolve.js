/**
 * 定位当前平台对应的 doc2x 可执行文件。
 *
 * 二进制按平台拆成独立的可选依赖包（doc2docx-<平台>），每个包用 package.json
 * 的 os/cpu 字段声明适用范围，npm/pnpm 安装时只会装匹配当前机器的那一个。这样
 * 使用方不会为用不到的架构下载几十 MB，也不需要 postinstall 联网下载——后者在
 * 内网/离线部署环境必然失败。
 */
const fs = require('node:fs')
const path = require('node:path')

const PLATFORM_PACKAGES = {
  'linux-x64': '@jitword/doc2docx-linux-x64',
  'linux-arm64': '@jitword/doc2docx-linux-arm64',
  'win32-x64': '@jitword/doc2docx-win32-x64',
  'darwin-arm64': '@jitword/doc2docx-darwin-arm64',
  'darwin-x64': '@jitword/doc2docx-darwin-x64',
}

function platformKey() {
  return `${process.platform}-${process.arch}`
}

/**
 * npm 不保证为普通文件保留可执行位（尤其在 Windows 上打包、Linux 上安装时），
 * 所以运行前检查一次，缺了就补。这是同类原生包的通行做法。
 */
function ensureExecutable(file) {
  if (process.platform === 'win32') return
  try {
    fs.accessSync(file, fs.constants.X_OK)
  } catch {
    try {
      fs.chmodSync(file, 0o755)
    } catch (e) {
      throw new Error(
        `doc2x 可执行文件缺少执行权限且无法自动补齐：${file}（${e.message}）。` +
        `若安装目录为只读，请手动 chmod +x。`,
      )
    }
  }
}

/** 返回当前平台 doc2x 可执行文件的绝对路径；找不到时抛出可操作的错误。 */
function resolveBinary() {
  const explicit = process.env.DOC2DOCX_PATH
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`DOC2DOCX_PATH 指向的文件不存在：${explicit}`)
    }
    ensureExecutable(explicit)
    return explicit
  }

  const key = platformKey()
  const pkg = PLATFORM_PACKAGES[key]
  if (!pkg) {
    throw new Error(
      `doc2x 尚未提供 ${key} 平台的二进制。已支持：${Object.keys(PLATFORM_PACKAGES).join(' / ')}。` +
      `也可用 DOC2DOCX_PATH 指定自建产物。`,
    )
  }

  let pkgJson
  try {
    // 解析 package.json 而不是直接解析二进制：后者会受包的 exports 字段限制，
    // 前者是同类原生包普遍采用的稳定做法。
    pkgJson = require.resolve(`${pkg}/package.json`)
  } catch {
    throw new Error(
      `未安装 ${pkg}。它是 doc2docx 的可选依赖，正常情况下会随安装自动获取；` +
      `若使用了 --no-optional 或离线环境缺包，请单独安装，或用 DOC2DOCX_PATH 指定路径。`,
    )
  }

  const exe = path.join(path.dirname(pkgJson), 'bin', key.startsWith('win32') ? 'doc2x.exe' : 'doc2x')
  if (!fs.existsSync(exe)) {
    throw new Error(`${pkg} 已安装但缺少可执行文件：${exe}`)
  }
  ensureExecutable(exe)
  return exe
}

module.exports = { resolveBinary, platformKey, PLATFORM_PACKAGES }
