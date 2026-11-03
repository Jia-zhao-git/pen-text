// 应用日志：内存环形缓冲 + 落盘 app.log。
//
// 为什么要它：用户报「无法写入配置」时，之前只有 console.log（'DP ' 前缀），
// 不落盘、也不进系统日志，用户设备上根本取不到；而写失败处的 catch 又把异常
// 吞掉了，连 errno 都没留 —— 于是这类问题只能靠猜。
//
// 设计约束（本机 fs 只有 writeFile，没有 appendFile / 没有可用的 exists）：
//  - 每次落盘都是「整份重写」，所以必须攒批、必须限长，否则小文件会被写爆。
//  - 错误级别立刻刷盘（用户可能马上就去看），普通日志最多 1.5s 刷一次。
//  - 本文件不 import fs / platform，只做缓冲与格式化，落盘由 platform 注入 sink，
//    避免 platform ⇄ logfile 循环依赖，也便于在 Node 下跑单测。

const MAX_LINES = 400
const MAX_BYTES = 24 * 1024
const FLUSH_DELAY_MS = 1500

let lines = []
let sink = null
let flushing = false
let timer = null
let dropped = 0

function pad(n, w) {
  let s = String(n)
  while (s.length < (w || 2)) s = '0' + s
  return s
}

function stamp() {
  const d = new Date()
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    '.' + pad(d.getMilliseconds(), 3)
}

export function setLogSink(fn) {
  sink = typeof fn === 'function' ? fn : null
}

// 启动时把旧日志尾部灌回来（本机没有 append，只能读旧 + 写新）
export function seedLog(text) {
  const s = String(text || '')
  if (!s) return 0
  const arr = s.split('\n').filter((x) => x.length > 0)
  // 只保留尾部，避免老日志永远占着缓冲区
  const keep = arr.slice(Math.max(0, arr.length - MAX_LINES))
  lines = keep.concat(lines)
  if (lines.length > MAX_LINES) lines = lines.slice(lines.length - MAX_LINES)
  return keep.length
}

export function logLine(level, msg) {
  const line = stamp() + ' ' + String(level || 'I').toUpperCase() + ' ' + String(msg == null ? '' : msg)
  lines.push(line)
  while (lines.length > MAX_LINES) { lines.shift(); dropped++ }
  if (level === 'E' || level === 'e') flushNow()
  else schedule()
  return line
}

function schedule() {
  if (timer || !sink) return
  timer = setTimeout(() => { timer = null; flushNow() }, FLUSH_DELAY_MS)
}

// 超出上限时丢最老的行，而不是整份清空 —— 现场信息就在尾部
function serialize() {
  let text = lines.join('\n')
  if (text.length > MAX_BYTES) {
    text = text.slice(text.length - MAX_BYTES)
    const nl = text.indexOf('\n')
    if (nl > 0) text = text.slice(nl + 1)
  }
  return text + '\n'
}

export function flushNow() {
  if (!sink || flushing) return false
  flushing = true
  let ok = false
  try { ok = sink(serialize()) } catch (e) { ok = false }
  flushing = false
  return !!ok
}

export function logText() {
  return lines.join('\n')
}

// 诊断页只显示尾部若干行，屏太小，一次给太多没人看
export function logTail(n) {
  const k = n || 12
  return lines.slice(Math.max(0, lines.length - k)).join('\n')
}

export function logStats() {
  return { lines: lines.length, dropped: dropped, hasSink: !!sink }
}

export function resetLog() {
  lines = []
  dropped = 0
  if (timer) { clearTimeout(timer); timer = null }
}
