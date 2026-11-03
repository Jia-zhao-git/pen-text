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
      updatedAt: Number(b.updatedAt) || 0
    })
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

// 更新单本书的进度 / 总字数，返回新的书架（不修改入参）。
export function upsertBook(library, patch) {
  const list = normalizeLibrary(library)
  const idx = list.findIndex((b) => b.id === patch.id)
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], patch)
  } else {
    list.unshift(Object.assign({
      id: newBookId(), name: '', path: '', addedAt: Date.now(),
      progress: 0, totalChars: 0, updatedAt: Date.now()
    }, patch))
  }
  return list
}
