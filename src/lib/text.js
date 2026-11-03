// 文本分页（纯函数，可在 Node 下单测）。
//
// 阅读器的核心：把一整本书切成「一屏一页」。本设备屏幕 936×280（横屏），
// <text> 由 flex-wrap 自然换行，但「自然换行」不产生稳定的分页边界 —— 滚动
// 阅读时用户无法感知「看到第几页」，更没法记录进度、断点续读。
//
// 大书（几十 MB）的教训：一次性「读全文 + 分页全书」会生成几十万页的巨型数组，
// 内存翻几百倍直接 abort 进程（本机 1GB + QuickJS）。所以提供两套 API：
//   - renderPage：**游标式**，只折「当前页」这一小段，内存 O(一页)，供运行时用
//   - paginate：一次性分全书，仅测试/小文本用
//
// 进度用「页首字符在原文的偏移」记录，改字号后仍能定位回原处。

// 字符宽度估算：全角（CJK、全角标点）算 1，半角（ASCII、半角标点）算 0.5。
export function charWidth(ch) {
  if (ch === '\n' || ch === '\r') return 0
  if (ch === '\t') return 2
  const code = ch.codePointAt(0)
  if (code >= 0x2e80) return 1
  return 0.5
}

// 段落列表：{ text, start }（一次性用，测试用）
export function splitParagraphs(text) {
  const s = String(text == null ? '' : text)
  const out = []
  let i = 0
  while (i <= s.length) {
    let j = s.indexOf('\n', i)
    if (j < 0) j = s.length
    out.push({ text: s.slice(i, j), start: i })
    if (j === s.length) break
    i = j + 1
  }
  return out
}

// 把一段文本按宽度折成若干行（纯视觉，返回字符串数组）。
export function wrapParagraph(text, maxUnits) {
  const s = String(text == null ? '' : text)
  const lines = []
  let cur = ''
  let curW = 0
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[A-Za-z0-9]/.test(ch)) {
      let j = i, word = '', ww = 0
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) { word += s[j]; ww += charWidth(s[j]); j++ }
      if (curW + ww <= maxUnits) { cur += word; curW += ww; i = j; continue }
      if (cur) { lines.push(cur); cur = ''; curW = 0; continue }
      let part = '', pw = 0, k = i
      while (k < s.length && /[A-Za-z0-9]/.test(s[k]) && pw + charWidth(s[k]) <= maxUnits) {
        part += s[k]; pw += charWidth(s[k]); k++
      }
      if (!part) { part = s[k]; k++ }
      cur += part; curW += pw; i = k
      continue
    }
    const w = charWidth(ch)
    if (curW + w > maxUnits && cur) { lines.push(cur); cur = ''; curW = 0; continue }
    cur += ch; curW += w; i++
  }
  if (cur) lines.push(cur)
  return lines
}

// 从 offset 处读出一个逻辑行（到换行或行宽上限），返回 { text, next }。
// next 是下一行的起始偏移（= 本行末尾字符之后、换行符之前）。
function readLine(s, offset, maxUnits, indent) {
  const n = s.length
  let i = offset
  let content = ''
  let width = 0
  let paraStart = true // 这一行是不是段落首行（决定缩进）

  // 跳过行首的换行符（连续空行也吃掉，只保留段落间隙语义）
  while (i < n && s[i] === '\n') { i++; paraStart = true }

  while (i < n && s[i] !== '\n') {
    const ch = s[i]
    if (/[A-Za-z0-9]/.test(ch)) {
      let k = i, word = '', ww = 0
      while (k < n && /[A-Za-z0-9]/.test(s[k])) { word += s[k]; ww += charWidth(s[k]); k++ }
      if (width + ww > maxUnits && width > 0) break
      if (width + ww > maxUnits) {
        let part = '', pw = 0, kk = i
        while (kk < n && /[A-Za-z0-9]/.test(s[kk]) && pw + charWidth(s[kk]) <= maxUnits) {
          part += s[kk]; pw += charWidth(s[kk]); kk++
        }
        if (!part) { part = s[kk]; kk++ }
        content += part; width += pw; i = kk
        continue
      }
      content += word; width += ww; i = k
      continue
    }
    const w = charWidth(ch)
    if (width + w > maxUnits && width > 0) break
    content += ch; width += w; i++
  }

  const line = (paraStart && indent) ? '\u3000\u3000' + content : content
  return { text: line, next: i }
}

// 归一化换行符：\r\n / \r → \n。只做一次，读入时调用；翻页路径不再重复。
export function normalizeText(text) {
  const s = text == null ? '' : String(text)
  if (s.indexOf('\r') < 0) return s
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// 游标式渲染一页：从 from 偏移开始，折出恰好 linesPerPage 行。
// 返回 { start, end, text, hasNext }。
//   start  本页首字符偏移
//   end    下一页起始偏移（= 本页末行之后，可直接喂给下一次 renderPage）
//   hasNext 是否还有后续内容
// 注意：text 必须是已经 normalizeText 过的（换行只有 \n）。翻页高频调用，
// 这里绝不再做 replace / 全量拷贝，否则大书每次翻页都要重跑一遍 O(n)。
export function renderPage(text, opts) {
  const o = opts || {}
  const charsPerLine = o.charsPerLine || 46
  const linesPerPage = o.linesPerPage || 10
  const indent = o.indent !== false

  const s = text == null ? '' : text
  const n = s.length

  let from = Number(o.from) || 0
  if (from < 0) from = 0
  if (from >= n) return { start: n, end: n, text: '', hasNext: false }

  const lines = []
  let cur = from
  let start = -1

  while (lines.length < linesPerPage && cur < n) {
    // 页首记录：第一个非空行（或第一个逻辑行）的起点
    if (start < 0) start = cur
    const ln = readLine(s, cur, charsPerLine, indent)
    lines.push(ln.text)
    cur = ln.next
    // 若这一行读完后停在换行符上，跳过它（否则下一行会先被 readLine 当空行处理）
    if (cur < n && s[cur] === '\n') cur++
  }

  return {
    start: start < 0 ? from : start,
    end: cur,
    text: lines.join('\n'),
    hasNext: cur < n
  }
}

// 一次性分全书（测试 / 小文本用，运行时别用这个对付大书）。
export function paginate(text, opts) {
  const o = opts || {}
  const charsPerLine = o.charsPerLine || 46
  const linesPerPage = o.linesPerPage || 10
  const indent = o.indent !== false

  const s = normalizeText(text)

  const pages = []
  let offset = 0
  while (offset < s.length) {
    const p = renderPage(s, { from: offset, charsPerLine, linesPerPage, indent })
    pages.push({ start: p.start, text: p.text })
    offset = p.end
    if (offset >= s.length) break
  }
  return pages
}

// 给定当前进度偏移，返回它落在第几页（仅在 paginate 全量结果上定位）。
export function locatePage(pages, offset) {
  if (!pages || !pages.length) return 0
  const o = Number(offset) || 0
  for (let i = pages.length - 1; i >= 0; i--) {
    if (pages[i].start <= o) return i
  }
  return 0
}

// 进度百分比（0-100），给顶栏显示「已读 23%」。
export function progressPercent(offset, totalChars) {
  const total = Number(totalChars) || 0
  if (!total) return 0
  const p = Math.round((Number(offset) || 0) / total * 100)
  return p < 0 ? 0 : (p > 100 ? 100 : p)
}
