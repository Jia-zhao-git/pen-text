// 书籍来源：扫描设备上可写的目录里的 .txt 文件。
//
// 词典笔没有通用文件选择器，书要靠 adb push 或系统应用放进固定目录，
// 再由本应用扫出来。按优先级扫下面几处，合并去重：
//   1. $dataDir/pentext/books/  —— 应用自己的书库（推荐，push 到这里）
//   2. /userdisk/Favorite/      —— 设备常用目录
//   3. /userdisk/               —— 根目录兜底（只取一级，不递归）
//
// 只认 .txt：本设备 QuickJS 没有通用解压/解析能力，纯文本是最稳的起点。

import { readdir, stat, exists, dataDirBase, joinPath, logLine } from './platform.js'

function isTxt(name) {
  return /\.txt$/i.test(String(name || ''))
}

async function scanDir(dir) {
  if (!dir) return []
  if (!(await exists(dir))) return []
  const names = await readdir(dir)
  if (!names) return []
  const out = []
  for (const name of names) {
    if (!isTxt(name)) continue
    const full = joinPath(dir, name)
    const st = await stat(full)
    out.push({
      path: full,
      name: name,
      size: st ? st.size : 0,
      mtime: st ? st.mtime : 0
    })
  }
  return out
}

// 返回去重后的 .txt 文件列表（按修改时间倒序，最新在前）。
export async function listBooks() {
  const roots = [
    joinPath(dataDirBase(), 'pentext', 'books'),
    '/userdisk/Favorite',
    '/userdisk'
  ]
  const seen = {}
  const out = []
  for (const dir of roots) {
    try {
      const list = await scanDir(dir)
      for (const f of list) {
        if (seen[f.path]) continue
        seen[f.path] = 1
        out.push(f)
      }
    } catch (e) {
      logLine('W', 'scanDir 失败 ' + dir + ' :: ' + (e && e.message ? e.message : e))
    }
  }
  out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  return out
}
