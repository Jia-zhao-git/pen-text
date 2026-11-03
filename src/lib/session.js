// 跨页面的「正在读/待打开」状态。
//
// 词典笔页面之间没有 props，且 navTo 的第二参数在本框架里没有可靠的回传通道
// （参考项目所有页面都靠模块单例传状态）。书架页把「要打开哪本书」写进这里，
// 阅读页 mount 时读走即可。

let openBookPath = ''

export function requestOpen(path) {
  openBookPath = String(path || '')
}

export function consumeOpen() {
  const p = openBookPath
  openBookPath = ''
  return p
}
