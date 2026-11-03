# pen-text

运行在词典笔（HaaS UI / Falcon 小程序框架）上的 **TXT 阅读器**。

纯离线、无网络依赖，复用了 [deep-pen-api](https://github.com/Jia-zhao-git/deep-pen-api) 沉淀的词典笔平台脚手架（构建链、平台适配层、真机实测结论），把 AI 对话业务替换为阅读器业务。

- 逻辑分辨率 936 × 280（横屏小屏）
- 运行时 QuickJS，Vue 3 SFC，构建产物为 `.amr` 安装包
- 单测纯函数可在 Node 下跑，无需设备

## 功能

- 扫描设备固定目录里的 `.txt` 文件，形成书架（含已读进度）
- 确定性分页：按「全角字宽」估算折行，凑满一页即翻页，进度用「页首字符偏移」记录，改字号后仍能定位回原处
- 断点续读：退出 / 翻页自动落盘进度，重进恢复上次读的书
- 阅读设置：字号、行高、每行字数、每页行数、段首缩进、三套配色主题
- 应用日志落盘 + 写后回读校验（沿用平台层的稳定性保障）

## 目录结构

```
src/
  app.js / app.json        入口与页面注册
  pages/
    index/     阅读页：正文、翻页、进度
    library/   书架：扫描 txt、选择打开
    settings/  阅读设置
  lib/         纯函数，可直接 Node 下单测
    text.js    分页核心（折行 / 分页 / 定位 / 百分比）
    book.js    书籍与书架结构
    settings.js 设置结构 + 归一化
    paths.js / savecheck.js / logfile.js / uistate.js / session.js / appversion.js
  services/    有副作用的一层
    platform.js fs / global / $falcon / $dataDir 差异收敛
    store.js   本地存储：settings / library
    books.js   扫描设备 txt 文件
scripts/
  build.js     审计 → 单测 → rollup → qjsc → manifest → amr
  patch-cli.mjs aiot-vue-cli 兼容补丁（Node 实现，跨平台，自动执行）
  bump.js      版本号
test/run.mjs   纯函数回归
```

## 构建

```bash
npm install
npm test          # 纯函数单测，无需设备
npm run build     # 开发包
npm run build:prod  # 生产包
```

产物固定为 `<appid>.<版本>.amr`（appid `8000000000182400`）。装到设备：

```bash
adb connect <ip>:5555
adb shell "miniapp_cli install <appid>.<版本>.amr"
adb shell "miniapp_cli start <appid>"
```

改代码先 `npm run bump`（默认 patch +1），再 build。

## 导入书籍

词典笔没有通用文件选择器，书要靠 `adb push` 放进设备固定目录，应用扫描读取。优先级如下：

1. `$dataDir/pentext/books/`（推荐）
2. `/userdisk/Favorite/`
3. `/userdisk/`（根目录，只取一级）

例如：

```bash
adb push 三国演义.txt /userdisk/Favorite/
```

推完回应用点「书架 → 刷新」。

## 平台事实（沿用自 deep-pen-api 的实测结论）

- `<text>` 不能有元素子节点，否则 libfalcon.so 断言失败 abort 整个进程 —— 所以正文始终是单层 `<text>`
- 本机 `fs.writeFile` 是同步的，且目录不存在时「不报错也不落盘」—— 所以写入后要回读校验
- 从子页面返回不触发 onShow —— 跨页状态走 `lib/uistate.js` / `lib/session.js` 模块单例
- `fs.writeFile` 的 `await` 反而卡住事件循环

## 已知限制

- 只支持 `.txt` 纯文本，暂不支持 epub / mobi（QuickJS 无通用解压能力）
- 分页是「全角字宽」估算，非像素级精确排版，遇到中西文混排的极端行长会有轻微误差
- 长段落（超过一页）按字符切页，段首缩进只在段落起始页生效

## License

MIT（本项目代码）。`aiot-vue-cli`、`falcon-ui` 等第三方依赖遵循各自许可，详见 deep-pen-api 的第三方说明。
