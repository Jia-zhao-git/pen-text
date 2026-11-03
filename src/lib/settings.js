// 设置结构 + 归一化（含默认值与钳制）。

export const DEFAULT_SETTINGS = {
  version: 1,
  fontSize: 24,       // 正文字号（px）。越大每页字越少。
  charsPerLine: 46,   // 每行全角字数
  linesPerPage: 10,   // 每页行数
  lineHeight: 26,     // 行高（px）
  indent: true,       // 段首缩进两格
  theme: 'dark',      // dark / light / sepia（羊皮纸）
  updatedAt: 0
}

// 从任意对象安全归一化出设置（缺失字段补默认，越界值钳制）。
export function normalizeSettings(raw) {
  const d = DEFAULT_SETTINGS
  const s = raw && typeof raw === 'object' ? raw : {}
  const num = (v, def, min, max) => {
    let n = Number(v)
    if (!isFinite(n)) n = def
    if (n < min) n = min
    if (n > max) n = max
    return Math.round(n)
  }
  return {
    version: 1,
    fontSize: num(s.fontSize, d.fontSize, 14, 40),
    charsPerLine: num(s.charsPerLine, d.charsPerLine, 20, 80),
    linesPerPage: num(s.linesPerPage, d.linesPerPage, 5, 20),
    lineHeight: num(s.lineHeight, d.lineHeight, 18, 48),
    indent: s.indent !== false,
    theme: (s.theme === 'light' || s.theme === 'sepia') ? s.theme : 'dark',
    updatedAt: Number(s.updatedAt) || 0
  }
}
