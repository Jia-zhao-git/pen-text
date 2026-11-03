// 目录逐级创建规划（纯函数，便于在 Node 下单测）
//
// 为什么需要它：本机两个坑叠在一起，会让「第一次启动」一个字节日志都没有 ——
//   1. fs.mkdir 只建最后一级，父目录不存在时抛 ENOENT；
//   2. fs.writeFile 在目录不存在时**不报错也不落盘**。
// 于是 initLog 里的 ensureAppDir() 一旦失败，日志写起来"成功"、盘上却什么都没有，
// 现场连"日志为什么没写进去"都留不下证据。所以目录必须从 dataDir 起逐段建。
//
// 边界：只允许在 dataDir 之下逐段建。dataDir 的祖先（pkg/<appid>、mini_app……）
// 归框架管，越权去建反而会造出框架不认识的目录。

const SEP = '/'

// 归一化：合并重复斜杠、去掉尾部斜杠。
// $dataDir 偶尔带重复斜杠（.../8000000000182399//data），不归一化的话
// a//b 与 a/b 会被当成两个目录，缓存 key 和前缀判断都会错。
export function normPath(p) {
  let s = String(p == null ? '' : p).replace(/\/{2,}/g, '/')
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return s
}

// 返回需要依次 mkdir 的绝对路径数组（含 base 本身，到 target 为止）
//  - target 在 base 之下：base → base/a → base/a/b
//  - target 不在 base 之下：只返回 [target]，保持"只建一级"的老行为
export function mkdirChain(base, target) {
  const b = normPath(base)
  const t = normPath(target)
  if (!t) return []
  if (!b) return [t]
  if (t === b) return [b]
  const prefix = b + SEP
  if (t.indexOf(prefix) !== 0) return [t]
  const rest = t.slice(prefix.length)
  if (!rest) return [b]
  const out = [b]
  let cur = b
  const segs = rest.split(SEP)
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i]) continue
    cur = cur + SEP + segs[i]
    out.push(cur)
  }
  return out
}
