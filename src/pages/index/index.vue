<template>
    <div class="rd-page">

        <!-- 顶栏：书名 + 进度 + 返回书架 / 设置 -->
        <div class="rd-top">
            <div class="rd-chip" @click="backToLibrary"><text class="rd-chiptxt">书架</text></div>
            <text class="rd-title">{{ title }}</text>
            <text class="rd-progress">{{ progressText }}</text>
            <div class="rd-chip" @click="openSettings"><text class="rd-chiptxt">设置</text></div>
        </div>

        <!-- 正文区：当前页文本，顶部对齐，flex 自然换行由分页器保证不越界 -->
        <div class="rd-body">
            <text v-if="!book" class="rd-empty">还没有打开任何书\n点左上角「书架」选择或导入</text>
            <text v-else-if="loading" class="rd-empty">加载中…</text>
            <text v-else-if="loadError" class="rd-empty">{{ loadError }}</text>
            <text v-else class="rd-text" :style="textStyle">{{ pageText }}</text>
        </div>

        <!-- 底部：翻页 + 提示 -->
        <div class="rd-foot">
            <div :class="prevClass" @click="prevPage"><text :class="prevTxtClass">上一页</text></div>
            <text class="rd-pageinfo">{{ pageInfo }}</text>
            <div :class="nextClass" @click="nextPage"><text :class="nextTxtClass">下一页</text></div>
        </div>

    </div>
</template>

<script>
import { loadSettings } from '../../services/store.js'
import { listBooks } from '../../services/books.js'
import { readText, navTo, log } from '../../services/platform.js'
import { paginate, locatePage, progressPercent } from '../../lib/text.js'
import { titleFromName } from '../../lib/book.js'
import { requestOpen, consumeOpen } from '../../lib/session.js'
import { saveBookProgress, loadLibrary } from '../../services/store.js'

export default {
    name: 'index',
    data() {
        return {
            book: null,        // { path, name, totalChars }
            settings: null,
            raw: '',           // 全书文本（缓存，翻页不重复读盘）
            pages: [],
            pageIdx: 0,
            loading: false,
            loadError: ''
        }
    },
    computed: {
        title() {
            return this.book ? this.book.name : 'pen-text'
        },
        pageText() {
            return this.pages.length ? this.pages[this.pageIdx].text : ''
        },
        pageInfo() {
            if (!this.pages.length) return ''
            return (this.pageIdx + 1) + ' / ' + this.pages.length
        },
        progressText() {
            if (!this.book || !this.book.totalChars) return ''
            const cur = this.pages.length ? this.pages[this.pageIdx].start : 0
            return '已读 ' + progressPercent(cur, this.book.totalChars) + '%'
        },
        textStyle() {
            const s = this.settings || {}
            return {
                fontSize: (s.fontSize || 24) + 'px',
                lineHeight: (s.lineHeight || 26) + 'px'
            }
        },
        prevClass() {
            return this.pageIdx > 0 ? 'rd-btn' : 'rd-btn-off'
        },
        prevTxtClass() {
            return this.pageIdx > 0 ? 'rd-btntxt' : 'rd-btntxt-off'
        },
        nextClass() {
            return this.pageIdx < this.pages.length - 1 ? 'rd-btn' : 'rd-btn-off'
        },
        nextTxtClass() {
            return this.pageIdx < this.pages.length - 1 ? 'rd-btntxt' : 'rd-btntxt-off'
        }
    },
    mounted() {
        this.settings = null
        this.boot()
    },
    onShow() {
        // 从设置页返回：字号/行高变了要重新分页，用旧偏移定位回当前阅读位置。
        // 注意：本固件从子页面返回不触发 onShow（参考项目实测结论），所以设置页
        // 改完会直接广播，这里只在确实触发时兜底重读。
        this.reloadSettings()
    },
    methods: {
        async boot() {
            this.settings = await loadSettings()
            const target = consumeOpen()
            if (target) {
                await this.openBook(target)
                return
            }
            // 没有待打开的书：恢复上次读的那本（书架里 updatedAt 最新的）
            const lib = await loadLibrary()
            if (lib.length) {
                await this.openBook(lib[0].path)
                this.seekTo(lib[0].progress)
            }
        },
        async reloadSettings() {
            const s = await loadSettings()
            if (!s) return
            const changed = !this.settings ||
                s.fontSize !== this.settings.fontSize ||
                s.lineHeight !== this.settings.lineHeight ||
                s.charsPerLine !== this.settings.charsPerLine ||
                s.linesPerPage !== this.settings.linesPerPage ||
                s.indent !== this.settings.indent
            this.settings = s
            if (changed && this.raw) this.repaginate()
        },
        async openBook(path) {
            this.loading = true
            this.loadError = ''
            try {
                const text = await readText(path, 3)
                if (text === null || text === undefined) {
                    this.loadError = '读取失败：文件可能已不存在\n请回书架重新选择'
                    this.loading = false
                    return
                }
                this.raw = text
                this.book = {
                    path: path,
                    name: titleFromName(path),
                    totalChars: text.length
                }
                this.repaginate()
                this.saveProgress()
            } catch (e) {
                this.loadError = '读取失败：' + ((e && e.message) || e)
                log('openBook 失败 ' + this.loadError)
                this.loading = false
            }
        },
        repaginate() {
            const s = this.settings || {}
            this.pages = paginate(this.raw, {
                charsPerLine: s.charsPerLine,
                linesPerPage: s.linesPerPage,
                indent: s.indent
            })
            this.pageIdx = 0
            this.loading = false
        },
        seekTo(offset) {
            if (!this.pages.length) return
            this.pageIdx = locatePage(this.pages, offset)
        },
        prevPage() {
            if (this.pageIdx <= 0) return
            this.pageIdx--
            this.saveProgress()
        },
        nextPage() {
            if (this.pageIdx >= this.pages.length - 1) return
            this.pageIdx++
            this.saveProgress()
        },
        saveProgress() {
            if (!this.book || !this.pages.length) return
            const offset = this.pages[this.pageIdx].start
            saveBookProgress({
                id: '', // 由 store 内部 upsert 决定，path 匹配到即更新
                path: this.book.path,
                name: this.book.name,
                totalChars: this.book.totalChars,
                progress: offset,
                updatedAt: Date.now()
            })
        },
        backToLibrary() {
            this.saveProgress()
            navTo('library', {})
        },
        openSettings() {
            navTo('settings', {})
        }
    }
}
</script>

<style>
.rd-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
    position: relative;
}

.rd-top {
    height: 44px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.rd-chip {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
}

.rd-chiptxt {
    font-size: 13px;
    color: #9a9aa8;
}

.rd-title {
    font-size: 16px;
    color: #e8e8ee;
    flex: 1;
    margin-left: 10px;
    margin-right: 10px;
}

.rd-progress {
    font-size: 13px;
    color: #7fd39a;
    margin-right: 10px;
}

.rd-body {
    flex: 1;
    padding-left: 16px;
    padding-right: 16px;
    padding-top: 10px;
    padding-bottom: 6px;
}

.rd-text {
    font-size: 24px;
    color: #d8d8e0;
}

.rd-empty {
    font-size: 18px;
    color: #6a6a78;
}

.rd-foot {
    height: 48px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    background-color: #1e1e24;
}

.rd-btn {
    flex-direction: row;
    align-items: center;
    height: 30px;
    padding-left: 18px;
    padding-right: 18px;
    border-radius: 6px;
    background-color: #2f5c8a;
}

.rd-btn-off {
    flex-direction: row;
    align-items: center;
    height: 30px;
    padding-left: 18px;
    padding-right: 18px;
    border-radius: 6px;
    background-color: #2a2a33;
}

.rd-btntxt {
    font-size: 14px;
    color: #e8e8ee;
}

.rd-btntxt-off {
    font-size: 14px;
    color: #5a5a66;
}

.rd-pageinfo {
    font-size: 14px;
    color: #9a9aa8;
    margin-left: 16px;
    margin-right: 16px;
}
</style>
