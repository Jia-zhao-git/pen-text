// 类型检查桩：让 tsc 有输入可检查（本文件不参与打包）。
// 只做最小断言，真正的逻辑测试在 test/run.mjs。

import fs from 'fs'
import globalModule from 'global'

const env = $falcon.env
const dir: string = $dataDir
const g = new globalModule.Global()

export function smoke(): string {
  try { g.execShell('true') } catch (e) { /* ignore */ }
  return String(env && env.deviceModel) + '@' + dir + ':' + typeof fs.readFile
}
