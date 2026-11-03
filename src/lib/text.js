// 文本分页（纯函数，可在 Node 下单测）。
//
// 阅读器的核心：把一整本书切成「一屏一页」。本设备屏幕 936×280（横屏），
// <text> 由 flex-wrap 自然换行，但「自然换行」不产生稳定的分页边界 —— 滚动
// 阅读时用户无法感知「看到第几页」，更没法记录进度、断点续读。
//
// 所以这里在逻辑层做**确定性分页**：按「全角字宽」估算折行，凑满 N 行就是一页。
// 进度用「页首字符在原文的偏移」记录，改字号重新分页后仍能定位回原处。
//
// 偏移是**字符级精确**的：段落被折成多行时，每行都记住自己在原文的起点，
// 这样超长段落里翻页也能精确续读，而不是退回到段首。

// 字符宽度估算：全角（CJK、全角标点）算 1，半角（ASCII、半角标点）算 0.5。
// 与参考项目「全角 15px / 半角 8px」的实测结论同源，只是归一化到相对单位，
// 让「每行放几个全角字」成为可读、可调的配置项。
export function charWidth(ch) {
  if (ch === '\n' || ch === '\r') return 0
  if (ch === '\t') return 2 // 一个 tab 展开成 4 个半角宽
  const code = ch.codePointAt(0)
  if (code >= 0x2e80) return 1
  return 0.5
}

// 段落列表：{ text, start }，text 不含换行符，start 是该段首字符在全文的偏移。
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
// 英文/数字单词保持完整，不硬拆；单词本身超长时才按字符切开。
export function wrapParagraph(text, maxUnits) {
  const s = String(text == null ? '' : text)
  const lines = []
  let cur = ''
  let curW = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (/[A-Za-z0-9]/.test(ch)) {
      // 整词取出
      let j = i, word = '', ww = 0
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) { word += s[j]; ww += charWidth(s[j]); j++ }
      // 词放得下 → 直接并入
      if (curW + ww <= maxUnits) {
        cur += word; curW += ww; i = j; continue
      }
      // 放不下且行已有内容 → 换行
      if (cur) { lines.push(cur); cur = ''; curW = 0; continue }
      // 行空且词比整行还长 → 按字符硬切
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

// 分页主函数。
//   text        全书文本（原始，可含 \r\n）
//   charsPerLine  每行容纳的全角字数（宽度单位）
//   linesPerPage  每页行数
//   indent      段首是否缩进两个全角空格（中文阅读习惯，默认开）
// 返回 [{ start, text }]，start 为该页在原文的**精确字符偏移**。
export function paginate(text, opts) {
  const o = opts || {}
  const charsPerLine = o.charsPerLine || 46
  const linesPerPage = o.linesPerPage || 10
  const indent = o.indent !== false

  const s = String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const n = s.length

  const pages = []
  let page = []
  let pageStart = 0

  const flush = () => {
    if (page.length) pages.push({ start: pageStart, text: page.join('\n') })
    page = []
  }

  let i = 0
  let paraStart = true // 当前位置是否是一个段落的开头（决定这一行要不要缩进）

  while (i < n) {
    if (s[i] === '\n') {
      // 空行（段落分隔）：当前页尚有空间时补一个空行
      i++
      paraStart = true
      if (page.length > 0 && page.length < linesPerPage) {
        page.push('')
        if (page.length >= linesPerPage) flush()
      }
      continue
    }

    // 逻辑行起点（记录精确偏移）
    const lineStart = i
    const isParaStart = paraStart
    let content = ''
    let width = 0

    while (i < n && s[i] !== '\n') {
      const ch = s[i]

      if (/[A-Za-z0-9]/.test(ch)) {
        let k = i, word = '', ww = 0
        while (k < n && /[A-Za-z0-9]/.test(s[k])) { word += s[k]; ww += charWidth(s[k]); k++ }
        if (width + ww > charsPerLine && width > 0) break // 词放不下 → 换行
        if (width + ww > charsPerLine) {
          // 行空且词比整行还长 → 硬切
          let part = '', pw = 0, kk = i
          while (kk < n && /[A-Za-z0-9]/.test(s[kk]) && pw + charWidth(s[kk]) <= charsPerLine) {
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
      if (width + w > charsPerLine && width > 0) break
      content += ch; width += w; i++
    }

    // 段首缩进只加在这一段的第一行（折行续行不缩进）
    const line = (isParaStart && indent) ? '\u3000\u3000' + content : content
    if (page.length >= linesPerPage) flush()
    if (page.length === 0) pageStart = lineStart
    page.push(line)
    paraStart = false
  }
  flush()
  return pages
}

// 给定当前进度偏移，返回它落在第几页（改字号后重新分页，用偏移找回页码）。
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
