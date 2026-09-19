export interface ConvertOptions {
  /** 单次转换超时（毫秒）。默认 120000，也可用环境变量 DOC2DOCX_TIMEOUT_MS 设置。 */
  timeoutMs?: number
}

export interface ConvertResult {
  /** 转换产出的 .docx 字节流。 */
  buffer: Buffer
  /** 转换耗时（毫秒）。passthrough 时为 0。 */
  durationMs: number
  /** 输入本身就是 .docx（扩展名写错的常见情形），未经转换原样返回。 */
  passthrough: boolean
}

/**
 * 把 Word 97-2003 二进制文档（.doc）转换为 OOXML（.docx）。
 *
 * 输入若已是 .docx 则原样返回并把 passthrough 置为 true。
 * 输入不是 Word 二进制文档、或受密码保护时抛出带可操作说明的错误。
 */
export declare function convertDocToDocx(
  input: Buffer | Uint8Array | ArrayBuffer,
  options?: ConvertOptions,
): Promise<ConvertResult>
