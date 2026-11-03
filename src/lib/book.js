// 书籍与书架（纯函数）。
//
// 一本书 = 一段落在盘上的文本 + 一条元数据记录。元数据单独落盘（library.json），
// 正文按需读入、用完即弃 —— 正文可能几百 KB，长期驻留会压爆设备 1GB 内存。

// 生成一个稳定的 id：书名 + 文件大小 + 添加时间哈希。简单起见用时间戳 + 随机，
// 只要在同一设备上唯一即可。
export function newBookId() {
  return 'bk_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36)
}

// 从文件名猜书名：去掉 .txt 后缀，去掉常见的序号前缀「001.」这类。
export function titleFromName(name) {
  const s = String(name == null ? '' : name).trim()
  const base = s.replace(/\.(txt|TXT)$/, '')
  const cleaned = base.replace(/^[\d_\-\s\.]+/, '')
  return cleaned || base || '未命名'
}

// 书是否还能在盘上找到（文件被删了则标记为缺失，书架显示灰置）。
export function bookAvailable(book) {
  return !!(book && book.path)
}

// 归一化书架：过滤坏数据，按最近阅读排序（最近读的排前面）。
export function normalizeLibrary(arr) {
  if (!Array.isArray(arr)) return []
  const out = []
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue
    if (!b.id || !b.path) continue
    out.push({
      id: b.id,
      name: b.name || titleFromName(b.path),
      path: b.path,
      addedAt: Number(b.addedAt) || 0,
      progress: Number(b.progress) || 0,
      totalChars: Number(b.totalChars) || 0,
      totalLines: Number(b.totalLines) || 0,
      chunkCount: Number(b.chunkCount) || 0,
      progressChunk: Number(b.progressChunk) || 0,
      updatedAt: Number(b.updatedAt) || 0
    })
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

// 更新单本书的进度 / 总字数，返回新的书架（不修改入参）。
// 按 path 匹配（path 是稳定唯一键）：调用方不一定知道 id（例如只拿文件路径存
// 进度时），按 id 匹配会因为 id 为空而永远匹配不到，导致重复新增 + 被归一化
// 过滤，进度静默丢失。这里以 path 为准，id 缺失则保留原 id 或新生成。
export function upsertBook(library, patch) {
  const list = normalizeLibrary(library)
  const idx = list.findIndex((b) => b.path === patch.path)
  const id = patch.id || (idx >= 0 ? list[idx].id : newBookId())
  const merged = Object.assign({
    id: id, name: '', path: '', addedAt: Date.now(),
    progress: 0, totalChars: 0, updatedAt: Date.now()
  }, patch, { id: id })
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], merged)
  } else {
    list.unshift(merged)
  }
  return list
}
