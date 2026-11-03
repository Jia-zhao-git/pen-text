// 修补 aiot-vue-cli，使其兼容 @vue/compiler-sfc 3.5。
//
// 这是 scripts/patch-cli.sh 的 Node 等价物：参考项目用 bash+sed 打补丁，
// 但那在 Windows 上没有 bash、sed 语义也对不上，导致构建在 Windows 上必然失败。
// 这里改成纯 Node 的字符串替换，跨平台可用，且同样幂等（替换目标已就位则跳过）。
//
// 每条替换与 patch-cli.sh 一致，只是用 Node fs 完成。

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_DIR = path.resolve(__dirname, '..', 'node_modules', 'aiot-vue-cli')

function patchFile(file, replacements) {
  if (!fs.existsSync(file)) {
    console.log('[patch-cli] 跳过不存在的文件: ' + file)
    return
  }
  let src = fs.readFileSync(file, 'utf8')
  let changed = false
  for (const [from, to] of replacements) {
    if (src.indexOf(to) >= 0) continue // 已打过的补丁跳过，保证幂等
    if (src.indexOf(from) >= 0) {
      src = src.split(from).join(to)
      changed = true
    }
  }
  if (changed) {
    fs.writeFileSync(file, src)
    console.log('[patch-cli] 已修补: ' + path.relative(CLI_DIR, file))
  }
}

if (!fs.existsSync(CLI_DIR)) {
  console.log('[patch-cli] 未找到 ' + CLI_DIR + '，跳过')
} else {
  // 1. 把 CLI 自带的 Vue2 vue-template-compiler 换成 @vue/compiler-sfc
  patchFile(path.join(CLI_DIR, 'cli-libs', 'index.js'), [
    [String.raw`path.resolve(__dirname, './vue/packages/vue-template-compiler/index.js')`, "'@vue/compiler-sfc'"]
  ])

  // 2. compiler.parseComponent() → compiler.parse().descriptor
  patchFile(path.join(CLI_DIR, 'web-loaders', 'falcon-vue-loader', 'lib', 'parser.js'), [
    [String.raw`compiler.parseComponent(content, { pad: 'line' })`, String.raw`compiler.parse(content, { pad: 'line' }).descriptor`]
  ])

  // 3. compiler.compile → compiler.compileTemplate
  patchFile(path.join(CLI_DIR, 'web-loaders', 'falcon-vue-loader', 'lib', 'template-compiler', 'index.js'), [
    ['compiler.compile', 'compiler.compileTemplate']
  ])

  // 4. 同 2，src/libs/parser.js
  patchFile(path.join(CLI_DIR, 'src', 'libs', 'parser.js'), [
    [String.raw`compiler.parseComponent(content, { pad: true })`, String.raw`compiler.parse(content, { pad: true }).descriptor`]
  ])

  // 5. rollup.config.js：注入 typescript 插件，并把 defineComponent 替换为空
  patchFile(path.join(CLI_DIR, 'src', 'libs', 'rollup.config.js'), [
    [String.raw`commonjs(),`, String.raw`commonjs(),require('@rollup/plugin-typescript')(),`],
    ['const replaceValues = {}', "const replaceValues = { 'defineComponent': '' }"]
  ])
}

// 6. falcon-ui 缺失的 theme 文件：补一个空主题配置（本应用不消费 FALCON_THEME）
const themeDir = path.resolve(__dirname, '..', 'node_modules', 'falcon-ui', 'src', 'styles', 'theme-default')
const themeFile = path.join(themeDir, 'theme.config.js')
if (!fs.existsSync(themeFile)) {
  fs.mkdirSync(themeDir, { recursive: true })
  fs.writeFileSync(themeFile, 'export default {}\n')
  console.log('[patch-cli] 已补 falcon-ui 空主题配置')
}

console.log('[patch-cli] 补丁应用完成')
