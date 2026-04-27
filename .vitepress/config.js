import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AI 探索者',
  description: '探索 AI 技术，链接开源生态',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/articles/' },
      { text: '教程', link: '/tutorials/' },
      { text: '搜索', link: '/search/' },
      { text: '技术栈', link: '#stack' },
      { text: '开源探索', link: '#lab' },
      { text: '关于我', link: '#about' }
    ],
    footer: {
      copyright: '© 2026 AI 探索者. Built with VitePress.'
    }
  }
})