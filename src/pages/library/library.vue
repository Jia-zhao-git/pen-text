<template>
    <div class="lb-page">

        <div class="lb-top">
            <text class="lb-title">书架</text>
            <text class="lb-count">{{ books.length }} 本</text>
            <div class="lb-chip" @click="refresh"><text class="lb-chiptxt">刷新</text></div>
            <div class="lb-chip" @click="backToRead"><text class="lb-chiptxt">返回阅读</text></div>
        </div>

        <scroller class="lb-scroll" scroll-direction="vertical">
            <div v-for="(b, bi) in books" :key="b.path" class="lb-row" @click="open(b)">
                <text class="lb-name">{{ b.name }}</text>
                <text class="lb-meta">{{ metaText(b) }}</text>
            </div>
            <text v-if="!books.length" class="lb-empty">书库里还没有 .txt 文件\n用 adb push 到设备上再点「刷新」</text>
        </scroller>

    </div>
</template>

<script>
import { listBooks } from '../../services/books.js'
import { loadLibrary, saveLibrary } from '../../services/store.js'
import { titleFromName, upsertBook } from '../../lib/book.js'
import { publishOpen } from '../../lib/session.js'
import { navTo, log } from '../../services/platform.js'

export default {
    name: 'library',
    data() {
        return {
            books: [],
            lib: []
        }
    },
    mounted() {
        this.refresh()
    },
    methods: {
        async refresh() {
            const files = await listBooks()
            this.lib = await loadLibrary()
            // 把盘上的文件与已有元数据（进度）合并
            const byPath = {}
            for (const r of this.lib) byPath[r.path] = r
            this.books = files.map((f) => {
                const rec = byPath[f.path]
                if (rec) return Object.assign({}, rec, { name: rec.name || titleFromName(f.name) })
                return {
                    id: '', path: f.path, name: titleFromName(f.name),
                    addedAt: Date.now(), progress: 0, totalChars: f.size, updatedAt: 0
                }
            })
            log('library refresh ' + this.books.length + ' 本')
        },
        metaText(b) {
            const pct = b.totalChars ? Math.round((b.progress || 0) / b.totalChars * 100) : 0
            const size = (b.size ? Math.round(b.size / 1024) : 0)
            const sizeTxt = size > 0 ? (size + ' KB · ') : ''
            return sizeTxt + (pct > 0 ? '已读 ' + pct + '%' : '未开始')
        },
        async open(b) {
            // 记住进度：这次打开的是第几本，方便下次「返回阅读」直接回来
            const next = upsertBook(this.lib, Object.assign({}, b, { updatedAt: Date.now() }))
            saveLibrary(next)
            // 广播 + 跳转：index 实例一直存活，靠订阅收到要打开的书
            publishOpen(b.path)
            navTo('index', {})
        },
        backToRead() {
            navTo('index', {})
        }
    }
}
</script>

<style>
.lb-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
    position: relative;
}

.lb-top {
    height: 44px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.lb-title {
    font-size: 17px;
    color: #e8e8ee;
}

.lb-count {
    font-size: 13px;
    color: #7fd39a;
    margin-left: 10px;
    flex: 1;
}

.lb-chip {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
    margin-left: 8px;
}

.lb-chiptxt {
    font-size: 13px;
    color: #9a9aa8;
}

.lb-scroll {
    flex: 1;
}

.lb-row {
    height: 56px;
    flex-direction: row;
    align-items: center;
    padding-left: 16px;
    padding-right: 16px;
    border-bottom-width: 1px;
    border-bottom-color: #26262e;
}

.lb-name {
    font-size: 18px;
    color: #e0e0e8;
    flex: 1;
}

.lb-meta {
    font-size: 13px;
    color: #6a6a78;
}

.lb-empty {
    font-size: 16px;
    color: #6a6a78;
    margin: 24px 16px 0 16px;
}
</style>
