// 写后读回的判定（纯函数）。
//
// 为什么单独拎出来：本机 `fs.writeFile` 有"不报错也不落盘"的实现分支（实测把目标
// 换成同名目录时，它返回成功但文件没变），所以**写入的返回值不可信**，必须读回比对。
// 这段判断是"用户到底存上没有"的唯一依据，抽出来才能在 Node 里锁住。

export function judgeReadback(expectedText, read) {
  const want = String(expectedText == null ? '' : expectedText)
  if (!read || read.ok !== true || read.text === null || read.text === undefined || read.text === '') {
    return { ok: false, reason: '写后读回为空' }
  }
  if (String(read.text) !== want) {
    return { ok: false, reason: '写后读回不一致', wantLen: want.length, gotLen: String(read.text).length }
  }
  return { ok: true, reason: '' }
}

// 给界面用的短说明（顶栏放不下一长串）
export function readbackHint(r) {
  if (!r || r.ok) return ''
  if (r.reason === '写后读回为空') return '写入没有落到磁盘（目录或存储异常）'
  return '磁盘内容与刚保存的不一致'
}
