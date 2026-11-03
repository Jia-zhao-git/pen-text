// 平台适配层：把 fs / global / $falcon / $dataDir 的差异收在这一个文件里，
// 页面与业务代码不直接碰平台 API。
//
// 真机事实（本设备 X7，框架 4.9.9）：
//  - fs.writeFile 是**同步**的：写 await 反而卡住事件循环，调用后不要再 await。
//  - mkdir 必须先调，路径不存在时 writeFile 不报错也不落盘。
//  - 冷启动第一次 readFile 经常失败（文件系统未就绪），要重试。
//  - execShell（global.Global）无回显、异步返回 boolean，命令产物要重定向到文件再读。

import fs from 'fs'
import globalModule from 'global'
import { logLine, seedLog, setLogSink, flushNow, logText, logTail, logStats } from '../lib/logfile.js'
import { mkdirChain } from '../lib/paths.js'

export const APP_TAG = 'PT'

let _g = null
export function getGlobal() {
  if (!_g) {
    try { _g = new globalModule.Global() } catch (e) { _g = null }
  }
  return _g
}

export function execShell(cmd) {
  try {
    const g = getGlobal()
    if (!g || typeof g.execShell !== 'function') return false
    return g.execShell(cmd)
  } catch (e) {
    return false
  }
}

export function dataDirBase() {
  try {
    // 本机 $dataDir 偶尔带重复斜杠（.../8000000000182399//data），拼出来很难看，
    // 也容易在日志里误判成"写到了别的目录"
    return String($dataDir || '/tmp').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  } catch (e) { return '/tmp' }
}

export function joinPath(base) {
  let out = String(base == null ? '' : base).replace(/\/+$/, '')
  for (let i = 1; i < arguments.length; i++) {
    const seg = String(arguments[i] == null ? '' : arguments[i]).replace(/^\/+/, '').replace(/\/+$/, '')
    if (seg) out += '/' + seg
  }
  return out
}

export function appDir() {
  return joinPath(dataDirBase(), 'pentext')
}

export function appLogPath() {
  return joinPath(dataDirBase(), 'pentext', 'app.log')
}

// 建过的目录记一笔：tempDir() 每次请求都会调到这里，逐段 mkdir 每次都重刷一遍系统调用
// 没必要。写文件抛异常时（writeTextEx 的 catch）会清空缓存，下一轮重试重新逐段建 ——
// 这也照顾了"目录被外部删掉"的情况。
let _dirOk = {}
export function resetDirCache() { _dirOk = {} }

// 目录已存在时 fs.mkdir 也会抛，不能一律当失败，否则每次 ensureAppDir 都记一条假错误
function isExistErr(msg) {
  const s = String(msg || '').toLowerCase()
  return s.indexOf('exist') >= 0 || s.indexOf('errno=17') >= 0
}

export function ensureAppDir(sub) {
  const dir = sub ? joinPath(appDir(), sub) : appDir()
  if (_dirOk[dir]) return dir
  // 从 dataDir 起逐段建：父链缺任何一级，单次 mkdir 都会 ENOENT，
  // 而 writeFile 又"不报错也不落盘"，结果就是日志静默丢失（真机上复现过）
  const list = mkdirChain(dataDirBase(), dir)
  let lastErr = ''
  for (let i = 0; i < list.length; i++) {
    try {
      fs.mkdir(list[i])
    } catch (e) {
      const msg = errText(e)
      if (!isExistErr(msg)) lastErr = list[i] + ' :: ' + msg
    }
  }
  if (lastErr) {
    // 首次启动最常见：文件系统还没就绪。以前这里静默忽略，然后 writeFile
    // "不报错也不落盘"，用户看到的就是保存失败/保存后消失，而日志里什么都没有。
    if (_mkdirErrOnce !== lastErr) { _mkdirErrOnce = lastErr; logLine('W', 'mkdir 失败 ' + lastErr) }
  } else {
    _dirOk[dir] = 1
  }
  return dir
}
let _mkdirErrOnce = ''

// 日志落盘：本机没有 appendFile，只能读旧 + 整份重写，所以由 logfile 攒批后调这里
let _logReady = false
export async function initLog(version) {
  if (_logReady) return true
  _logReady = true
  // 目录不在时 writeFile 不报错也不落盘（本机特性），所以日志目录要先建好
  ensureAppDir()
  setLogSink((text) => {
    try { fs.writeFile(appLogPath(), text); return true } catch (e) { return false }
  })
  // 先落"启动"这一行再 await 读旧日志：否则它会被排到 onLaunch 后续日志的后面，
  // 日志读起来就成了"先干活，后开机"
  logLine('I', '--- start v' + String(version || '?') + ' dataDir=' + dataDirBase() + ' ---')
  try {
    const old = await fs.readFile(appLogPath())
    if (old) seedLog(String(old))   // seedLog 会把旧内容插到最前面
  } catch (e) { /* 首次启动没有旧日志，正常 */ }
  flushNow()
  return true
}

export function logDump() {
  return { text: logText(), stats: logStats() }
}

export { logTail, logLine }

// 应用日志：既要能在 logcat 看见（排查时顺手），也要落盘（用户设备上唯一的线索）
export function log() {
  try {
    const args = []
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i]
      if (a && typeof a === 'object') {
        try { args.push(JSON.stringify(a)) } catch (e) { args.push(String(a)) }
      } else args.push(String(a))
    }
    const msg = args.join(' ')
    console.log(APP_TAG + ' ' + msg)
    logLine('I', msg)
  } catch (e) { /* 忽略 */ }
}

// 异常统一格式化：把 message / name / errno 都带上，否则日志里只有 "[object Object]"
export function errText(e) {
  if (!e) return 'unknown'
  if (typeof e === 'string') return e
  const parts = []
  if (e.name) parts.push(String(e.name))
  if (e.message) parts.push(String(e.message))
  if (e.errno !== undefined && e.errno !== null) parts.push('errno=' + e.errno)
  if (e.code) parts.push('code=' + e.code)
  const s = parts.join(' ').trim()
  return s || String(e)
}

export function logErr(tag, e) {
  const msg = tag + ' :: ' + errText(e)
  try { console.log(APP_TAG + ' E ' + msg) } catch (x) { /* 忽略 */ }
  logLine('E', msg)
  return msg
}


export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 单引号安全引用（路径/关键字拼进 shell 命令时用）
export function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

export async function readText(path, retries) {
  const r = await readTextEx(path, retries)
  return r.ok ? r.text : null
}

// 带原因的读：以前失败只有 null，分不清"文件不存在"和"文件系统没就绪"，
// 于是既不敢少重试、也没法在日志里留下证据。
export async function readTextEx(path, retries) {
  const n = typeof retries === 'number' ? retries : 1
  let lastErr = ''
  for (let i = 0; i < n; i++) {
    try {
      const v = await fs.readFile(path)
      if (v !== null && v !== undefined) return { ok: true, text: String(v), error: '' }
      lastErr = 'empty'
    } catch (e) {
      lastErr = errText(e)
    }
    if (i < n - 1) await sleep(400)
  }
  return { ok: false, text: null, error: lastErr }
}

// 同步写入，故意不返回 Promise：本机 fs.writeFile 是同步实现
export function writeText(path, text) {
  return writeTextEx(path, text).ok
}

// 带原因的写。注意本机一个坑：**目录不存在时 writeFile 不抛错也不落盘**，
// 所以 ok=true 并不等于真的写进去了 —— 调用方该回读的地方还是要回读。
export function writeTextEx(path, text) {
  try {
    fs.writeFile(path, String(text == null ? '' : text))
    return { ok: true, error: '' }
  } catch (e) {
    // 写失败常见原因是目录没了（被清理、被换掉）。清掉缓存，下一次 ensureAppDir
    // 会重新逐段建，而不是因为"记着建过"直接跳过。
    _dirOk = {}
    return { ok: false, error: errText(e) }
  }
}

export function writeFileSync(path, data) {
  try {
    fs.writeFile(path, data)
    return true
  } catch (e) {
    return false
  }
}

export async function removeFile(path) {
  try {
    const g = getGlobal()
    if (g && typeof g.execShell === 'function') {
      return g.execShell('rm -f ' + shq(path) + ' 2>/dev/null; true')
    }
  } catch (e) { /* 忽略 */ }
  return false
}

export async function exists(path) {
  try {
    const v = await fs.exists(path)
    // 有固件把 fs.exists 实现成占位对象（返回 {tip:"FileModule.exists"}），
    // 那是真值 —— 直接 !! 会永远判"存在"，后面读不到又去重试，白等 1.2s。
    if (typeof v === 'boolean') return v
  } catch (e) { /* 走兜底 */ }
  const r = await readTextEx(path, 1)
  return r.ok
}

export async function stat(path) {
  try {
    const st = await fs.stat(path)
    if (!st) return null
    // 本机 stat 结构体字段是 mtimeMs/atimeMs（见 fs 文档 3.4），没有 mtime。
    // 直接读 st.mtime 会拿到 undefined → 照片全部 mtime=0 → "最新在前"排序失效、
    // 目录指纹恒定导致相机回来自动收图不触发（两个 bug 同一个根因）。这里统一归一化。
    return {
      size: Number(st.size) || 0,
      mtime: Number(st.mtimeMs || st.mtime || 0),
      atime: Number(st.atimeMs || 0)
    }
  } catch (e) {
    return null
  }
}

export async function readdir(path) {
  try { return await fs.readdir(path) } catch (e) { return null }
}

// 轮询等待文件出现且非空（等 shell 命令产物）
export async function waitForFile(path, timeoutMs, shouldCancel) {
  const start = Date.now()
  const limit = timeoutMs || 5000
  while (Date.now() - start < limit) {
    if (shouldCancel && shouldCancel()) return null
    const c = await readText(path, 1)
    if (c !== null && c !== '') return c
    await sleep(120)
  }
  return null
}

export function navTo(uri, options) {
  try {
    if (typeof $falcon === 'undefined' || typeof $falcon.navTo !== 'function') return false
    $falcon.navTo(uri, options || {})
    return true
  } catch (e) {
    return false
  }
}

export function deviceInfo() {
  const out = { platform: '', version: '', apiVersion: 0, model: '', width: 0, height: 0 }
  try {
    const env = ($falcon && $falcon.env) || {}
    out.platform = env.platform || ''
    out.version = env.version || ''
    out.apiVersion = env.apiVersion || 0
    out.model = env.deviceModel || ''
    out.width = env.deviceWidth || 0
    out.height = env.deviceHeight || 0
  } catch (e) { /* 忽略 */ }
  return out
}
