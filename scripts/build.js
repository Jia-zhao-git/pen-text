#!/usr/bin/env node
// 构建入口：审计 → 单测 → rollup 打包 → （可选）qjsc 预编译 → manifest → amr
//
// 不依赖 @dictpen/core，只依赖 npm 上公开的 aiot-vue-cli。

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// aiot-vue-cli 只能在打完补丁之后 require：它内部的 cli-libs/index.js 会去加载 CLI 自带的
// Vue2 `vue-template-compiler`，跟本项目安装的 vue 3.5 版本不匹配，`require` 当场抛
// "Vue packages version mismatch"。补丁把它换成 `@vue/compiler-sfc` 后才能正常加载。
// 所以这几个 require 必须懒加载（放在 ensureCliPatched() 之后），否则新克隆的仓库
// 一跑构建就崩，还得先手工执行 scripts/patch-cli.sh。
function cli() {
  return {
    build: require('aiot-vue-cli/src/steps/build'),
    qjscAll: require('aiot-vue-cli/src/steps/qjsc'),
    manifest: require('aiot-vue-cli/src/steps/manifest'),
    pack: require('aiot-vue-cli/src/steps/pack'),
    share: require('aiot-vue-cli/src/libs/share'),
    appInfo: require('aiot-vue-cli/src/libs/appinfo')
  }
}

const arg = (process.argv[2] || '').toLowerCase()
const isProd = arg === 'prod'

const APP_ROOT = path.resolve(__dirname, '..')

// 版本号打在最前面，出包名就是 `<appid>.<版本>.amr`。
// 看到这条还是老版本，说明忘了先 `npm run bump` —— 两个包会同名，装到设备上分不清。
function logVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'))
    console.log('[build] 版本 ' + pkg.version + '  appid ' + pkg.appid +
      '  →  ' + pkg.appid + '.' + String(pkg.version).replace(/\./g, '_') + '.amr')
  } catch (e) {
    console.warn('[build] 读不到 package.json 的版本号')
  }
}

// aiot-vue-cli 的依赖补丁（@vue/compiler-sfc 3.5 兼容）原先靠手工跑 scripts/patch-cli.sh，
// 一旦重装 node_modules 就失效且报错莫名其妙。这里在构建前自动补一次。
// Windows 上没有 bash，改用 Node 版 scripts/patch-cli.mjs（两者替换内容一致）。
function ensureCliPatched() {
  const script = path.join(APP_ROOT, 'scripts', 'patch-cli.mjs')
  if (!fs.existsSync(script)) return
  try {
    execSync('node "' + script + '"', { cwd: APP_ROOT, stdio: 'inherit' })
  } catch (e) {
    console.warn('[build] CLI 补丁脚本未能执行（若构建失败请手工执行 node scripts/patch-cli.mjs）')
  }
}

// falcon-ui 0.0.17 缺 src/styles/theme-default/theme.config.js，CLI 每次构建都会警告。
// 它的 getThemeImportSource 里 `theme || 'theme-default'` 让空字符串也绕不过去，
// 只能把文件补齐。本应用样式全部自写，不消费 FALCON_THEME 变量，空对象等价。
function ensureFalconTheme() {
  const dir = path.join(APP_ROOT, 'node_modules', 'falcon-ui', 'src', 'styles', 'theme-default')
  const file = path.join(dir, 'theme.config.js')
  const stylesDir = path.dirname(dir)
  if (!fs.existsSync(stylesDir) || fs.existsSync(file)) return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, 'export default {}\n')
  console.log('[build] 已补 falcon-ui 空主题配置（消除 theme 缺失警告）')
}

async function main() {
  logVersion()
  ensureCliPatched()
  ensureFalconTheme()

  const { build, qjscAll, manifest, pack, share, appInfo } = cli()

  await appInfo.init('.')

  if (isProd) {
    console.log('[build] 静态审计（<text> 不得有元素子节点）...')
    execSync('node scripts/audit-text-nesting.js', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' })

    console.log('[build] 纯函数回归...')
    execSync('node test/run.mjs', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' })
  }

  const falconDir = appInfo.getFalconBuildDir()
  fs.rmSync(falconDir, { recursive: true, force: true })
  fs.mkdirSync(falconDir, { recursive: true })

  console.log('[build] rollup 打包...')
  await build({ minify: isProd, mock: false, env: [] })

  // 图标：包根放 app_icon.png，manifest 会 walk 整个产物目录自动登记 cert
  const icon = path.resolve(__dirname, '..', 'app_icon.png')
  if (fs.existsSync(icon)) {
    fs.copyFileSync(icon, path.join(falconDir, 'app_icon.png'))
    console.log('[build] 图标已复制')
  }

  if (isProd) {
    try {
      console.log('[build] qjsc 预编译...')
      await qjscAll(share.internalModules)
      console.log('[build] qjsc 完成')
    } catch (e) {
      // qjsc 只是启动加速，失败不阻断出包
      console.warn('[build] qjsc 跳过（' + e.message + '）')
    }
  }

  console.log('[build] 生成 manifest...')
  await manifest.generate()

  console.log('[build] 打包 AMR...')
  await pack.pack()
  console.log('[build] 完成')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
