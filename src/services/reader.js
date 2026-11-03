// 大文件分块读取层。
//
// 为什么需要：设备 fs.readFile 只能全量读（无偏移参数），30MB 的书一次性读入
// 内存 + normalize 会卡住 UI 甚至 abort。而 shell 的 `split` 是 C 实现，把 30MB
// 按行切成 170 个 ~140KB 的小块只要 0.7s，之后按需读单块即可，内存恒定。
//
// 进度用「行号」记录（1-based），跨块定位精确、且与字号/分页设置无关，
// 天然适合"断点续读"。字符偏移不再作为进度单位。
//
// 依赖：设备 shell 有 `split` / `wc` / `rm` / `mkdir`（实测均有，busybox/coreutils）。

import { execShell, readText, readTextEx, writeText, removeFile, ensureAppDir, joinPath, shq, logLine, sleep } from './platform.js'

// 每块行数：5000 行 ≈ 140KB，读一块毫秒级，内存可忽略
const LINES_PER_CHUNK = 5000

// 书的元信息 + 分块状态
//   { path, name, totalLines, totalChars, chunkCount, chunkDir, chunkName }
//
// chunkName 是 split 的前缀（无扩展名），第 i 块文件名为 chunkName + i（4 位补零）。

function chunkDirFor(path) {
  // 用路径哈希做目录名，避免不同书互相覆盖；去掉路径里的特殊字符
  let h = 0
  const s = String(path || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff
  return joinPath(ensureAppDir(), 'chunks', 'bk' + h.toString(36))
}

function pad4(n) {
  let s = String(n)
  while (s.length < 4) s = '0' + s
  return s
}

function chunkPath(book, index) {
  const name = book.chunkName + pad4(index)
  return joinPath(book.chunkDir, name)
}

// 用 shell 统计行数（wc -l）。大文件 fs 全量读不现实，wc 是 C 实现快。
async function countLines(path) {
  const out = joinPath(ensureAppDir(), 'chunks', '_wc.txt')
  try {
    execShell('wc -l ' + shq(path) + ' > ' + shq(out) + ' 2>/dev/null; true')
    const txt = await readText(out, 2)
    if (txt) {
      const m = String(txt).trim().match(/^(\d+)/)
      if (m) return parseInt(m[1], 10)
    }
  } catch (e) { /* 忽略 */ }
  return 0
}

// 用 shell 统计字符数（wc -m）。用于进度百分比显示。
async function countChars(path) {
  const out = joinPath(ensureAppDir(), 'chunks', '_wcm.txt')
  try {
    execShell('wc -m ' + shq(path) + ' > ' + shq(out) + ' 2>/dev/null; true')
    const txt = await readText(out, 2)
    if (txt) {
      const m = String(txt).trim().match(/^(\d+)/)
      if (m) return parseInt(m[1], 10)
    }
  } catch (e) { /* 忽略 */ }
  return 0
}

// 切分大文件：只在「尚未切分过」时执行。幂等——目录已存在且块数 > 0 则跳过。
export async function openReader(path) {
  const chunkDir = chunkDirFor(path)
  const chunkName = 'chunk_'
  const book = {
    path: path,
    name: '',
    totalLines: 0,
    totalChars: 0,
    chunkCount: 0,
    chunkDir: chunkDir,
    chunkName: chunkName
  }

  // 已切分过：直接复用（目录里块文件数 > 0）
  try {
    const cntFile = joinPath(chunkDir, '_count.txt')
    execShell('ls ' + shq(chunkDir) + ' 2>/dev/null | grep ' + shq(chunkName) + ' | wc -l > ' + shq(cntFile) + '; true')
    const cnt = await readText(cntFile, 1)
    if (cnt && parseInt(cnt.trim(), 10) > 0) {
      book.chunkCount = parseInt(cnt.trim(), 10)
      const meta = await readMeta(path)
      if (meta) {
        book.totalLines = meta.totalLines
        book.totalChars = meta.totalChars
        book.name = meta.name
      }
      return book
    }
  } catch (e) { /* 首次 */ }

  // 首次切分
  try {
    execShell('rm -rf ' + shq(chunkDir) + ' 2>/dev/null; mkdir -p ' + shq(chunkDir) + '; true')
    execShell('split -l ' + LINES_PER_CHUNK + ' -d -a 4 ' + shq(path) + ' ' + shq(joinPath(chunkDir, chunkName)) + ' 2>/dev/null; true')
  } catch (e) {
    logLine('E', 'split 失败 ' + (e && e.message ? e.message : e))
  }

  // 块数
  const cntFile = joinPath(chunkDir, '_count.txt')
  execShell('ls ' + shq(chunkDir) + ' 2>/dev/null | grep ' + shq(chunkName) + ' | wc -l > ' + shq(cntFile) + '; true')
  const cnt = await readText(cntFile, 2)
  book.chunkCount = cnt ? parseInt(cnt.trim(), 10) || 0 : 0

  // 行数 + 字符数（并行不了，execShell 同步阻塞，串行）
  book.totalLines = await countLines(path)
  book.totalChars = await countChars(path)

  await saveMeta(path, book)
  return book
}

const META_FILE = 'book.meta.json'

async function metaPathFor(path) {
  return joinPath(chunkDirFor(path), META_FILE)
}

async function readMeta(path) {
  const raw = await readText(await metaPathFor(path), 1)
  if (!raw) return null
  try { return JSON.parse(raw) } catch (e) { return null }
}

async function saveMeta(path, book) {
  try {
    writeText(await metaPathFor(path), JSON.stringify({
      totalLines: book.totalLines,
      totalChars: book.totalChars,
      chunkCount: book.chunkCount,
      name: book.name
    }))
  } catch (e) { /* 忽略 */ }
}

// 按块索引读一段文本：返回第 chunkIndex 块的完整文本。
// 块内行数固定，所以进度（行号）→ 块索引 = floor((line-1) / LINES_PER_CHUNK)。
export async function readChunk(book, chunkIndex) {
  if (chunkIndex < 0 || chunkIndex >= book.chunkCount) return ''
  const p = chunkPath(book, chunkIndex)
  return await readText(p, 2)
}

// 行号 → 块索引
export function chunkIndexForLine(lineNo) {
  return Math.floor((Math.max(1, lineNo) - 1) / LINES_PER_CHUNK)
}

// 块索引 → 该块起始行号（1-based）
export function lineStartOfChunk(chunkIndex) {
  return chunkIndex * LINES_PER_CHUNK + 1
}
