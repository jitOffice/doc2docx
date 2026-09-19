# @jitword/doc2docx

把 Word 97-2003 二进制文档（`.doc`）转换为 OOXML（`.docx`）。

> 来自 **[JitWord](https://jitword.com/)** 协同文档产品的 `.doc` 导入链路。

`.doc` 是 1997 年的二进制格式（[MS-DOC] 规范约 1200 页），与 `.docx` 完全不同源。
现代 JS 生态里的 docx 解析库一律只认 `.docx`，拿到 `.doc` 只会报错。本包补上前面那一跳。

## 安装

```bash
npm i @jitword/doc2docx
```

## 用法

```js
const fs = require('node:fs')
const { convertDocToDocx } = require('@jitword/doc2docx')

const docx = await convertDocToDocx(fs.readFileSync('合同.doc'))
fs.writeFileSync('合同.docx', docx.buffer)
```

进 Buffer、出 Buffer，没有别的概念。产出是标准 `.docx`，交给任意 docx 解析器
或编辑器继续处理即可。

```ts
convertDocToDocx(
  input: Buffer | Uint8Array | ArrayBuffer,
  options?: { timeoutMs?: number },
): Promise<{ buffer: Buffer; durationMs: number; passthrough: boolean }>
```

- 输入**本来就是 `.docx`**（扩展名写错是很常见的情形）时原样返回，`passthrough` 置为 `true`
- 输入不是 Word 二进制文档、或受密码保护时，抛出带可操作说明的错误

## 这个包额外做了什么

转换本身只是第一步。把它做成一个能放心用的依赖，下面这些是实际踩过并解决掉的：

**零宿主依赖，且更快**
早期产物依赖宿主的 ICU（`libicu`），缺库的机器直接跑不起来。根因是转换器里 18 处
`CultureInfo` 用法依赖宿主 ICU 数据：17 处只为让小数点是 `.`，已全部换成
`InvariantCulture`；1 处取语言标记的改用内置的 216 项静态映射表。改完得以启用
`InvariantGlobalization` 发布，目标机器**无需安装任何运行时**。副作用是转换实测
**快了 23~29%**（省掉 ICU 初始化：合同 0.261s→0.201s，公文 0.211s→0.150s），
且验证过改动前后产出的 docx 内容逐字节一致。

**按平台拆包，不下载用不到的架构**
二进制按平台拆成独立的可选依赖，npm 只会装匹配当前机器的那一份（约 34MB），
不会为五个架构都付带宽。**没有 postinstall 联网下载**——那在内网与离线部署环境必然失败。
npm 不保证保留文件的执行位，运行前会自动补齐。

**不信任退出码的失败判定**
转换器捕获异常后仍会以 0 退出，并留下"包头已建、正文残缺"的半成品。所以成功与否
不看退出码，而是三重校验：错误标记行、产物是合法 ZIP、包内确实含
`word/document.xml`。任何一项不过都按失败处理，不会把残缺文档交给下游。

**判型不受文件大小影响**
识别文件到底是不是 Word 二进制文档，需要在 CFB 容器里找 `WordDocument` 流名。
早期只扫描文件开头一段，而 CFB 的目录区位置由文件头指针决定、可以落在文件任何位置
——实测一份 10.16MB 的文档目录区在 5.73MB 处，正常文件被误判成"不是 Word 文档"。
现已改为全缓冲区扫描，判型与文件大小无关。

**进程级护栏**
转换在独立临时目录中进行，结束即清理；超时自动终止（默认 120s，可用
`DOC2DOCX_TIMEOUT_MS` 或 `options.timeoutMs` 调整），不会留下僵死进程或垃圾文件。

## 支持的平台

| 平台 | 包 |
| --- | --- |
| linux-x64 | `@jitword/doc2docx-linux-x64` |
| linux-arm64 | `@jitword/doc2docx-linux-arm64` |
| win32-x64 | `@jitword/doc2docx-win32-x64` |
| darwin-arm64（Apple Silicon） | `@jitword/doc2docx-darwin-arm64` |
| darwin-x64（Intel Mac） | `@jitword/doc2docx-darwin-x64` |

其它平台可自行构建后用环境变量 `DOC2DOCX_PATH` 指向可执行文件。

**仅限 Node.js**：内部调用原生可执行文件，无法在浏览器中运行。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `DOC2DOCX_PATH` | 指定自建的可执行文件路径，绕过平台包解析 |
| `DOC2DOCX_TIMEOUT_MS` | 单次转换超时上限，默认 `120000` |

## 实现与已知边界

内部调用一个自包含的原生可执行文件完成转换，目标机器无需安装任何运行时。
派生来源与版权声明见 `LICENSE`。

本转换器已应用于 [JitWord](https://jitword.com/) 的 `.doc` 导入链路，日常处理
公文、合同一类真实文档。但在本包的独立使用场景下**仍处于试验阶段**：语料验证
样本有限，接入生产前请先用自己的文档验证效果。

**已知缺口**：浮动（锚定）图片与艺术字当前可能会忽略，内联图片正常。复杂版式、
矢量图（EMF/WMF）尚未充分覆盖。

## 只是转换不够用？

本包解决的是**格式转换**这一跳。本项目是我们开发完整协同 Word 文档能力的
[JitWord](https://jitword.com/) 产品中的一个转换库，完整 JitWord 产品提供：

- **Word 级排版还原** —— 页眉页脚、分栏分节、文档网格、编号几何、表格列宽自适应
- **实时协同编辑** —— 多人同时编辑、版本历史、批注与修订
- **完整导入导出** —— docx 高精度导入导出，双向高保真
- **多文件解析 / 预览** —— PDF / OFD / Excel 预览，HTML / JSON / Markdown 等解析渲染
- **公文与签章** —— 公文排版规范、电子签章、模板与变量
- **私有化部署** —— 源码级交付，数据不出内网，支持信创环境

官网：**<https://jitword.com/>**

## 关于后续版本

若将来出现纯 TypeScript 的实现，会以**相同的 API 另发一个包**，使用方换个 import
即可切换，不需要改调用代码。

## 许可

本包（JavaScript 源码）以 **MIT** 发布，见 `LICENSE`。

本包不含二进制。原生转换器由各平台子包分发，以 **BSD-3-Clause** 授权，
完整版权与署名声明随对应平台包提供。
