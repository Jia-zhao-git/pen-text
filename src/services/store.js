// 持久化：设置 + 书架。全部走文件（沿用参考项目的结论：本机 storage JSAPI
// 的 Promise 有挂起风险，关键路径不用它）。

import { readText, readTextEx, writeText, writeTextEx, ensureAppDir, joinPath, exists, logLine } from './platform.js'
import { normalizeSettings, DEFAULT_SETTINGS } from '../lib/settings.js'
import { normalizeLibrary, upsertBook } from '../lib/book.js'
import { judgeReadback } from '../lib/savecheck.js'

const F_SETTINGS = 'settings.json'
const F_LIBRARY = 'library.json'

function p(name) {
  return joinPath(ensureAppDir(), name)
}

// ---- 设置 ----

export async function loadSettings() {
  if (!(await exists(p(F_SETTINGS)))) return normalizeSettings(DEFAULT_SETTINGS)
  const raw = await readText(p(F_SETTINGS), 3)
  if (!raw) return normalizeSettings(DEFAULT_SETTINGS)
  try {
    return normalizeSettings(JSON.parse(raw))
  } catch (e) {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

let lastSave = { ok: true, reason: '', path: '', at: 0, attempt: 0 }
export function getLastSaveInfo() { return lastSave }

function shortErr(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 56 ? t.slice(0, 56) + '…' : (t || 'unknown')
}

export function saveSettings(settings) {
  const s = normalizeSettings(settings)
  s.updatedAt = Date.now()
  const text = JSON.stringify(s)
  const path = p(F_SETTINGS)
  let reason = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    ensureAppDir()
    const r = writeTextEx(path, text)
    if (r.ok) {
      lastSave = { ok: true, reason: '', path: path, at: s.updatedAt, attempt: attempt }
      scheduleVerify(text, path)
      return s
    }
    reason = r.error
    logLine('E', 'saveSettings 写失败 第' + attempt + '轮 :: ' + r.error + ' @ ' + path)
  }
  lastSave = { ok: false, reason: shortErr(reason), path: path, at: Date.now(), attempt: 2 }
  return null
}

let verifyPending = false
function scheduleVerify(expected, path) {
  if (verifyPending) return
  verifyPending = true
  setTimeout(() => {
    verifyPending = false
    readTextEx(path, 1).then((r) => {
      const v = judgeReadback(expected, r)
      if (!v.ok) {
        lastSave = { ok: false, reason: v.reason, path: path, at: Date.now(), attempt: 2 }
        logLine('E', 'saveSettings ' + v.reason + ' @ ' + path)
      }
    }).catch((e) => {
      logLine('E', 'saveSettings 读回异常 :: ' + (e && e.message ? e.message : e))
    })
  }, 250)
}

// ---- 书架 ----

export async function loadLibrary() {
  if (_libLoaded) return _libCache
  if (!(await exists(p(F_LIBRARY)))) { seedLibrary([]); return _libCache }
  const raw = await readText(p(F_LIBRARY), 3)
  if (!raw) { seedLibrary([]); return _libCache }
  try {
    return seedLibrary(JSON.parse(raw))
  } catch (e) {
    seedLibrary([])
    return _libCache
  }
}

export function saveLibrary(library) {
  const list = normalizeLibrary(library)
  const ok = writeText(p(F_LIBRARY), JSON.stringify(list))
  return ok
}

// 内存书架缓存：进度保存是高频 + 退出时也要可靠落盘的操作，不能每次都
// 异步读盘（onHide 时异步链来不及跑完就退出了）。loadLibrary 首次读盘后
// 缓存，后续 saveBookProgress 直接基于缓存合并 + 同步写盘。
let _libCache = null
let _libLoaded = false

export function hasLibraryCache() {
  return _libLoaded
}

export function seedLibrary(lib) {
  _libCache = normalizeLibrary(lib)
  _libLoaded = true
  return _libCache
}

// 保存单本书的进度（高频调用：翻页、退出都写）。
// 若已有缓存则同步合并 + 同步写盘（onHide 可靠落盘的关键）；
// 无缓存则先读盘再写（冷启动首次）。
export function saveBookProgress(book) {
  if (_libLoaded && _libCache !== null) {
    try {
      _libCache = upsertBook(_libCache, book)
      const ok = saveLibrary(_libCache)
      if (!ok) logLine('E', 'saveBookProgress 写盘失败 @ ' + p(F_LIBRARY))
      return ok
    } catch (e) {
      logLine('E', 'saveBookProgress 失败 :: ' + (e && e.message ? e.message : e))
      return false
    }
  }
  // 冷启动首次：异步读盘后写入
  loadLibrary().then((lib) => {
    seedLibrary(lib)
    _libCache = upsertBook(_libCache, book)
    saveLibrary(_libCache)
  }).catch((e) => {
    logLine('E', 'saveBookProgress 失败 :: ' + (e && e.message ? e.message : e))
  })
  return false
}
