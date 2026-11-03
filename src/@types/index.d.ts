// 平台全局与模块声明（不依赖 @dictpen/types，只声明本工程真正用到的部分）

declare const $falcon: any
declare const $dataDir: string
declare const $workspace: string

declare module 'fs' {
  const fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: any): any
    mkdir(path: string): any
    exists(path: string): Promise<boolean>
    stat(path: string): Promise<{ size: number; mtimeMs?: number; atimeMs?: number; mtime?: number }>
    readdir(path: string): Promise<string[]>
  }
  export default fs
}

declare module 'global' {
  export class Global {
    execShell(cmd: string): boolean
    startTextEdit(config: string): any
    closeTextEdit(): any
    textEditFinished: {
      on(cb: (...args: any[]) => void): void
      off(cb: (...args: any[]) => void): void
    }
  }
  // 平台模块运行时以命名空间对象作为 default（参考项目即 `import globalModule from 'global'`），
  // 这里补上 default 声明，否则 rollup 的 TS 插件会报 TS1192 刷屏。
  const globalModule: { Global: typeof Global }
  export default globalModule
}

declare module '*.vue' {
  const c: any
  export default c
}
