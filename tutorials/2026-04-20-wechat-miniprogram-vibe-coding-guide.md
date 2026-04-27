---
title: "微信小程序 AI 辅助开发完整路线图（Vibe Coding 版）"
category: "miniprogram"
categoryName: "小程序开发"
date: "2026-04-20"
tags: ["小程序", "微信小程序", "Vibe Coding", "AI开发", "Cursor", "云开发", "MiniMax"]
description: "从零掌握微信小程序开发，融入 AI 辅助工具链，以 Vibe Coding 理念驱动，用 Cursor + 云开发 + AI API 从零构建一个 AI 工具箱小程序。"
---

# 微信小程序 AI 辅助开发完整路线图（Vibe Coding 版）

> 面向有编程基础的开发者 | 技术栈：微信小程序 + 云开发 + AI API | 核心理念：**Vibe Coding**（用 AI 驱动开发效率）

---

## 一、Vibe Coding 是什么？

传统开发流程：产品需求 → 设计稿 → 写代码 → 调试 → 重复。

**Vibe Coding** 的核心理念：**你描述需求，AI 帮你写代码**。你专注于"做什么"，而不是"怎么做"。

在小程序开发中，Vibe Coding 的工作流：

```
你："帮我做一个 AI 摘要工具，用户输入文字，一键生成摘要"
   ↓
Cursor / Claude：生成完整的 WXML + JS + 云函数
   ↓
你：微调样式和逻辑
   ↓
发布
```

这不是"AI 替代程序员"，而是**程序员变成 AI 的指挥官**，效率提升 3-5 倍。

---

## 二、开发工具链

### 2.1 主力工具矩阵

| 场景 | 推荐工具 | 用途 |
|------|---------|------|
| 代码编写 | **Cursor** | AI 生成 WXML/JS/WXSS，支持 Agent 模式 |
| 云函数 | **微信开发者工具** | 编写、调试、部署云开发函数 |
| AI 对话 | **Claude / ChatGPT** | 生成业务逻辑、算法思路 |
| AI API | **MiniMax / 硅基流动** | 小程序调用的生成式 AI 接口 |
| 低代码 | **Coze** | 快速搭对话机器人，嵌入小程序 |
| 版本控制 | **GitHub + Cursor** | 代码管理和协作 |

### 2.2 Cursor 使用技巧

Cursor 是目前最适合 Vibe Coding 的 IDE，内置 Claude 和 GPT 模型。

**核心快捷键：**

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + L` | 打开对话面板，描述需求生成代码 |
| `Cmd/Ctrl + K` | 选中代码后重写、解释、翻译 |
| `Cmd/Ctrl + Enter` | **Agent 模式**，AI 自动生成完整文件 |
| `Tab` | 下一行 AI 智能补全 |
| `@` 符号 | 引用文件或文档到上下文 |

**Cursor 在小程序中的典型用法：**

```
# 初始化项目结构
Cmd/Ctrl + L → "帮我创建一个小程序 AI 工具箱项目结构：
  - app.js / app.json / app.wxss
  - 三个页面：首页(工具列表) / AI生成页 / 我的页面
  - 使用云开发模式
  - 包含工具分类：文本处理、图片识别、语音合成"

# 编写具体页面
Cmd/Ctrl + K（选中现有代码）→ "把这个页面改成支持深色模式"

# Agent 模式构建组件
Cmd/Ctrl + Enter → "创建 pages/tools/text-summary/index，
  包含：textarea输入框、"生成摘要"按钮、调用云函数显示结果"
```

### 2.3 MiniMax API 接入

MiniMax 提供高性价比的文本和语音生成 API，适合小程序调用。

```javascript
// 云函数：调用 MiniMax API 生成内容
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 通过云函数调用 MiniMax（保护 API Key 不暴露在前端）
exports.main = async (event, context) => {
  const { prompt, type = 'text' } = event

  const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_pro', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.MINIMAX_API_KEY
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    })
  })

  const data = await response.json()
  return { result: data.choices[0].message.content }
}
```

---

## 三、微信小程序三件套基础

### 3.1 技术架构

微信小程序是**双线程架构**，渲染层和逻辑层分离：

```
┌─────────────────────────────────┐
│         渲染层（WebView）         │
│  WXML → Virtual DOM → 真实 DOM  │
│  WXSS → 样式处理 → 渲染树        │
└─────────────────────────────────┘
              ↕ WeixinJSBridge
┌─────────────────────────────────┐
│       逻辑层（JavaScriptCore）     │
│  app.js / Page / 业务逻辑        │
└─────────────────────────────────┘
```

### 3.2 WXML — 结构层

WXML 是小程序的标签语言，类似简化版 HTML，但**不支持 DOM 操作**。

**核心标签：**

```xml
<!-- 容器 -->
<view>           <!-- 块级容器（类似 div）-->
<text>           <!-- 行内文本（类似 span）-->
<image>          <!-- 图片，自动压缩 -->
<navigator>      <!-- 页面跳转（类似 <a>）-->
<block>          <!-- 包装元素，不渲染 -->

<!-- 表单 -->
<input>          <!-- 输入框 -->
<textarea>       <!-- 多行输入 -->
<button>         <!-- 按钮 -->
<picker>          <!-- 选择器 -->
<checkbox>       <!-- 多选 -->
<radio>          <!-- 单选 -->

<!-- 列表渲染（核心）-->
<block wx:for="{{tools}}" wx:key="id">
  <view>{{item.name}}</view>
</block>

<!-- 条件渲染 -->
<view wx:if="{{hasResult}}">显示结果</view>
<view wx:elif="{{loading}}">加载中...</view>
<view wx:else>暂无数据</view>
```

**Mustache 数据绑定：**

```xml
<view>{{title}}</view>
<view data-id="{{toolId}}">ID: {{toolId}}</view>
<input value="{{inputText}}" bindinput="onInput" />
<button bindtap="onSubmit">提交</button>
```

### 3.3 WXSS — 样式层

WXSS 是 CSS 超集，新增了 **rpx 响应式单位**。

**rpx 原理：** 屏幕宽度固定为 750rpx，根据设备自动换算。

| 设备 | 屏幕宽度 | 1rpx ≈ |
|------|---------|--------|
| iPhone 6/7/8 | 375px | 0.5px |
| iPhone 14 Pro | 393px | 0.524px |
| Android 通用 | 360px | 0.48px |

```css
/* 推荐：宽高用 rpx，保持响应式 */
.box {
  width: 750rpx;       /* 全屏宽 */
  height: 200rpx;
  padding: 24rpx;
  font-size: 28rpx;     /* 字号也用 rpx */
  margin-bottom: 24rpx;
}

/* flex 是主力布局 */
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* grid 处理复杂卡片 */
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24rpx;
}

/* 选择器支持有限，注意 */
.avatar { }     /* ✅ 类选择 */
#logo { }       /* ✅ ID选择 */
view { }         /* ✅ 标签选择 */
view.active { } /* ✅ 后代选择 */
/* ⚠️ 不支持：兄弟选择器、属性选择器部分 */
```

### 3.4 JavaScript — 逻辑层

**应用级生命周期：**

```javascript
// app.js
App({
  onLaunch() {
    // 小程序初始化，全局只触发一次
    wx.cloud.init({ env: 'your-env-id' })
    this.checkLogin()
  },
  onShow() { },    // 从后台进入前台
  onHide() { },    // 进入后台
  globalData: {
    userInfo: null,
    apiBase: 'https://api.example.com'
  }
})
```

**页面级生命周期：**

```javascript
// pages/index/index.js
Page({
  data: {
    title: 'AI 工具箱',
    tools: [],
    loading: false
  },

  onLoad(options) {
    // 页面加载，只触发一次
    this.fetchTools()
  },

  onReady() {
    // 渲染完成，可操作 canvas
  },

  onPullDownRefresh() {
    // 下拉刷新
    this.fetchTools().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    // 上拉加载更多
    this.loadMore()
  },

  onShareAppMessage() {
    return { title: 'AI 工具箱', path: '/pages/index/index' }
  },

  // 自定义方法
  fetchTools() {
    return wx.cloud.callFunction({ name: 'get_tools' })
      .then(res => this.setData({ tools: res.result.data }))
  }
})
```

**常用 API：**

```javascript
// 调用云函数
wx.cloud.callFunction({
  name: 'generate_text',
  data: { prompt: '写一首诗' }
}).then(res => this.setData({ result: res.result }))

// 选择图片
wx.chooseMedia({
  count: 1,
  mediaType: ['image'],
  success: res => this.uploadImage(res.tempFiles[0].tempFilePath)
})

// 显示加载提示
wx.showLoading({ title: '生成中...' })
wx.hideLoading()
wx.showToast({ title: '成功', icon: 'success' })
```

---

## 四、云开发 vs 传统开发

### 4.1 选择建议

| 对比项 | 云开发 | 传统开发 |
|--------|--------|---------|
| 后端 | 云函数+云数据库 | 自建服务器 |
| 存储 | 云存储 | 自建 OSS/COS |
| 维护成本 | 低 | 高 |
| 适合场景 | AI 小工具、内容类 | 电商、企业系统 |
| 扩展性 | 有限 | 灵活 |
| 免费额度 | 每月有限 | 自费 |

**AI 工具箱 → 强烈推荐云开发**，省去服务器搭建，直接调用云函数对接 AI API。

### 4.2 云开发初始化

```javascript
// app.js
App({
  onLaunch() {
    wx.cloud.init({
      env: 'miniprogram-xxxx',  // 替换为你的云环境 ID
      traceUser: true
    })
  }
})
```

### 4.3 云数据库设计示例

```javascript
// tools 集合结构
{
  _id: 'tool_001',
  name: 'AI 摘要',
  icon: '📝',
  description: '一键提取文章要点',
  category: 'text',
  api: 'text_summary',
  usage_count: 0,
  create_time: 1713000000000
}
```

---

## 五、从零构建 AI 工具箱小程序

### 5.1 项目结构

```
ai-toolbox/
├── app.js              # 全局逻辑
├── app.json            # 全局配置（tabBar、页面路由）
├── app.wxss            # 全局样式
├── project.config.json
├── cloudfunctions/     # 云函数目录
│   ├── generate_text/  # 文本生成云函数
│   ├── generate_image/ # 图片生成云函数
│   └── get_tools/      # 获取工具列表
└── pages/
    ├── index/          # 首页 - 工具列表
    │   ├── index.wxml
    │   ├── index.wxss
    │   └── index.js
    ├── generate/       # AI 生成页面
    │   ├── generate.wxml
    │   ├── generate.wxss
    │   └── generate.js
    └── mine/            # 我的页面
        ├── mine.wxml
        ├── mine.wxss
        └── mine.js
```

### 5.2 全局配置 app.json

```json
{
  "pages": [
    "pages/index/index",
    "pages/generate/generate",
    "pages/mine/mine"
  ],
  "window": {
    "navigationBarBackgroundColor": "#050505",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#050505",
    "backgroundTextStyle": "dark"
  },
  "tabBar": {
    "color": "#666666",
    "selectedColor": "#38bdf8",
    "backgroundColor": "#0d0d0d",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/index/index", "text": "工具", "iconPath": "icons/tool.png", "selectedIconPath": "icons/tool-active.png" },
      { "pagePath": "pages/generate/generate", "text": "AI", "iconPath": "icons/ai.png", "selectedIconPath": "icons/ai-active.png" },
      { "pagePath": "pages/mine/mine", "text": "我的", "iconPath": "icons/mine.png", "selectedIconPath": "icons/mine-active.png" }
    ]
  }
}
```

### 5.3 首页（工具列表）

```xml
<!-- pages/index/index.wxml -->
<view class="container">
  <view class="header">
    <text class="title">AI 工具箱</text>
    <text class="subtitle">让 AI 帮你高效工作</text>
  </view>

  <!-- 分类标签 -->
  <scroll-view scroll-x class="category-scroll">
    <view class="category-list">
      <view
        wx:for="{{categories}}"
        wx:key="id"
        class="category-item {{activeCategory == item.id ? 'active' : ''}}"
        bindtap="onCategoryTap"
        data-id="{{item.id}}"
      >{{item.name}}</view>
    </view>
  </scroll-view>

  <!-- 工具卡片列表 -->
  <view class="tools-grid">
    <view
      wx:for="{{filteredTools}}"
      wx:key="id"
      class="tool-card"
      bindtap="onToolTap"
      data-tool="{{item}}"
    >
      <view class="tool-icon">{{item.icon}}</view>
      <view class="tool-name">{{item.name}}</view>
      <view class="tool-desc">{{item.description}}</view>
    </view>
  </view>
</view>
```

```javascript
// pages/index/index.js
const app = getApp()

Page({
  data: {
    categories: [
      { id: 'all', name: '全部' },
      { id: 'text', name: '文本' },
      { id: 'image', name: '图片' },
      { id: 'voice', name: '语音' }
    ],
    activeCategory: 'all',
    tools: [],
    filteredTools: []
  },

  onLoad() {
    this.fetchTools()
  },

  onPullDownRefresh() {
    this.fetchTools().finally(() => wx.stopPullDownRefresh())
  },

  async fetchTools() {
    wx.showLoading()
    try {
      const res = await wx.cloud.callFunction({ name: 'get_tools' })
      this.setData({ tools: res.result.data, filteredTools: res.result.data })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    const tools = id === 'all'
      ? this.data.tools
      : this.data.tools.filter(t => t.category === id)
    this.setData({ activeCategory: id, filteredTools: tools })
  },

  onToolTap(e) {
    const tool = e.currentTarget.dataset.tool
    wx.navigateTo({
      url: `/pages/generate/generate?tool=${tool.api}&name=${tool.name}`
    })
  }
})
```

### 5.4 AI 生成页面（核心）

```xml
<!-- pages/generate/generate.wxml -->
<view class="container">
  <view class="input-section">
    <textarea
      class="input-area"
      placeholder="输入你想让 AI 处理的内容..."
      bindinput="onInput"
      value="{{inputText}}"
      maxlength="{{maxLength}}"
    />
    <view class="char-count">{{inputText.length}} / {{maxLength}}</view>
  </view>

  <view class="action-section">
    <button
      class="generate-btn"
      bindtap="onGenerate"
      disabled="{{loading || !inputText}}"
    >
      <text wx:if="{{!loading}}">🚀 {{toolName}}</text>
      <text wx:else>生成中...</text>
    </button>
  </view>

  <view wx:if="{{result}}" class="result-section">
    <view class="result-header">
      <text class="result-title">生成结果</text>
      <button class="copy-btn" bindtap="onCopy">复制</button>
    </view>
    <view class="result-content">{{result}}</view>
  </view>
</view>
```

```javascript
// pages/generate/generate.js
Page({
  data: {
    inputText: '',
    result: '',
    loading: false,
    maxLength: 2000,
    toolName: 'AI 生成'
  },

  onLoad(options) {
    if (options.name) this.setData({ toolName: options.name })
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  async onGenerate() {
    if (!this.data.inputText) return

    this.setData({ loading: true, result: '' })
    wx.showLoading({ title: 'AI 思考中...' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'generate_text',
        data: {
          prompt: this.data.inputText,
          type: 'summary'
        }
      })
      this.setData({ result: res.result.result })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '生成失败，请重试', icon: 'error' })
    } finally {
      this.setData({ loading: false })
      wx.hideLoading()
    }
  },

  onCopy() {
    wx.setClipboardData({
      data: this.data.result,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
```

### 5.5 云函数：generate_text

```javascript
// cloudfunctions/generate_text/index.js
const cloud = require('wx-server-sdk')
const fetch = require('node-fetch')  // 云函数内置

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 从云环境变量获取 API Key（安全）
const API_KEY = process.env.MINIMAX_API_KEY
const API_BASE = 'https://api.minimax.chat/v1'

exports.main = async (event, context) => {
  const { prompt, type = 'text' } = event

  if (!API_KEY) {
    return { error: 'API 未配置' }
  }

  try {
    // 调用 MiniMax 文本生成 API
    const response = await fetch(`${API_BASE}/text/chatcompletion_pro`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          {
            role: 'system',
            content: '你是一个专业、高效的 AI 助手。请根据用户输入生成高质量的摘要/回答。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    })

    const data = await response.json()

    if (data.error) {
      return { error: data.error.message }
    }

    return {
      result: data.choices[0].message.content,
      tokens_used: data.usage.total_tokens
    }
  } catch (err) {
    console.error('MiniMax API error:', err)
    return { error: '服务调用失败，请稍后重试' }
  }
}
```

**云函数目录结构：**

```
cloudfunctions/
└── generate_text/
    ├── index.js
    ├── package.json
    └── package-lock.json
```

```json
// package.json
{
  "dependencies": {
    "wx-server-sdk": "~3.0.0",
    "node-fetch": "~2.6.0"
  }
}
```

---

## 六、Vibe Coding 实战工作流

### 6.1 用 Cursor 从零生成项目

打开 Cursor，Cmd/Ctrl + L：

```
帮我创建一个微信小程序 AI 工具箱项目：

项目名：AI 工具箱
技术栈：微信小程序 + 云开发 + MiniMax API

页面：
1. 首页 - 工具卡片网格布局，支持分类筛选
2. AI 生成页 - textarea 输入 + AI 生成按钮 + 结果展示
3. 我的 - 用户信息、使用统计

功能：
- 文本摘要生成（调用云函数）
- 图片描述生成（调用云函数）
- 语音转文字（调用云函数）

样式：
- 深色主题，背景 #050505，主色 #38bdf8（青色）
- 卡片圆角 24rpx，hover 效果
- 字体用 General Sans（CDN 引入）

请生成完整的页面 WXML、JS、WXSS 文件，以及 app.js 和 app.json 配置。
```

### 6.2 微调与调试

Cursor 生成代码后，在微信开发者工具中：
1. **真机调试** — 工具栏点击"真机调试"，扫码体验真实效果
2. **console.log** — 在关键逻辑加日志，排查问题
3. **network 面板** — 查看云函数调用是否正常

### 6.3 AI 辅助调试技巧

遇到报错，把错误信息丢给 Cursor：

```
Cursor Cmd/Ctrl+L → "微信小程序报错：fail function not found，
云函数 generate_text 部署后无法调用，请帮我排查"
```

---

## 七、发布上线流程

### 7.1 发布前检查清单

- [ ] 微信开发者工具中无报错和警告
- [ ] 所有云函数已上传并部署
- [ ] app.json 中 tabBar 图标已替换（需上传到云存储）
- [ ] 隐私协议弹窗已处理（project.config.json 配置）
- [ ] 深色模式在真机上测试正常
- [ ] 分享功能已配置

### 7.2 云函数部署

```bash
# 在微信开发者工具中：
# 1. 右键 cloudfunctions 文件夹
# 2. 选择"上传并部署：云端安装依赖"
# 3. 等待部署完成
```

或在云开发控制台手动上传。

### 7.3 提交审核

1. 微信开发者工具 → **上传**（版本号，如 1.0.0）
2. 登录 [微信公众平台](https://mp.weixin.qq.com/)
3. 管理后台 → 版本管理 → 提交审核
4. 填写**功能页面截图**和**隐私说明**（AI 类小程序需特别注意）
5. 等待微信团队审核（通常 2-7 个工作日）

### 7.4 加速审核建议

- 小程序有实际功能（非空壳）
- 截图清晰，展示真实界面
- 隐私协议合规（调用 AI API 需说明数据用途）
- 第一版不要加太多功能，核心功能先上线

---

## 八、学习路线图总结

```
Week 1：基础入门
  ├── 熟悉微信开发者工具
  ├── WXML / WXSS / JS 三件套速通
  ├── 实现一个简单工具页面（计数器/BMI）
  └── 学会真机调试

Week 2：云开发
  ├── 云函数编写与部署
  ├── 云数据库 CRUD 操作
  ├── 云存储上传图片
  └── 接通第一个 AI API（MiniMax）

Week 3：Vibe Coding 提效
  ├── Cursor Agent 模式熟练使用
  ├── AI 生成 WXML + JS 完整页面
  ├── AI 辅助调试报错
  └── 构建 AI 工具箱核心功能

Week 4：上线与优化
  ├── 深色模式、响应式适配
  ├── 性能优化（图片懒加载、setData 优化）
  ├── 提交审核、发布第一版
  └── 收集用户反馈、迭代功能
```

**记住：Vibe Coding 的关键是"描述清楚需求"。花 2 分钟写好 prompt，省 20 分钟调试时间。AI 是你的副驾驶，不是替代你。** 🚀

---

## 九、从零动手实操（完整项目复刻）

下面带你一步一步创建一个「AI 摘要助手」小程序，完整走完从 0 到上线的全流程。

### 9.1 环境准备

**需要安装的工具：**

| 工具 | 下载地址 | 用途 |
|------|---------|------|
| 微信开发者工具 | https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html | 开发、调试、预览、上传 |
| VS Code / Cursor | https://cursor.sh | AI 辅助写代码 |
| Node.js | https://nodejs.org | 云函数运行环境 |

**注册小程序账号：**

1. 打开 https://mp.weixin.qq.com/ 注册
2. 选择「个人」或「企业」主体（个人也能发布部分类目）
3. 获取 AppID（开发阶段可用测试号）
4. 设置云开发环境（免费额度足够个人使用）

### 9.2 项目初始化

**方式一：微信开发者工具直接创建**

1. 打开微信开发者工具 → 新建项目
2. 选择「云开发」模板（推荐，有免费云资源）
3. 填写 AppID（或使用测试号）
4. 项目名称填写「ai-summary」

**方式二：Cursor + AI 快速生成结构**

打开 Cursor，Cmd/Ctrl + L，输入：

```
帮我创建一个小程序 AI 摘要助手项目，包含：

1. 三个页面：首页（输入文本）、结果页（展示摘要）、我的（历史记录）
2. app.json 配置 tabBar
3. app.js 初始化云开发 wx.cloud.init()
4. 云函数：summarize_text，调用 MiniMax API 生成摘要

配色：深色主题，主色 #38bdf8，背景 #050505

请生成每个页面的 wxml / wxss / js 文件内容。
```

Cursor 会生成完整代码结构，复制到对应文件即可。

### 9.3 云函数接入 MiniMax API

**Step 1：在云开发控制台创建云环境**

1. 登录微信公众平台 → 开发 → 云开发
2. 点击「设置」→ 环境配置 → 创建环境（如 `prod-1a2b3c`）
3. 记住环境 ID，后面要用

**Step 2：编写云函数**

在微信开发者工具中：

1. 右键 `cloudfunctions` 文件夹 → 新建云函数 → 命名 `summarize`
2. 编辑 `index.js`：

```javascript
// cloudfunctions/summarize/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 自动使用当前环境

// 环境变量中配置 API Key（安全）
// 在云开发控制台 → 设置 → 环境变量 中添加
const API_KEY = process.env.MINIMAX_API_KEY

exports.main = async (event, context) => {
  const { text, maxLength = 200 } = event

  if (!text || text.trim().length === 0) {
    return { success: false, error: '输入内容不能为空' }
  }

  if (text.length < 20) {
    return { success: false, error: '内容太短，请输入至少20个字' }
  }

  try {
    const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_pro', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [
          {
            role: 'system',
            content: `你是一个专业的文本摘要助手。请将用户输入的文本精简为 ${maxLength} 字以内的摘要，保留核心信息和关键观点。用简洁清晰的语言输出。`
          },
          { role: 'user', content: text }
        ],
        temperature: 0.5,
        max_tokens: 500
      })
    })

    const data = await response.json()

    if (data.error) {
      return { success: false, error: data.error.message || 'API 调用失败' }
    }

    return {
      success: true,
      result: data.choices[0].message.content,
      originalLength: text.length,
      summaryLength: data.choices[0].message.content.length
    }
  } catch (err) {
    console.error('MiniMax API error:', err)
    return { success: false, error: '服务暂时不可用，请稍后重试' }
  }
}
```

**Step 3：部署云函数**

1. 右键 `summarize` 云函数文件夹
2. 选择「上传并部署：云端安装依赖」
3. 在云开发控制台 → 环境变量中添加 `MINIMAX_API_KEY`

**Step 4：本地调试云函数**

在云函数目录下创建 `test.js`：

```javascript
// 本地测试云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: '你的环境ID' })

// 模拟调用
cloud.callFunction({
  name: 'summarize',
  data: { text: '人工智能技术的发展历程可以追溯到20世纪50年代，经过多次起伏，近年来随着深度学习技术的突破，AI在图像识别、自然语言处理等领域取得了显著进展。目前，大语言模型成为AI发展的重要方向，推动着通用人工智能的研究进程。' },
  success: res => console.log('成功:', res),
  fail: err => console.error('失败:', err)
})
```

### 9.4 前后端联调

**前端调用云函数：**

```javascript
// pages/index/index.js
Page({
  data: {
    inputText: '',
    summary: '',
    loading: false
  },

  // 监听输入
  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  // 点击生成摘要
  async onSummarize() {
    const { inputText } = this.data

    if (!inputText.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    this.setData({ loading: true, summary: '' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'summarize',
        data: { text: inputText }
      })

      if (res.result.success) {
        this.setData({ summary: res.result.result })
        // 保存到历史记录
        this.saveToHistory(inputText, res.result.result)
      } else {
        wx.showToast({ title: res.result.error, icon: 'none' })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '网络错误', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 保存到历史记录（localStorage）
  saveToHistory(original, summary) {
    const history = wx.getStorageSync('summary_history') || []
    history.unshift({
      original,
      summary,
      time: new Date().toLocaleString()
    })
    // 最多保存50条
    if (history.length > 50) history.pop()
    wx.setStorageSync('summary_history', history)
  },

  // 复制摘要
  onCopy() {
    wx.setClipboardData({
      data: this.data.summary,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
```

**WXML 页面结构：**

```xml
<!-- pages/index/index.wxml -->
<view class="container">
  <!-- 输入区 -->
  <view class="input-section">
    <textarea
      class="input-area"
      placeholder="输入想要摘要的文章或文字..."
      bindinput="onInput"
      value="{{inputText}}"
      maxlength="3000"
    />
    <view class="char-count">{{inputText.length}} / 3000</view>
  </view>

  <!-- 操作区 -->
  <button class="summarize-btn" bindtap="onSummarize" loading="{{loading}}">
    {{loading ? '生成中...' : '生成摘要'}}
  </button>

  <!-- 结果区 -->
  <view wx:if="{{summary}}" class="result-section">
    <view class="result-header">
      <text class="result-title">摘要结果</text>
      <button class="copy-btn" bindtap="onCopy">复制</button>
    </view>
    <view class="result-content">{{summary}}</view>
  </view>
</view>
```

**WXSS 样式：**

```css
/* pages/index/index.wxss */
.container {
  padding: 32rpx;
  min-height: 100vh;
  background: #050505;
}

.input-section {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 24rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
  position: relative;
}

.input-area {
  width: 100%;
  min-height: 300rpx;
  background: transparent;
  color: white;
  font-size: 28rpx;
  line-height: 1.6;
}

.char-count {
  text-align: right;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 12rpx;
}

.summarize-btn {
  width: 100%;
  height: 96rpx;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  border-radius: 48rpx;
  color: white;
  font-size: 32rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
}

.result-section {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 24rpx;
  padding: 32rpx;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}

.result-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #38bdf8;
}

.copy-btn {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.1);
  padding: 8rpx 24rpx;
  border-radius: 24rpx;
}

.result-content {
  font-size: 28rpx;
  color: #e5e7eb;
  line-height: 1.8;
}
```

### 9.5 用 Cursor AI 加速开发

**生成新的 AI 功能时：**

```
用 Cursor Cmd/Ctrl + L：

"创建一个图片描述生成功能，用户上传图片，调用云函数 describe_image 返回图片内容的文字描述。

页面：pages/describe/describe.wxml + .wxss + .js
云函数：cloudfunctions/describe_image/index.js
样式：深色主题，主色 #38bdf8"
```

**遇到 Bug 时：**

```
Cursor Cmd/Ctrl + L：

"微信小程序报错：fail: function not found，云函数已部署但调用失败，错误信息：${错误内容}

请分析可能的原因和解决方案。"
```

**需要添加新页面时：**

```
Cursor Cmd/Ctrl + L：

"在现有小程序项目中新增「历史记录」页面 pages/history/，
显示 localStorage 中的 summary_history 记录列表，
每条记录显示原文字数、摘要内容、生成时间，
支持左滑删除。"
```

### 9.6 隐私协议配置（必须）

小程序提交审核前，必须在 `project.config.json` 中配置隐私协议：

```json
{
  "setting": {
    "privacyContractName": "privacy.md",
    "privacyContractPath": "我已阅读并同意《隐私协议》"
  }
}
```

在项目根目录创建 `隐私协议.md`，内容包含：
- 数据收集说明（输入的文字会上传至 AI API 服务商）
- 云存储说明
- 用户权利（删除数据的方式）

### 9.7 提交审核与发布

**自检清单：**

- [ ] 所有页面已实现功能，无空壳页面
- [ ] 隐私协议已添加
- [ ] tabBar 图标已上传到云存储（不能本地路径）
- [ ] 真机测试通过（开发工具模拟器 ≠ 真机）
- [ ] 分享功能已配置 `onShareAppMessage`
- [ ] 搜索栏配置（可选，有助于发现）

**提交审核步骤：**

1. 微信开发者工具 → 右上角「上传」（版本号如 `1.0.0`）
2. 登录 https://mp.weixin.qq.com → 管理后台
3. 管理 → 版本管理 → 找到刚上传的版本 → 提交审核
4. 填写功能页面截图（每个主要页面截一张）
5. 填写隐私协议说明
6. 等待微信审核（1-7 个工作日）

**提高审核通过率的技巧：**

- 个人主体小程序：AI 生成类、内容工具类相对容易通过
- 截图要真实、清晰，展示实际功能
- 描述要准确，说明你的小程序能做什么

### 9.8 后续迭代方向

上线第一版后，可以逐步迭代：

| 功能 | 难度 | 价值 |
|------|------|------|
| 用户登录 / 历史同步云端 | ⭐⭐ | 保存跨设备历史记录 |
| 每日免费次数限制 | ⭐ | 防止 API 滥用 |
| 分享到微信好友 / 朋友圈 | ⭐ | 裂变增长 |
| 多种 AI 模型切换（MiniMax / GPT / Claude）| ⭐⭐⭐ | 用户可选更喜欢的模型 |
| 会员订阅制 | ⭐⭐ | 商业化变现 |

---

## 十、完整开发流程详解（UI → 前后端 → 测试 → 运维）

下面以一个「AI 壁纸小程序」为例，串联从需求到上线的全流程。

### 10.1 需求分析

**确定核心功能：**

1. 用户输入描述词（Prompt）
2. 调用 AI 生成壁纸图片
3. 支持下载到相册 / 分享给好友
4. 历史记录浏览

**技术选型：**

| 模块 | 技术方案 |
|------|---------|
| 前端 | 微信小程序原生 + 深色主题 |
| 后端 | 云开发（云函数 + 云数据库 + 云存储）|
| AI 绘图 | MiniMax API（图像生成）|
| 数据库 | 云数据库（存储用户历史）|
| 文件存储 | 云存储（存储生成的壁纸）|

**Cursor Prompt 快速生成需求文档：**

```
帮我分析这个小程序的开发需求：AI 壁纸生成工具，用户输入 Prompt，AI 生成壁纸图，下载和分享功能，微信小程序+云开发实现。

列出：1. 核心功能清单 2. 数据结构设计 3. 页面跳转流程 4. API 接口需求
```

---

### 10.2 UI / UX 设计

**设计工具推荐：**

| 工具 | 适用场景 |
|------|---------|
| Figma | 专业 UI 设计、团队协作 |
| Pixso | 国产替代，支持中文，内置小程序组件库 |
| 微信小程序设计指南 | https://developers.weixin.qq.com/miniprogram/design/ |

**关键设计要点：**

1. **遵循小程序设计规范**
   - 导航结构用 tabBar（最多 4 个）
   - 页面层级不超过 5 级
   - 使用小程序内置组件样式

2. **深色主题配色（参考你的 AI Blog）**
   - 主色：`#38bdf8`（青色）
   - 强调色：`#818cf8`（紫色渐变）
   - 背景：`#050505`
   - 卡片：`rgba(255,255,255,0.05)`

3. **关键页面设计**

   - 首页：输入框 + 生成按钮（核心操作）
   - 结果页：大图预览 + 下载/分享操作区
   - 历史页：瀑布流或列表展示

**Cursor AI 生成 UI 代码：**

```
为 AI 壁纸小程序生成首页 UI，包含：

1. 顶部标题「AI 壁纸」（居中，白色字体）
2. 中间 textarea 输入 Prompt，占页面 40%
3. 下方「生成分壁纸」按钮，渐变背景 #38bdf8 → #818cf8
4. 底部 tabBar：首页 / 历史 / 我的
5. 深色主题，背景 #050505，卡片圆角 24rpx

生成 wxml + wxss 代码。
```

---

### 10.3 前端开发

**项目结构：**

```
ai-wallpaper/
├── app.js              # 应用入口，wx.cloud.init()
├── app.json           # 全局配置（tabBar、pages、window）
├── app.wxss           # 全局样式
├── pages/
│   ├── index/         # 首页（输入 Prompt）
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.js
│   ├── result/        # 结果页（大图预览）
│   │   ├── result.wxml
│   │   ├── result.wxss
│   │   └── result.js
│   ├── history/       # 历史记录
│   └── mine/          # 个人中心
├── cloudfunctions/    # 云函数
│   └── generate_image/
└── images/            # 本地图片资源
```

**各页面核心逻辑：**

```javascript
// pages/index/index.js
Page({
  data: {
    prompt: '',
    loading: false
  },

  onInput(e) {
    this.setData({ prompt: e.detail.value })
  },

  async onGenerate() {
    if (!this.data.prompt.trim()) {
      wx.showToast({ title: '请输入描述词', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      wx.showLoading({ title: '生成中...' })

      // 调用云函数
      const res = await wx.cloud.callFunction({
        name: 'generate_image',
        data: { prompt: this.data.prompt }
      })

      wx.hideLoading()

      if (res.result.success) {
        // 跳转结果页
        wx.navigateTo({
          url: `/pages/result/result?imageUrl=${res.result.imageUrl}&prompt=${this.data.prompt}`
        })
      } else {
        wx.showToast({ title: res.result.error, icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
```

**常用微信 API：**

| API | 用途 |
|-----|------|
| `wx.cloud.callFunction()` | 调用云函数 |
| `wx.cloud.uploadFile()` | 上传文件到云存储 |
| `wx.cloud.downloadFile()` | 下载云存储文件 |
| `wx.saveImageToPhotosAlbum()` | 保存图片到相册 |
| `wx.showToast()` | 提示信息 |
| `wx.navigateTo()` | 页面跳转 |
| `wx.getStorageSync()` | 读写本地存储 |

---

### 10.4 后端开发（云函数）

**云函数：生成壁纸**

```javascript
// cloudfunctions/generate_image/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const fetch = require('node-fetch')
exports.main = async (event, context) => {
  const { prompt } = event
  const API_KEY = process.env.MINIMAX_API_KEY

  try {
    // 调用 MiniMax 图像生成 API
    const response = await fetch('https://api.minimax.chat/v1/image_generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'MiniMax-Image-01',
        prompt: prompt,
        width: 1024,
        height: 1024,
        response_format: 'url'
      })
    })

    const data = await response.json()

    if (data.error) {
      return { success: false, error: data.error.message }
    }

    // 上传到云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath: `wallpapers/${Date.now()}.png`,
      fileContent: Buffer.from(await (await fetch(data.data[0].url)).arrayBuffer())
    })

    // 保存到数据库
    const db = cloud.database()
    await db.collection('wallpapers').add({
      data: {
        prompt,
        imageUrl: uploadResult.fileID,
        createdAt: db.serverDate()
      }
    })

    return {
      success: true,
      imageUrl: uploadResult.fileID
    }
  } catch (err) {
    console.error('Error:', err)
    return { success: false, error: '服务异常' }
  }
}
```

**云数据库设计：**

| 集合名 | 字段 | 类型 | 说明 |
|--------|------|------|------|
| wallpapers | _id | ObjectId | 主键 |
| | prompt | string | 用户输入 |
| | imageUrl | string | 云存储文件 ID |
| | createdAt | Date | 创建时间 |
| | userId | string | 用户 openid |

---

### 10.5 测试

**测试矩阵：**

| 测试类型 | 测试内容 | 工具 |
|---------|---------|------|
| 单元测试 | 云函数逻辑 | Jest + node-fetch mock |
| 集成测试 | 云函数 + 数据库联动 | 微信开发者工具云调试 |
| UI 测试 | 页面渲染、交互 | 微信开发者工具模拟器 |
| 真机测试 | 实际机型表现 | 邀请好友测试 |
| 性能测试 | 首屏加载、setData 优化 | profiling 工具 |

**微信开发者工具测试功能：**

1. **模拟器测试** — 快速验证 UI 和交互逻辑
2. **真机调试** — 连接手机，数据请求真实环境
3. **云开发控制台** — 直接操作数据库、存储、云函数日志
4. ** profiles** — 分析性能瓶颈

**Cursor 辅助 Debug：**

```
报错信息：fail: cloud uploadFile: permission denied
可能原因：云存储权限未配置
解决：1. 检查 cloudfunctions 目录是否部署 2. 云开发控制台 → 存储 → 权限设置

详细错误：${错误内容}
```

**常见问题快速对照：**

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 云函数找不到 | 未部署或环境 ID 错误 | 右键上传部署，检查 wx.cloud.init() |
| 权限不足 | 数据库权限未配置 | 在云开发控制台设置 add/write/read 权限 |
| 图片不显示 | fileID 跨设备失效 | 使用云文件临时 URL `cloud.getTempFileURL()` |
| 审核被拒 | 截图不符合要求 | 提供真实功能截图，描述功能用途 |

---

### 10.6 运维与持续迭代

**上线后运维清单：**

1. **监控**
   - 微信公众平台后台 → 数据分析
   - 关键指标：访问量、留存率、页面漏斗
   - 云开发控制台 → 云函数日志排查问题

2. **日志收集**
   ```javascript
   // 在云函数中打印关键日志
   console.log('User:', userInfo.openId, 'Action: generate', 'Prompt:', prompt)
   ```
   云开发控制台 → 云函数 → 日志查询

3. **异常告警**
   - 云开发 → 告警设置 → 云函数错误次数超阈值时通知
   - 微信公众平台 → 接收违规通知

4. **版本管理**
   - 每次发布新版本前在微信开发者工具上传
   - 使用「版本回退」功能应对线上问题
   - 建议：先发布灰度版本，用内测用户验证

5. **日常迭代流程**
   ```
   1. 收集用户反馈（小程序内「反馈与建议」）
   2. Cursor 生成新功能代码
   3. 本地测试 + 真机验证
   4. 上传新版本 → 提交审核
   5. 审核通过后全量发布
   ```

6. **资源预算（云开发免费额度）**
   - 云函数：400,000 GB·秒 / 月
   - 数据库：500 MB / 月
   - 存储：5 GB / 月
   - 超出后按量计费，建议设置费用上限提醒

---

**现在你可以开始动手了！遇到任何问题，直接问我。** 💪
