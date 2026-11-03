// 跨页面的「打开哪本书」状态（模块单例 + 订阅广播）。
//
// 为什么不用 navTo 参数 / 依赖页面生命周期：词典笔页面之间没有 props，且
// 从子页面返回首页时**不触发首页的 mounted 和 onShow**（参考项目实测结论）。
// 首页（index）作为 app.json 第一个注册的页面，实例从冷启动就一直存活，
// 从书架 navTo 回来时 mounted 不会再跑 —— 用「一次性 consume」读参数必然读不到。
//
// 所以和 uistate.js 一样，用订阅广播：书架页点击书时广播，首页实例（即使
// 一直存活）收到就打开书。consume/request 仍保留，兜底冷启动直接从书架场景。

let openBookPath = ''
const subs = []

export function requestOpen(path) {
  openBookPath = String(path || '')
}

// 冷启动 boot 里读一次并清空
export function consumeOpen() {
  const p = openBookPath
  openBookPath = ''
  return p
}

// 广播「打开书」：给已存活的 index 页面用（它不重跑 mounted，只能靠订阅收到）
export function publishOpen(path) {
  openBookPath = String(path || '')
  const list = subs.slice()
  for (const fn of list) {
    try { fn(openBookPath) } catch (e) { /* 单个订阅出错不影响其它 */ }
  }
}

// 返回退订函数；页面 unmounted 时务必调用
export function subscribeOpen(fn) {
  if (typeof fn !== 'function') return function () {}
  subs.push(fn)
  return function () {
    const i = subs.indexOf(fn)
    if (i >= 0) subs.splice(i, 1)
  }
}
