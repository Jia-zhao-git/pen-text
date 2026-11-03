#!/usr/bin/env node
// 出包前递增版本号。
//
// 为什么要有这一步：amr 文件名是 `<appid>.<x_y_z>.amr`，版本号不变的时候
// 新包和旧包在设备上、在 /userdisk 里长得一模一样，出了问题分不清装的是哪一版。
// 约定：每次改代码 / 修 bug 出包前先跑一次，patch 位 +1（0.1.0 → 0.1.1）。
//
// 用法:
//   node scripts/bump.js            // patch +1（默认）
//   node scripts/bump.js minor      // 0.1.3 → 0.2.0
//   node scripts/bump.js major      // 0.2.0 → 1.0.0
//   node scripts/bump.js 1.4.2      // 直接指定

const fs = require('fs')
const path = require('path')

const file = path.resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const cur = String(pkg.version || '0.0.0')
const arg = (process.argv[2] || 'patch').toLowerCase()

let next
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg
} else {
  const parts = cur.split('.').map((n) => parseInt(n, 10) || 0)
  const a = parts[0] || 0
  const b = parts[1] || 0
  const c = parts[2] || 0
  if (arg === 'major') next = a + 1 + '.0.0'
  else if (arg === 'minor') next = a + '.' + (b + 1) + '.0'
  else next = a + '.' + b + '.' + (c + 1)
}

if (next === cur) {
  console.log('[bump] 版本没变：' + cur)
  process.exit(0)
}

pkg.version = next
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')

// package-lock.json 里也有两处版本号（顶层 version 和 packages[""].version），
// 只改 package.json 会让两者越走越远；npm ci 不看这个字段，但人看着会以为没升版。
const lockFile = path.resolve(__dirname, '..', 'package-lock.json')
if (fs.existsSync(lockFile)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    lock.version = next
    if (lock.packages && lock.packages['']) lock.packages[''].version = next
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n')
    console.log('[bump] package-lock.json 已同步')
  } catch (e) {
    console.log('[bump] package-lock.json 同步失败（忽略）：' + e.message)
  }
}

// src/lib/appversion.js：运行期要能打出自己是哪一版（日志里靠它区分用户装的是哪版）
const verFile = path.resolve(__dirname, '..', 'src', 'lib', 'appversion.js')
if (fs.existsSync(path.dirname(verFile))) {
  const content = [
    '// 应用版本号：由 scripts/bump.js 自动写入，不要手改。',
    '// 单独放一个文件是因为运行期拿不到 package.json（包里没有），而日志里必须能看出',
    '// 用户装的是哪一版 —— 否则「0.1.9 有这个问题、0.1.11 修了」这类判断无从谈起。',
    "export const APP_VERSION = '" + next + "'",
    ''
  ].join('\n')
  fs.writeFileSync(verFile, content)
  console.log('[bump] appversion.js 已同步')
}

console.log('[bump] ' + cur + ' → ' + next)
console.log('[bump] 出包名：' + pkg.appid + '.' + next.replace(/\./g, '_') + '.amr')
