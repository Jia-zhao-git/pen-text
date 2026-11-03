<template>
    <div class="st-page">

        <div class="st-top">
            <div class="st-chip" @click="back"><text class="st-chiptxt">返回</text></div>
            <text class="st-title">阅读设置</text>
        </div>

        <scroller class="st-scroll" scroll-direction="vertical">

            <!-- 字号 -->
            <div class="st-sec">
                <text class="st-label">字号 {{ settings.fontSize }}px</text>
                <div class="st-stepper">
                    <div class="st-step" @click="step('fontSize', -2)"><text class="st-steptxt">−</text></div>
                    <div class="st-step" @click="step('fontSize', 2)"><text class="st-steptxt">＋</text></div>
                </div>
            </div>

            <!-- 行高 -->
            <div class="st-sec">
                <text class="st-label">行高 {{ settings.lineHeight }}px</text>
                <div class="st-stepper">
                    <div class="st-step" @click="step('lineHeight', -2)"><text class="st-steptxt">−</text></div>
                    <div class="st-step" @click="step('lineHeight', 2)"><text class="st-steptxt">＋</text></div>
                </div>
            </div>

            <!-- 每行字数 -->
            <div class="st-sec">
                <text class="st-label">每行字数 {{ settings.charsPerLine }}</text>
                <div class="st-stepper">
                    <div class="st-step" @click="step('charsPerLine', -2)"><text class="st-steptxt">−</text></div>
                    <div class="st-step" @click="step('charsPerLine', 2)"><text class="st-steptxt">＋</text></div>
                </div>
            </div>

            <!-- 每页行数 -->
            <div class="st-sec">
                <text class="st-label">每页行数 {{ settings.linesPerPage }}</text>
                <div class="st-stepper">
                    <div class="st-step" @click="step('linesPerPage', -1)"><text class="st-steptxt">−</text></div>
                    <div class="st-step" @click="step('linesPerPage', 1)"><text class="st-steptxt">＋</text></div>
                </div>
            </div>

            <!-- 段首缩进 -->
            <div class="st-sec" @click="toggleIndent">
                <text class="st-label">段首缩进两格</text>
                <text :class="indentClass">{{ indentLabel }}</text>
            </div>

            <!-- 主题 -->
            <div class="st-sec">
                <text class="st-label">配色主题</text>
                <div class="st-stepper">
                    <div v-for="(t, ti) in themes" :key="t.key" :class="themeClass(t.key)" @click="setTheme(t.key)">
                        <text :class="themeTxtClass(t.key)">{{ t.label }}</text>
                    </div>
                </div>
            </div>

        </scroller>

        <div class="st-foot">
            <text class="st-status">{{ status }}</text>
        </div>

    </div>
</template>

<script>
import { loadSettings, saveSettings, getLastSaveInfo } from '../../services/store.js'
import { publishSettings } from '../../lib/uistate.js'
import { navTo, log } from '../../services/platform.js'

export default {
    name: 'settings',
    data() {
        return {
            settings: null,
            status: '',
            themes: [
                { key: 'dark', label: '夜间' },
                { key: 'light', label: '白天' },
                { key: 'sepia', label: '羊皮纸' }
            ]
        }
    },
    computed: {
        indentLabel() {
            return this.settings && this.settings.indent ? '开' : '关'
        },
        indentClass() {
            return this.settings && this.settings.indent ? 'st-value-on' : 'st-value'
        }
    },
    mounted() {
        this.load()
    },
    methods: {
        async load() {
            this.settings = await loadSettings()
        },
        step(key, delta) {
            if (!this.settings) return
            const next = Object.assign({}, this.settings)
            next[key] = (next[key] || 0) + delta
            this.applyAndSave(next)
        },
        toggleIndent() {
            if (!this.settings) return
            const next = Object.assign({}, this.settings, { indent: !this.settings.indent })
            this.applyAndSave(next)
        },
        setTheme(key) {
            if (!this.settings) return
            this.applyAndSave(Object.assign({}, this.settings, { theme: key }))
        },
        themeClass(key) {
            const active = this.settings && this.settings.theme === key
            return active ? 'st-theme-on' : 'st-theme'
        },
        themeTxtClass(key) {
            const active = this.settings && this.settings.theme === key
            return active ? 'st-themetxt-on' : 'st-themetxt'
        },
        applyAndSave(next) {
            const saved = saveSettings(next)
            if (!saved) {
                const info = getLastSaveInfo()
                this.status = '保存失败：' + (info.reason || '未知原因')
                return
            }
            this.settings = saved
            publishSettings(saved)
            this.status = '已保存'
            setTimeout(() => { if (this.status === '已保存') this.status = '' }, 1600)
        },
        back() {
            navTo('index', {})
        }
    }
}
</script>

<style>
.st-page {
    width: 936px;
    height: 280px;
    flex-direction: column;
    background-color: #16161a;
    position: relative;
}

.st-top {
    height: 44px;
    flex-direction: row;
    align-items: center;
    padding-left: 12px;
    padding-right: 12px;
    background-color: #1e1e24;
}

.st-chip {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
}

.st-chiptxt {
    font-size: 13px;
    color: #9a9aa8;
}

.st-title {
    font-size: 16px;
    color: #e8e8ee;
    margin-left: 10px;
}

.st-scroll {
    flex: 1;
    padding-left: 16px;
    padding-right: 16px;
    padding-top: 8px;
}

.st-sec {
    flex-direction: row;
    align-items: center;
    height: 44px;
    border-bottom-width: 1px;
    border-bottom-color: #26262e;
}

.st-label {
    font-size: 16px;
    color: #d8d8e0;
    flex: 1;
}

.st-stepper {
    flex-direction: row;
    align-items: center;
}

.st-step {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 28px;
    border-radius: 6px;
    background-color: #2a2a33;
    margin-left: 8px;
}

.st-steptxt {
    font-size: 18px;
    color: #e8e8ee;
}

.st-value {
    font-size: 15px;
    color: #6a6a78;
}

.st-value-on {
    font-size: 15px;
    color: #7fd39a;
}

.st-theme {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #2a2a33;
    margin-left: 8px;
}

.st-theme-on {
    flex-direction: row;
    align-items: center;
    height: 26px;
    padding-left: 10px;
    padding-right: 10px;
    border-radius: 6px;
    background-color: #4ade80;
    margin-left: 8px;
}

.st-themetxt {
    font-size: 13px;
    color: #9a9aa8;
}

.st-themetxt-on {
    font-size: 13px;
    color: #0d1a12;
}

.st-foot {
    height: 36px;
    flex-direction: row;
    align-items: center;
    padding-left: 16px;
    background-color: #1e1e24;
}

.st-status {
    font-size: 13px;
    color: #f0b866;
}
</style>
