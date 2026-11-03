// 纯函数回归入口（Node 直跑，不碰设备）。
import { charWidth, splitParagraphs, wrapParagraph, paginate, renderPage, locatePage, progressPercent, normalizeText } from '../src/lib/text.js'
import { titleFromName, newBookId, normalizeLibrary, upsertBook, bookAvailable } from '../src/lib/book.js'
import { normalizeSettings, DEFAULT_SETTINGS } from '../src/lib/settings.js'
import { normPath, mkdirChain } from '../src/lib/paths.js'
import { judgeReadback } from '../src/lib/savecheck.js'

let pass = 0
let fail = 0
const fails = []

function ok(cond, name, extra) {
  if (cond) { pass++; return }
  fail++
  fails.push(name + (extra ? '  → ' + extra : ''))
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, JSON.stringify(a) + ' !== ' + JSON.stringify(b))
}

// ---------- 字符宽度 ----------
{
  eq(charWidth('汉'), 1, '全角算 1')
  eq(charWidth('a'), 0.5, '半角算 0.5')
  eq(charWidth('\n'), 0, '换行 0 宽')
  eq(charWidth('\t'), 2, 'tab 2 宽')
}

// ---------- 段落切分 ----------
{
  const paras = splitParagraphs('ab\n\ncd')
  eq(paras.length, 3, '空行也算一段')
  eq(paras[0].text, 'ab', '第一段内容')
  eq(paras[0].start, 0, '第一段偏移')
  eq(paras[2].text, 'cd', '第三段内容')
  eq(paras[2].start, 4, '第三段偏移')
}

// ---------- 折行 ----------
{
  const lines = wrapParagraph('aaaa', 2)
  eq(lines, ['aaaa'], '整词放得下不拆')
  const long = wrapParagraph('aaaaaa', 2)
  eq(long, ['aaaa', 'aa'], '超长单词按字符硬切')
  const cjk = wrapParagraph('你我他', 2)
  eq(cjk, ['你我', '他'], '纯全角按宽度折')
}

// ---------- 分页 ----------
{
  // 4 个全角字一行、2 行一页：10 个全角字折成 3 行（4+4+2），2 页（8+2）
  const text = '一二三四五六七八九十'
  const pages = paginate(text, { charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(pages.length, 2, '10 字分 2 页')
  eq(pages[0].start, 0, '第一页偏移 0')
  eq(pages[1].start, 8, '第二页偏移 8')
}

{
  // 换行应被尊重：三行各一段，每页 1 行 → 3 页
  const text = '第一行\n第二行\n第三行'
  const pages = paginate(text, { charsPerLine: 20, linesPerPage: 1, indent: false })
  eq(pages.length, 3, '三段三页')
}

{
  // 段首缩进：正文前应加两个全角空格
  const text = '你好'
  const pages = paginate(text, { charsPerLine: 10, linesPerPage: 1, indent: true })
  ok(pages[0].text.indexOf('\u3000\u3000') === 0, '段首缩进两格')
}

{
  // 空文本：0 页，不崩溃
  eq(paginate('', {}), [], '空文本零页')
}

// ---------- 游标式 renderPage ----------
{
  const text = '一二三四五六七八九十'
  const p1 = renderPage(text, { from: 0, charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(p1.start, 0, 'renderPage 首页偏移 0')
  eq(p1.hasNext, true, '首页还有后续')
  // 第一页 2 行 × 4 字 = 8 字，第二页从偏移 8 开始
  const p2 = renderPage(text, { from: p1.end, charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(p2.start, 8, 'renderPage 第二页偏移 8')
  eq(p2.hasNext, false, '末页无后续')
  eq(p2.text, '九十', '末页剩余两字')
}

{
  // 游标式与全量分页结果一致
  const text = '一二三四五六七八九十'
  const all = paginate(text, { charsPerLine: 4, linesPerPage: 2, indent: false })
  const p1 = renderPage(text, { from: 0, charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(p1.text, all[0].text, '游标首页与全量第一页一致')
  const p2 = renderPage(text, { from: p1.end, charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(p2.text, all[1].text, '游标末页与全量末页一致')
}

// ---------- normalizeText ----------
{
  eq(normalizeText('a\r\nb'), 'a\nb', 'CRLF 归一')
  eq(normalizeText('a\rb'), 'a\nb', 'CR 归一')
  eq(normalizeText('a\nb'), 'a\nb', '无 CR 原样返回')
}

// ---------- 定位页码 ----------
{
  const text = '一二三四五六七八九十'
  const pages = paginate(text, { charsPerLine: 4, linesPerPage: 2, indent: false })
  eq(locatePage(pages, 0), 0, '偏移 0 在第 0 页')
  eq(locatePage(pages, 5), 0, '偏移 5 在第 0 页')
  eq(locatePage(pages, 8), 1, '偏移 8 在第 1 页')
  eq(locatePage(pages, 9), 1, '偏移 9 在第 1 页（最后一页）')
  eq(locatePage([], 0), 0, '空页返回 0')
}

// ---------- 进度百分比 ----------
{
  eq(progressPercent(50, 100), 50, '50/100 = 50%')
  eq(progressPercent(0, 0), 0, '0 字保护')
  eq(progressPercent(200, 100), 100, '越界钳制到 100')
}

// ---------- 书名 ----------
{
  eq(titleFromName('三国演义.txt'), '三国演义', '去后缀')
  eq(titleFromName('001. 序章.TXT'), '序章', '去序号前缀')
  eq(titleFromName('无扩展名'), '无扩展名', '无后缀保持原名')
}

// ---------- 书架归一化 ----------
{
  const good = normalizeLibrary([
    { id: 'a', path: '/p/a.txt', name: 'A', progress: 10, updatedAt: 1 },
    { bad: true },
    { id: 'b', path: '/p/b.txt', name: 'B', progress: 20, updatedAt: 2 }
  ])
  eq(good.length, 2, '过滤坏数据')
  eq(good[0].id, 'b', '最新阅读在前')
  eq(good[1].id, 'a', '旧的在后')
}

{
  // upsert：同 path 更新，新 path 追加
  const lib = normalizeLibrary([{ id: 'a', path: '/p/a.txt', name: 'A' }])
  const upd = upsertBook(lib, { id: 'a', path: '/p/a.txt', name: 'A', progress: 50 })
  eq(upd.length, 1, '更新不新增')
  eq(upd[0].progress, 50, '进度已更新')
  const add = upsertBook(lib, { id: 'x', path: '/p/x.txt', name: 'X' })
  eq(add.length, 2, '新书追加')
}

{
  // 关键回归：id 为空（运行时只拿 path 存进度）也必须能匹配更新，不能重复新增
  const lib = normalizeLibrary([{ id: 'a', path: '/p/a.txt', name: 'A', progress: 10 }])
  const upd = upsertBook(lib, { id: '', path: '/p/a.txt', name: 'A', progress: 80 })
  eq(upd.length, 1, '空 id 按 path 匹配不新增')
  eq(upd[0].progress, 80, '空 id 也能更新进度')
  eq(upd[0].id, 'a', '保留原 id')
}

{
  eq(bookAvailable({ path: '/p/a.txt' }), true, '有路径即可用')
  eq(bookAvailable({}), false, '无路径不可用')
}

// ---------- 设置归一化 ----------
{
  const s = normalizeSettings({})
  eq(s.fontSize, DEFAULT_SETTINGS.fontSize, '默认字号')
  eq(s.theme, 'dark', '默认主题')
  const clamped = normalizeSettings({ fontSize: 999, charsPerLine: 1 })
  eq(clamped.fontSize, 40, '字号钳制到上限')
  eq(clamped.charsPerLine, 20, '每行字数钳制到下限')
  const badTheme = normalizeSettings({ theme: 'hack' })
  eq(badTheme.theme, 'dark', '非法主题回退默认')
}

// ---------- 路径 ----------
{
  eq(normPath('a//b/'), 'a/b', '去重复斜杠与尾斜杠')
  eq(mkdirChain('/data', '/data/pentext/books'), ['/data', '/data/pentext', '/data/pentext/books'], '逐段建目录')
  eq(mkdirChain('/data', '/other'), ['/other'], '越界只建一级')
}

// ---------- 写后读回 ----------
{
  eq(judgeReadback('x', { ok: true, text: 'x' }).ok, true, '一致通过')
  eq(judgeReadback('x', { ok: true, text: 'y' }).ok, false, '不一致拒绝')
  eq(judgeReadback('x', { ok: true, text: '' }).ok, false, '空读回拒绝')
}

console.log('pass=' + pass + ' fail=' + fail)
if (fail) {
  console.log('失败项：')
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('全部通过 ✓')
