// 模板静态审计：<text> 不得有元素子节点。
//
// 真机后果：Falcon 的 <text> 节点带 measure 函数，Yoga 断言
// "Nodes with measure functions cannot have children." 直接 abort 整个框架进程，
// 应用层 try/catch 兜不住、页面上也看不到报错，只会表现为"一进页面就闪退、重进又闪退"。
// 这类错误在构建期不报、模拟器不报，只能上机才炸，所以打包前静态拦一道。

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'src')
const TEXT_TAGS = ['text']

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

// 找出 <template> 段落
function templateOf(src) {
  const i = src.indexOf('<template>')
  const j = src.lastIndexOf('</template>')
  if (i < 0 || j < 0) return ''
  // 先剥掉 HTML 注释：注释里出现 "<text>" 字样不该参与扫描
  return src.slice(i + 10, j).replace(/<!--[\s\S]*?-->/g, '')
}

// 扫描 <text ...> ... </text>，看内部是否出现元素标签
function scanText(html) {
  const problems = []
  const re = /<text\b[^>]*>/g
  let m
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length
    // 自己闭合的标签（<text ... />）跳过
    if (m[0].endsWith('/>')) continue
    const end = html.indexOf('</text>', start)
    if (end < 0) continue
    const inner = html.slice(start, end)
    // 内部若出现 <tag ...> 或 </tag>，即违规（< 后面紧跟字母）
    const elem = inner.match(/<\/?[a-zA-Z][^>]*>/)
    if (elem) {
      const line = html.slice(0, m.index).split('\n').length
      problems.push({ line, tag: m[0].trim(), inner: elem[0] })
    }
  }
  return problems
}

function main() {
  const files = walk(ROOT, [])
  let bad = 0
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const html = templateOf(src)
    if (!html) continue
    const problems = scanText(html)
    if (problems.length) {
      bad += problems.length
      console.error('\n[audit] ' + path.relative(ROOT, file))
      for (const p of problems) {
        console.error('  - 第 ' + p.line + ' 行附近：' + p.tag + ' 内含子元素 ' + p.inner)
      }
    }
  }
  if (bad) {
    console.error('\n[audit] 失败：共 ' + bad + ' 处 <text> 带元素子节点，会让设备 abort')
    process.exit(1)
  }
  console.log('[audit] 通过：' + files.length + ' 个 .vue 文件均无「<text> 带元素子节点」')
}

main()
