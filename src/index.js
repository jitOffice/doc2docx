/**
 * doc2docx —— 把 Word 97-2003 二进制格式（.doc）转换为 OOXML（.docx）。
 *
 * 定位：**只做格式转换，不做语义解析**。产出的是标准 .docx 字节流，交给任意
 * docx 解析器/编辑器继续处理。之所以以 .docx 为交付物而非某种私有中间结构：
 * 一是可被 Word / LibreOffice 等第三方独立验证，出问题能隔离到是"转换错了"
 * 还是"解析错了"；二是任何项目都能直接消费。
 *
 * 实现：内部调用 b2xtranslator 编译出的自包含可执行文件（C#/.NET，BSD-3）。
 * 将来若有纯 TypeScript 实现，会以**相同的 API 另发一个包**，使用方换个 import 即可。
 */
const { performance } = require('node:perf_hooks')
const path = require('node:path')
const fs = require('node:fs/promises')
const { resolveBinary } = require('./resolve')
const {
  DEFAULT_TIMEOUT_MS, withTempDir, runBinary, readProduced, describeFailure,
} = require('./external')

// OLE2/CFB 复合文档魔数；.doc 是 CFB 容器。
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
// ZIP 本地文件头；.docx(OOXML) 是 ZIP 包。
const ZIP_MAGIC = Buffer.from([0x50, 0x4b])

/** CFB 目录项名以 UTF-16LE 存储，直接在前缀字节里嗅探已知流名即可判型，无需完整解析 CFB。 */
function containsUtf16LeAscii(bytes, ascii) {
  const limit = bytes.length - ascii.length * 2
  for (let i = 0; i <= limit; i += 1) {
    let matched = true
    for (let j = 0; j < ascii.length; j += 1) {
      if (bytes[i + j * 2] !== ascii.charCodeAt(j) || bytes[i + j * 2 + 1] !== 0) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/** 判定输入到底是什么；返回 'docx' 表示其实已经是 OOXML，可直接透传。 */
function classifyInput(buffer) {
  if (buffer.length < 8) throw new Error('文件内容为空或过短，无法识别格式')
  if (buffer.subarray(0, 2).equals(ZIP_MAGIC)) return 'docx'
  if (!buffer.subarray(0, 8).equals(CFB_MAGIC)) {
    throw new Error('该文件既不是 .doc（OLE 复合文档）也不是 .docx（OOXML），请确认文件未损坏')
  }
  // 在整个缓冲区里找，而不是只看开头一段：CFB 的目录区（流名所在处）位置由文件头
  // 0x30 的首目录扇区指针决定，可以落在文件任何位置，并非总在开头。此处曾只嗅探前
  // 256KB，导致目录区靠后的正常 .doc 被误判——实测一份 10.16MB 的 Word 97 文档，
  // 目录区在 5.73MB 处，WordDocument 流确实存在却扫不到，直接报"不是 Word 文档"；
  // 同样的原因也让 EncryptedPackage 检测对这类文件失效。
  //
  // 不改成"按指针定位目录"是因为目录流可经 FAT 链散布在文件各处（含指针之前），
  // 逐链解析要连带处理 DIFAT，复杂度远超这里的判型需求。整段线性扫描则不可能漏：
  // 流名若存在就一定在缓冲区内。代价是一次 O(n) 扫描，相对后续转换耗时可忽略；
  // 且误差方向安全——最坏是放行给转换器，由它给出准确报错，不会误拦正常文档。
  const sniff = buffer
  if (containsUtf16LeAscii(sniff, 'EncryptedPackage')) {
    throw new Error('该文件受密码保护／已加密，无法解析。请先去除密码')
  }
  if (!containsUtf16LeAscii(sniff, 'WordDocument')) {
    throw new Error('该文件是旧版 Office 二进制文档，但不是 Word 文档（未找到 WordDocument 流）')
  }
  return 'doc'
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(input)
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  throw new TypeError('convertDocToDocx 需要 Buffer / Uint8Array / ArrayBuffer 输入')
}

/**
 * 把 .doc 转换为 .docx。
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} input  .doc 二进制内容
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ buffer: Buffer, durationMs: number, passthrough: boolean }>}
 *   passthrough 为 true 表示输入本来就是 .docx（扩展名写错的情形很常见），原样返回。
 */
async function convertDocToDocx(input, options = {}) {
  const buffer = toBuffer(input)
  const kind = classifyInput(buffer)
  if (kind === 'docx') {
    return { buffer, durationMs: 0, passthrough: true }
  }

  const startedAt = performance.now()
  const bin = resolveBinary()
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS

  const produced = await withTempDir('doc2x-', async (dir) => {
    const inputPath = path.join(dir, 'input.doc')
    await fs.writeFile(inputPath, buffer)

    const result = await runBinary(bin, [inputPath], { timeoutMs, cwd: dir })

    // doc2x 捕获全部异常后仍以 0 退出，且失败时会留下"包头已建、正文残缺"的产物，
    // 所以退出码和"产物存在且非空"都不足以判定成功。转换路径上的 [E] 行只由它的
    // 顶层 catch 分支产生，是可靠的失败信号。
    if (/\[E\]/.test(result.stdout + result.stderr)) {
      throw new Error(`doc2x 转换失败：${describeFailure(result)}`)
    }
    // 含宏文档会被判定为 .docm，故两种扩展名都收。
    const out = await readProduced(dir, ['.docx', '.docm'], ['input.doc'])
    if (!out) throw new Error(`doc2x 未产出文件：${describeFailure(result)}`)
    return out.buffer
  })

  if (!produced.subarray(0, 2).equals(ZIP_MAGIC)) {
    throw new Error('转换产物不是有效的 .docx（OOXML/ZIP）包')
  }
  // 结构底线：产物可能"包结构成立但主文档缺失"。ZIP 把成员文件名以明文存在
  // 本地头与中央目录里，直接扫字节即可判定，无需解压。
  if (!produced.includes('word/document.xml')) {
    throw new Error('转换产物缺少主文档部件 word/document.xml')
  }

  return {
    buffer: produced,
    durationMs: Math.round(performance.now() - startedAt),
    passthrough: false,
  }
}

module.exports = { convertDocToDocx }
module.exports.default = module.exports
