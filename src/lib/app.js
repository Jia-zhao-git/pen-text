// 极简 createApp：本工程不依赖 @dictpen/core（该 SDK 未公开发布，依赖即锁死构建）。
//
// 构建器（aiot-vue-cli 的 app 插件）会这样用入口模块：
//     import App from './app.js';
//     App.meta = <app.json>;
//     $falcon.__AppClazz = App;
//     $falcon.__loadModuleDefault = ... // 按页面名动态取页面模块
// 原生侧做的是 `new AppClazz()` 然后按需调用 onLaunch / onShow / onHide。
// 所以入口只要 **默认导出一个类**，并把 setViewPort 落到实例的 viewPort 上即可。
//
// 这里额外补了 on/off/trigger，因为框架基类（falcon-jsfm 的 App extends FalconEvent）
// 带这三个方法，页面/框架内部可能调用；缺失会在某些路径上抛错。

export function createApp(options) {
  const opts = options || {}

  return class FalconApp {
    constructor() {
      // 设计稿宽度：0 表示不缩放。本机逻辑坐标已是 936×280，按 936 出图即可。
      this.viewPort = opts.setViewPort || 0
      this.$meta = {}
      this.$falcon = null
      this._events = {}
    }

    on(name, cb) {
      if (!this._events[name]) this._events[name] = []
      this._events[name].push(cb)
    }

    off(name, cb) {
      const list = this._events[name]
      if (!list) return
      if (!cb) { this._events[name] = []; return }
      this._events[name] = list.filter((f) => f !== cb)
    }

    trigger(name) {
      const list = this._events[name] || []
      const args = Array.prototype.slice.call(arguments, 1)
      for (let i = 0; i < list.length; i++) {
        try { list[i].apply(this, args) } catch (e) { /* 不让一个监听器挂掉整个生命周期 */ }
      }
    }

    onLaunch(opts2) {
      if (typeof opts.onLaunch === 'function') opts.onLaunch.call(this, opts2 || {})
    }

    onShow() {
      if (typeof opts.onShow === 'function') opts.onShow.call(this)
    }

    onHide() {
      if (typeof opts.onHide === 'function') opts.onHide.call(this)
    }

    onError(err) {
      if (typeof opts.onError === 'function') opts.onError.call(this, err)
    }
  }
}
