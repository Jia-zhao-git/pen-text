<template>
    <div class="rd-page">

        <!-- 顶栏：沉浸式，默认隐藏，点击屏幕中间显示 -->
        <div v-if="showBars" class="rd-top">
            <div class="rd-chip" @click="backToLibrary"><text class="rd-chiptxt">书架</text></div>
            <text class="rd-title">{{ title }}</text>
            <text class="rd-progress">{{ progressText }}</text>
            <div class="rd-chip" @click="openSettings"><text class="rd-chiptxt">设置</text></div>
        </div>

        <!-- 正文区：滚动连续阅读。滚到底自动加载下一块。 -->
        <scroller ref="scroller" class="rd-scroll" scroll-direction="vertical" @scroll="onScroll">
            <div class="rd-content" ref="top" @click="toggleBars">
                <text v-if="!book" class="rd-empty">还没有打开任何书\n点左上角「书架」选择或导入</text>
                <text v-else-if="loading" class="rd-empty">加载中…</text>
                <text v-else-if="loadError" class="rd-empty">{{ loadError }}</text>

                <div v-else @click="toggleBars">
                    <div v-for="(p, pi) in renderedPages" :key="pi" class="rd-pageblock" :ref="'pb_' + pi">
                        <text class="rd-text" :style="textStyle">{{ p.text }}</text>
                    </div>
                    <text v-if="loadingMore" class="rd-loading">加载中…</text>
                    <text v-if="atEnd" class="rd-end">— 已到末尾 —</text>
                </div>
            </div>
        </scroller>

        <!-- 底栏：沉浸式，默认隐藏 -->
        <div v-if="showBars" class="rd-foot">
            <div class="rd-chip" @click="backToLibrary"><text class="rd-chiptxt">书架</text></div>
            <div class="rd-chip" @click="scrollToTop"><text class="rd-chiptxt">回顶部</text></div>
            <text class="rd-pageinfo">{{ pageInfo }}</text>
            <div :class="autoScrollClass" @click="toggleAutoScroll"><text class="rd-chiptxt">{{ autoScrollLabel }}</text></div>
            <div class="rd-chip" @click="openSettings"><text class="rd-chiptxt">设置</text></div>
        </div>

    </div>
</template>

<script>
import { loadSettings } from '../../services/store.js'
import { navTo, log } from '../../services/platform.js'
import { renderPage, normalizeText, progressPercent } from '../../lib/text.js'
import { titleFromName } from '../../lib/book.js'
import { subscribeOpen, consumeOpen } from '../../lib/session.js'
import { saveBookProgress, loadLibrary } from '../../services/store.js'
import { openReader, readChunk, chunkIndexForLine, lineStartOfChunk } from '../../services/reader.js'

const INITIAL_CHUNKS = 2

export default {
    name: 'index',
    data() {
        return {
            book: null,
            settings: null,
            renderedPages: [],   // [{ chunkIdx, start, text }]，start 是块内字符偏移
            nextChunkIdx: 0,
            loading: false,
            loadingMore: false,
            atEnd: false,
            loadError: '',
            // 进度：块索引 + 块内字符偏移（页级精确，不跨块累加）
            progressChunk: 0,
            progressOffset: 0,
            // 沉浸式 UI
            showBars: false,
            hideTimer: null,
            // 自动滚动：逐页 scrollToElement，autoPage 是当前目标页索引
            autoScroll: false,
            autoTimer: null,
            autoPage: 0
        }
    },
    computed: {
        title() {
            return this.book ? this.book.name : 'pen-text'
        },
        pageInfo() {
            if (!this.book || !this.book.chunkCount) return ''
            return '已读 ' + progressPercent(this.progressChunk, this.book.chunkCount) + '%'
        },
        progressText() {
            return this.pageInfo
        },
        textStyle() {
            const s = this.settings || {}
            return {
                fontSize: (s.fontSize || 24) + 'px',
                lineHeight: (s.lineHeight || 26) + 'px'
            }
        },
        autoScrollLabel() {
            return this.autoScroll ? '停止滚动' : '自动滚动'
        },
        autoScrollClass() {
            return this.autoScroll ? 'rd-chip rd-chip-on' : 'rd-chip'
        }
    },
    mounted() {
        this.settings = null
        this.unsubOpen = subscribeOpen((path) => {
            if (path) this.openBook(path)
        })
        this.boot()
    },
    unmounted() {
        if (this.unsubOpen) { this.unsubOpen(); this.unsubOpen = null }
        this.stopAutoScroll()
        if (this.hideTimer) clearTimeout(this.hideTimer)
    },
    onShow() {
        this.reloadSettings()
    },
    onHide() {
        this.saveProgress()
    },
    methods: {
        async boot() {
            this.settings = await loadSettings()
            const target = consumeOpen()
            if (target) {
                await this.openBook(target)
                return
            }
            const lib = await loadLibrary()
            if (lib.length) {
                await this.openBook(lib[0].path, lib[0].progressChunk, lib[0].progress)
            }
        },
        async reloadSettings() {
            const s = await loadSettings()
            if (!s) return
            this.applySettings(s)
        },
        // 应用新设置：字号/行高/每行字数/每页行数/缩进变化需要重新分页。
        applySettings(s) {
            const old = this.settings
            const relayout = !old ||
                s.fontSize !== old.fontSize ||
                s.lineHeight !== old.lineHeight ||
                s.charsPerLine !== old.charsPerLine ||
                s.linesPerPage !== old.linesPerPage ||
                s.indent !== old.indent
            this.settings = s
            if (relayout && this.book) {
                this.resetReader(this.progressChunk, this.progressOffset)
            }
        },
        async openBook(path, fromChunk, fromOffset) {
            this.loading = true
            this.loadError = ''
            try {
                const book = await openReader(path)
                if (!book || !book.chunkCount) {
                    this.loadError = '读取失败：文件无法切块\n请回书架重新选择'
                    this.loading = false
                    return
                }
                book.name = titleFromName(path)
                this.book = book
                const chunk = Number(fromChunk) || 0
                const offset = Number(fromOffset) || 0
                await this.resetReader(chunk, offset)
                this.saveProgress()
            } catch (e) {
                this.loadError = '读取失败：' + ((e && e.message) || e)
                log('openBook 失败 ' + this.loadError)
                this.loading = false
            }
        },
        // 从某块 + 块内偏移开始，重置渲染窗口
        async resetReader(fromChunk, fromOffset) {
            const s = this.settings || {}
            const opts = {
                charsPerLine: s.charsPerLine,
                linesPerPage: s.linesPerPage,
                indent: s.indent
            }
            this.renderedPages = []
            this.atEnd = false
            this.loading = false

            let startChunk = Math.max(0, Math.min(fromChunk, this.book.chunkCount - 1))
            this.nextChunkIdx = startChunk
            this.progressChunk = startChunk
            this.progressOffset = fromOffset || 0

            const loadCount = Math.min(INITIAL_CHUNKS, this.book.chunkCount - startChunk)
            for (let i = 0; i < loadCount; i++) {
                const idx = startChunk + i
                const text = await readChunk(this.book, idx)
                if (text === null || text === undefined) continue
                // 只有起始块需要从 fromOffset 开始，后续块从 0 开始
                const startAt = (idx === startChunk) ? (fromOffset || 0) : 0
                this.appendChunkPages(text, idx, startAt, opts)
                this.nextChunkIdx = idx + 1
            }
            this.atEnd = this.nextChunkIdx >= this.book.chunkCount
            this.loading = false
        },
        // 把一块文本从 startAt 偏移起分页，追加到渲染窗口
        appendChunkPages(text, chunkIdx, startAt, opts) {
            const s = this.settings || {}
            const o = opts || {
                charsPerLine: s.charsPerLine,
                linesPerPage: s.linesPerPage,
                indent: s.indent
            }
            const chunkText = normalizeText(text)
            let offset = startAt || 0
            let guard = 0
            while (offset < chunkText.length && guard < 10000) {
                const p = renderPage(chunkText, Object.assign({ from: offset }, o))
                if (!p.text && !p.hasNext) break
                this.renderedPages.push({ chunkIdx: chunkIdx, start: p.start, text: p.text })
                offset = p.end
                if (!p.hasNext) break
                guard++
            }
        },
        async appendNext() {
            if (this.atEnd || this.loadingMore || !this.book) return
            this.loadingMore = true
            try {
                const idx = this.nextChunkIdx
                if (idx >= this.book.chunkCount) {
                    this.atEnd = true
                    this.loadingMore = false
                    return
                }
                const text = await readChunk(this.book, idx)
                if (text !== null && text !== undefined) {
                    this.appendChunkPages(text, idx, 0, null)
                }
                this.nextChunkIdx = idx + 1
                this.atEnd = this.nextChunkIdx >= this.book.chunkCount
            } catch (e) {
                log('appendNext 失败 ' + (e && e.message ? e.message : e))
            } finally {
                this.loadingMore = false
            }
        },
        // 滚动事件：接近底部就追加下一块；同时用滚动偏移精确映射当前页作为进度。
        onScroll(e) {
            const offsetY = e && e.contentOffset ? Math.abs(e.contentOffset.y || 0) : 0
            const size = e && e.contentSize ? e.contentSize.height : 0
            if (this.atEnd === false && size > 0 && offsetY + 320 >= size) {
                this.appendNext()
            }
            this.trackVisiblePage(offsetY)
        },
        // 页高是确定性的：每页固定 linesPerPage 行 × lineHeight，加固定页间距。
        // 用「滚动偏移 ÷ 页高」精确算出当前可视页，作为进度（不再用预加载的最远页）。
        trackVisiblePage(offsetY) {
            if (!this.renderedPages.length) return
            const s = this.settings || {}
            const lineH = s.lineHeight || 26
            const lines = s.linesPerPage || 10
            const gap = 14
            const pageH = lineH * lines + gap
            // 可视区顶部落在哪个页块（offsetY 是相对内容顶的滚动量）
            let idx = Math.floor((offsetY + pageH * 0.5) / pageH)
            if (idx < 0) idx = 0
            if (idx >= this.renderedPages.length) idx = this.renderedPages.length - 1
            const page = this.renderedPages[idx]
            if (!page) return
            // 只在真正前进时更新（单调，避免回滚写 data）
            if (page.chunkIdx !== this.progressChunk || page.start !== this.progressOffset) {
                this.progressChunk = page.chunkIdx
                this.progressOffset = page.start
            }
        },
        saveProgress() {
            if (!this.book) return
            saveBookProgress({
                id: '',
                path: this.book.path,
                name: this.book.name,
                totalChars: this.book.totalChars,
                totalLines: this.book.totalLines,
                chunkCount: this.book.chunkCount,
                progressChunk: this.progressChunk,
                progress: this.progressOffset,
                updatedAt: Date.now()
            })
        },
        // ---------- 沉浸式 UI ----------
        toggleBars() {
            this.showBars = !this.showBars
            if (this.showBars) {
                this.scheduleHide()
            } else if (this.hideTimer) {
                clearTimeout(this.hideTimer)
                this.hideTimer = null
            }
        },
        scheduleHide() {
            if (this.hideTimer) clearTimeout(this.hideTimer)
            this.hideTimer = setTimeout(() => {
                this.showBars = false
                this.hideTimer = null
            }, 3000)
        },
        // ---------- 自动滚动 ----------
        toggleAutoScroll() {
            if (this.autoScroll) {
                this.stopAutoScroll()
            } else {
                this.startAutoScroll()
            }
        },
        startAutoScroll() {
            this.autoScroll = true
            this.scheduleHide()
            // 探测 scroller 实例是否支持 scrollTop 像素滚动
            this._pixelScroll = this.probeScrollTop()
            const self = this
            // 像素滚动用中等帧率小步进；逐页回退用慢节奏
            const interval = this._pixelScroll ? 100 : 900
            this.autoTimer = setInterval(() => {
                self.autoScrollTick()
            }, interval)
        },
        probeScrollTop() {
            try {
                const sc = this.$refs.scroller
                // 组件实例或其 $el 上找 scrollTop
                const inst = sc && sc.$el ? sc.$el : sc
                return inst && (typeof inst.scrollTop === 'number' || inst.scrollTop !== undefined)
            } catch (e) { return false }
        },
        autoScrollTick() {
            if (!this.autoScroll) return
            if (this._pixelScroll) {
                this.pixelScrollStep()
            } else {
                this.pageScrollStep()
            }
        },
        // 像素平滑滚动：直接递增 scrollTop（每 tick 2px，50ms → 40px/s）
        pixelScrollStep() {
            try {
                const sc = this.$refs.scroller
                const inst = sc && sc.$el ? sc.$el : sc
                if (!inst || typeof inst.scrollTop !== 'number') {
                    this._pixelScroll = false
                    return
                }
                inst.scrollTop = inst.scrollTop + 1
                // 到底就加载下一块
                if (this.atEnd === false && inst.scrollTop + 340 >= inst.scrollHeight) {
                    this.appendNext()
                }
                // 真到末尾（无更多块且滚到底）停止
                if (this.atEnd && inst.scrollTop + 20 >= inst.scrollHeight) {
                    this.stopAutoScroll()
                }
                // 同步进度到当前可视页
                this.trackVisiblePage(inst.scrollTop)
            } catch (e) { /* 忽略 */ }
        },
        // 逐页回退：滚到下一个 pageblock
        pageScrollStep() {
            if (this.autoPage >= this.renderedPages.length - 1) {
                if (this.atEnd) {
                    this.stopAutoScroll()
                    return
                }
                this.appendNext()
                return
            }
            this.autoPage++
            this.scrollToPage(this.autoPage)
            const page = this.renderedPages[this.autoPage]
            if (page) {
                this.progressChunk = page.chunkIdx
                this.progressOffset = page.start
            }
            this.saveProgress()
        },
        scrollToPage(index) {
            try {
                const refs = this.$refs['pb_' + index]
                const el = Array.isArray(refs) ? refs[0] : refs
                if (el && this.$page && this.$page.$dom && this.$page.$dom.scrollToElement) {
                    this.$page.$dom.scrollToElement(el, { offset: 0, animated: true })
                }
            } catch (e) { /* 忽略 */ }
        },
        stopAutoScroll() {
            this.autoScroll = false
            if (this.autoTimer) {
                clearInterval(this.autoTimer)
                this.autoTimer = null
            }
        },
        scrollToTop() {
            try {
                const el = this.$refs.top
                if (el && this.$page && this.$page.$dom && this.$page.$dom.scrollToElement) {
                    this.$page.$dom.scrollToElement(el)
                }
            } catch (e) { /* 忽略 */ }
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
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
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

.rd-chip-on {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #4ade80;
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

.rd-scroll {
    flex: 1;
}

.rd-content {
    padding-left: 16px;
    padding-right: 16px;
    padding-top: 10px;
    padding-bottom: 10px;
}

.rd-pageblock {
    margin-bottom: 14px;
}

.rd-text {
    font-size: 24px;
    color: #d8d8e0;
}

.rd-empty {
    font-size: 18px;
    color: #6a6a78;
}

.rd-loading {
    font-size: 15px;
    color: #6a6a78;
}

.rd-end {
    font-size: 15px;
    color: #6a6a78;
    margin-top: 8px;
}

.rd-foot {
    height: 48px;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    background-color: #1e1e24;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 10;
}

.rd-pageinfo {
    font-size: 14px;
    color: #9a9aa8;
    margin-left: 16px;
    margin-right: 16px;
}
</style>
