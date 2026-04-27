const express = require('express');
const fs = require('fs');
const path = require('path');
const markdownIt = require('markdown-it');
const markdownItMultimdTable = require('markdown-it-multimd-table');

const app = express();
const port = process.env.PORT || 5173;
const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true
}).use(markdownItMultimdTable);

// 缓存机制
const cache = {
  articles: null,
  tutorials: null,
  searchResults: {},
  cacheTime: 0,
  maxCacheAge: 3600000 // 1小时缓存
};

// 清除缓存的函数
function clearCache() {
  cache.articles = null;
  cache.tutorials = null;
  cache.searchResults = {};
  cache.cacheTime = Date.now();
}

// 每小时自动清除缓存
setInterval(clearCache, cache.maxCacheAge);

// 解析文章文件
function parseArticle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parts = content.split('---\n');
    const frontMatter = parts[1];
    const markdownContent = parts.slice(2).join('---\n');

    // 解析 front matter
    const metadata = {};
    frontMatter.split('\n').forEach(line => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        let key = match[1].trim();
        let value = match[2].trim();

        // 处理字符串、数组等类型
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith('[') && value.endsWith(']')) {
          value = JSON.parse(value);
        }

        metadata[key] = value;
      }
    });

    // 解析 Markdown
    const htmlContent = md.render(markdownContent);

    // 提取标题生成目录
    const toc = extractToc(markdownContent);

    // 计算阅读时间(按每分钟300字计算)
    const wordCount = markdownContent.replace(/[#*`\[\]]/g, '').length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 300));

    return { metadata, content: htmlContent, toc, readingTime };
  } catch (error) {
    console.error('Error parsing article:', error);
    return null;
  }
}

// 提取目录结构
function extractToc(markdown) {
  const toc = [];
  const lines = markdown.split('\n');

  lines.forEach(line => {
    // 匹配标题:# ## ### ####
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);

    if (h2Match) {
      const text = h2Match[1].trim();
      const id = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
      toc.push({ level: 2, text, id });
    } else if (h3Match) {
      const text = h3Match[1].trim();
      const id = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
      toc.push({ level: 3, text, id });
    }
  });

  return toc;
}

// 为HTML内容中的标题添加ID
function addIdsToHeadings(html) {
  return html.replace(/<h([23])>(.+?)<\/h\1>/g, (match, level, text) => {
    const id = text.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
    return `<h${level} id="${id}">${text}</h${level}>`;
  });
}

// 获取所有文章
function getAllArticles() {
  // 检查缓存
  if (cache.articles) {
    return cache.articles;
  }

  const articlesDir = path.join(__dirname, 'articles');
  const files = fs.readdirSync(articlesDir);

  const articles = files
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const article = parseArticle(path.join(articlesDir, file));
      if (article) {
        return {
          id: file.replace('.md', ''),
          ...article.metadata
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // 缓存结果
  cache.articles = articles;
  return articles;
}

// 文章列表 API
app.get('/api/articles', (req, res) => {
  const articles = getAllArticles();
  res.json(articles);
});

// 标签统计 API
app.get('/api/tags', (req, res) => {
  const articles = getAllArticles();
  const tutorials = getAllTutorials();

  const tagCounts = {};

  // 统计文章标签
  articles.forEach(article => {
    if (article.tags) {
      article.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || { count: 0, articles: 0, tutorials: 0 });
        tagCounts[tag].count++;
        tagCounts[tag].articles++;
      });
    }
  });

  // 统计教程标签
  tutorials.forEach(tutorial => {
    if (tutorial.tags) {
      tutorial.tags.forEach(tag => {
        tagCounts[tag] = tagCounts[tag] || { count: 0, articles: 0, tutorials: 0 };
        tagCounts[tag].count++;
        tagCounts[tag].tutorials++;
      });
    }
  });

  // 转换为数组并按数量排序
  const tags = Object.entries(tagCounts)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count);

  res.json(tags);
});

// 单个文章 API
app.get('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  const article = parseArticle(path.join(__dirname, 'articles', `${id}.md`));

  if (article) {
    res.json(article);
  } else {
    res.status(404).json({ error: 'Article not found' });
  }
});

// 相关文章推荐 API
app.get('/api/articles/:id/related', (req, res) => {
  const { id } = req.params;
  const currentArticle = parseArticle(path.join(__dirname, 'articles', `${id}.md`));

  if (!currentArticle) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }

  const allArticles = getAllArticles();
  const allTutorials = getAllTutorials();
  const currentTags = currentArticle.metadata.tags || [];

  const relatedArticles = [];
  const relatedTutorials = [];

  // 查找相关文章(基于标签匹配)
  allArticles.forEach(article => {
    if (article.id === id) return; // 排除当前文章

    const articleTags = article.tags || [];
    const commonTags = currentTags.filter(tag => articleTags.includes(tag));

    if (commonTags.length > 0) {
      relatedArticles.push({
        id: article.id,
        title: article.title,
        description: article.description,
        date: article.date,
        tags: articleTags,
        commonTags: commonTags,
        score: commonTags.length, // 匹配标签数量作为分数
        url: `/article/${article.id}`
      });
    }
  });

  // 查找相关教程
  allTutorials.forEach(tutorial => {
    const tutorialTags = tutorial.tags || [];
    const commonTags = currentTags.filter(tag => tutorialTags.includes(tag));

    if (commonTags.length > 0) {
      relatedTutorials.push({
        id: tutorial.id,
        title: tutorial.title,
        description: tutorial.description,
        date: tutorial.date,
        tags: tutorialTags,
        categoryName: tutorial.categoryName,
        commonTags: commonTags,
        score: commonTags.length,
        url: `/tutorial/${tutorial.id}`
      });
    }
  });

  // 按分数排序
  relatedArticles.sort((a, b) => b.score - a.score);
  relatedTutorials.sort((a, b) => b.score - a.score);

  // 只返回前5个
  res.json({
    articles: relatedArticles.slice(0, 5),
    tutorials: relatedTutorials.slice(0, 3)
  });
});

// 获取所有教程
function getAllTutorials() {
  // 检查缓存
  if (cache.tutorials) {
    return cache.tutorials;
  }

  const tutorialsDir = path.join(__dirname, 'tutorials');
  const files = fs.readdirSync(tutorialsDir);

  const tutorials = files
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const tutorial = parseArticle(path.join(tutorialsDir, file));
      if (tutorial) {
        return {
          id: file.replace('.md', ''),
          ...tutorial.metadata,
          toc: tutorial.toc,
          readingTime: tutorial.readingTime
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // 缓存结果
  cache.tutorials = tutorials;
  return tutorials;
}

// 教程列表 API
app.get('/api/tutorials', (req, res) => {
  const tutorials = getAllTutorials();
  res.json(tutorials);
});

// 阅读历史 API(从客户端localStorage获取,这里仅作为示例端点)
app.get('/api/reading-history', (req, res) => {
  // 注意:实际阅读历史存储在客户端localStorage中
  // 这个API仅作为占位符,实际数据由前端JavaScript管理
  res.json({ message: '阅读历史存储在浏览器localStorage中', endpoints: ['/api/articles'] });
});

// 站点地图生成 API
app.get('/sitemap.xml', (req, res) => {
  const siteUrl = 'https://aiinsights.example.com';
  const articles = getAllArticles();
  const tutorials = getAllTutorials();

  const now = new Date().toISOString();

  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // 主页
  sitemap += `  <url>\n`;
  sitemap += `    <loc>${siteUrl}/</loc>\n`;
  sitemap += `    <lastmod>${now}</lastmod>\n`;
  sitemap += `    <changefreq>daily</changefreq>\n`;
  sitemap += `    <priority>1.0</priority>\n`;
  sitemap += `  </url>\n`;

  // 文章列表页
  sitemap += `  <url>\n`;
  sitemap += `    <loc>${siteUrl}/articles</loc>\n`;
  sitemap += `    <lastmod>${now}</lastmod>\n`;
  sitemap += `    <changefreq>daily</changefreq>\n`;
  sitemap += `    <priority>0.9</priority>\n`;
  sitemap += `  </url>\n`;

  // 教程列表页
  sitemap += `  <url>\n`;
  sitemap += `    <loc>${siteUrl}/tutorials</loc>\n`;
  sitemap += `    <lastmod>${now}</lastmod>\n`;
  sitemap += `    <changefreq>daily</changefreq>\n`;
  sitemap += `    <priority>0.9</priority>\n`;
  sitemap += `  </url>\n`;

  // 标签页
  sitemap += `  <url>\n`;
  sitemap += `    <loc>${siteUrl}/tags</loc>\n`;
  sitemap += `    <lastmod>${now}</lastmod>\n`;
  sitemap += `    <changefreq>weekly</changefreq>\n`;
  sitemap += `    <priority>0.8</priority>\n`;
  sitemap += `  </url>\n`;

  // 搜索页
  sitemap += `  <url>\n`;
  sitemap += `    <loc>${siteUrl}/search</loc>\n`;
  sitemap += `    <lastmod>${now}</lastmod>\n`;
  sitemap += `    <changefreq>monthly</changefreq>\n`;
  sitemap += `    <priority>0.5</priority>\n`;
  sitemap += `  </url>\n`;

  // 文章详情页
  articles.forEach(article => {
    const lastmod = article.date ? new Date(article.date).toISOString() : now;
    sitemap += `  <url>\n`;
    sitemap += `    <loc>${siteUrl}/article/${article.id}</loc>\n`;
    sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.8</priority>\n`;
    sitemap += `  </url>\n`;
  });

  // 教程详情页
  tutorials.forEach(tutorial => {
    const lastmod = tutorial.date ? new Date(tutorial.date).toISOString() : now;
    sitemap += `  <url>\n`;
    sitemap += `    <loc>${siteUrl}/tutorial/${tutorial.id}</loc>\n`;
    sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
    sitemap += `    <changefreq>monthly</changefreq>\n`;
    sitemap += `    <priority>0.8</priority>\n`;
    sitemap += `  </url>\n`;
  });

  sitemap += '</urlset>';

  res.type('application/xml');
  res.send(sitemap);
});

// 评论 API - 获取评论
app.get('/api/comments/:type/:id', (req, res) => {
  const { type, id } = req.params;
  // 注意:评论数据存储在客户端localStorage中
  // 这个API仅作为占位符,实际数据由前端JavaScript管理
  res.json({ message: '评论数据存储在浏览器localStorage中' });
});

// 评论 API - 提交评论
app.post('/api/comments/:type/:id', (req, res) => {
  const { type, id } = req.params;
  // 注意:评论数据存储在客户端localStorage中
  // 这个API仅作为占位符,实际数据由前端JavaScript管理
  res.json({ success: true, message: '评论已保存到浏览器localStorage' });
});

// 单个教程 API
app.get('/api/tutorials/:id', (req, res) => {
  const { id } = req.params;
  const tutorial = parseArticle(path.join(__dirname, 'tutorials', `${id}.md`));

  if (tutorial) {
    res.json(tutorial);
  } else {
    res.status(404).json({ error: 'Tutorial not found' });
  }
});

// 搜索 API
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) {
    res.json([]);
    return;
  }

  const query = q.toLowerCase();

  // 检查缓存
  if (cache.searchResults[query]) {
    res.json(cache.searchResults[query]);
    return;
  }

  const results = [];

  // 搜索文章
  const articles = getAllArticles();
  articles.forEach(article => {
    let score = 0;
    let title = article.title;
    let description = article.description || '';

    // 计算匹配分数
    if (article.title.toLowerCase().includes(query)) {
      score += 3;
      // 高亮标题中的匹配词
      title = article.title.replace(new RegExp(`(${query})`, 'gi'), '<mark>$1</mark>');
    }

    if (article.description && article.description.toLowerCase().includes(query)) {
      score += 2;
      // 高亮描述中的匹配词
      description = article.description.replace(new RegExp(`(${query})`, 'gi'), '<mark>$1</mark>');
    }

    if (score > 0) {
      results.push({
        type: 'article',
        id: article.id,
        title: title,
        date: article.date,
        description: description,
        url: `/article/${article.id}`,
        score: score
      });
    }
  });

  // 搜索教程
  const tutorials = getAllTutorials();
  tutorials.forEach(tutorial => {
    let score = 0;
    let title = tutorial.title;
    let description = tutorial.description || '';

    // 计算匹配分数
    if (tutorial.title.toLowerCase().includes(query)) {
      score += 3;
      // 高亮标题中的匹配词
      title = tutorial.title.replace(new RegExp(`(${query})`, 'gi'), '<mark>$1</mark>');
    }

    if (tutorial.description && tutorial.description.toLowerCase().includes(query)) {
      score += 2;
      // 高亮描述中的匹配词
      description = tutorial.description.replace(new RegExp(`(${query})`, 'gi'), '<mark>$1</mark>');
    }

    if (score > 0) {
      results.push({
        type: 'tutorial',
        id: tutorial.id,
        title: title,
        date: tutorial.date,
        description: description,
        category: tutorial.categoryName,
        url: `/tutorial/${tutorial.id}`,
        score: score
      });
    }
  });

  // 按分数排序,分数高的排在前面
  results.sort((a, b) => b.score - a.score);

  // 缓存结果
  cache.searchResults[query] = results;

  res.json(results);
});



// 文章页面
app.get('/article/:id', (req, res) => {
  const { id } = req.params;
  const article = parseArticle(path.join(__dirname, 'articles', `${id}.md`));

  if (article) {
    const siteUrl = 'https://aiinsights.example.com';
    const articleUrl = `${siteUrl}/article/${id}`;
    const description = article.metadata.description || `${article.metadata.title} - 深入了解AI技术趋势`;

    res.send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${article.metadata.title} | AI Insights</title>
        <meta name="description" content="${description}">
        <meta name="keywords" content="${article.metadata.tags ? article.metadata.tags.join(', ') : 'AI, 人工智能, 技术博客'}">
        <meta name="author" content="${article.metadata.author || 'Lucas'}">
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="${articleUrl}">

        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="article">
        <meta property="og:url" content="${articleUrl}">
        <meta property="og:title" content="${article.metadata.title} | AI Insights">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${article.metadata.cover || siteUrl + '/og-image.png'}">
        <meta property="og:locale" content="zh_CN">
        <meta property="article:published_time" content="${article.metadata.date}">
        <meta property="article:author" content="${article.metadata.author || 'Lucas'}">

        <!-- Twitter Card -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="${articleUrl}">
        <meta name="twitter:title" content="${article.metadata.title} | AI Insights">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${article.metadata.cover || siteUrl + '/og-image.png'}">
        <meta name="twitter:creator" content="@Lucas9693265618">

        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'General Sans', sans-serif;
            background-color: #050505;
            color: white;
          }
          .article-content {
            max-width: 800px;
            margin: 0 auto;
          }
          .article-content h1, .article-content h2, .article-content h3 {
            margin-top: 2rem;
            margin-bottom: 1rem;
          }
          .article-content p {
            margin-bottom: 1rem;
            line-height: 1.6;
          }
          .article-content a {
            color: #38bdf8;
            text-decoration: none;
          }
          .article-content a:hover {
            text-decoration: underline;
          }
          .article-content ul, .article-content ol {
            margin-bottom: 1rem;
            padding-left: 1.5rem;
          }
          .article-content li {
            margin-bottom: 0.5rem;
          }
          /* 表格样式 */
          .article-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            font-size: 0.95rem;
          }
          .article-content th {
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            font-weight: 600;
            text-align: left;
            padding: 10px 16px;
            border-bottom: 2px solid rgba(56, 189, 248, 0.4);
          }
          .article-content td {
            padding: 10px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            color: #e5e7eb;
          }
          .article-content tr:hover td {
            background: rgba(255, 255, 255, 0.03);
          }
          /* 代码块样式 */
          .article-content pre {
            background: #0d1117;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            margin: 1.5rem 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
          }
          .article-content code {
            font-family: 'Fira Code', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
          }
          .article-content :not(pre) > code {
            background: rgba(255, 255, 255, 0.1);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
          }
          /* 代码块复制按钮 */
          .copy-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            color: white;
            cursor: pointer;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
          }
          .article-content pre:hover .copy-btn {
            opacity: 1;
          }
          .copy-btn:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          /* 阅读进度条 */
          .reading-progress {
            position: fixed;
            top: 0;
            left: 0;
            width: 0%;
            height: 3px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            z-index: 9999;
            transition: width 0.1s ease-out;
          }
          /* 文章目录导航 */
          .article-toc {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
          }
          .article-toc-title {
            font-weight: 600;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .article-toc-list {
            list-style: none;
            padding: 0;
            margin: 0;
          }
          .article-toc-item {
            margin-bottom: 0.5rem;
          }
          .article-toc-item.level-3 {
            padding-left: 1rem;
          }
          .article-toc-link {
            color: rgba(255, 255, 255, 0.6);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
            display: block;
            padding: 0.25rem 0;
            border-left: 2px solid transparent;
            padding-left: 0.75rem;
          }
          .article-toc-link:hover {
            color: #38bdf8;
            border-left-color: #38bdf8;
          }
        </style>
      </head>
      <body>
        <!-- 网络断开提示 -->
        <div id="offlineNotification" class="fixed top-0 left-0 w-full bg-red-500 text-white text-center py-2 px-4 z-[9999] hidden">
          <span class="flex items-center justify-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"></path></svg>
            网络连接已断开,请检查您的网络
          </span>
        </div>

        <!-- 阅读进度条 -->
        <div class="reading-progress" id="readingProgress"></div>

        <nav class="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-5 md:px-[120px] md:py-[18px] z-50 backdrop-blur-2xl bg-black/10 border-b border-white/5">
          <div class="flex items-center gap-[40px]">
            <div class="text-[20px] font-medium tracking-tight cursor-pointer" onclick="window.location.href='/'">
              AI <span class="text-white/50">INSIGHTS</span>
            </div>
            <div class="hidden md:flex items-center gap-[30px]">
              <a href="/" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">首页</a>
              <a href="/articles" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">文章</a>
              <a href="/tutorials" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">教程</a>
              <a href="/search" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">搜索</a>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <button id="menu-button" class="md:hidden p-2 rounded-full bg-white/5">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </button>
            <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group">
              <div class="light-streak"></div>
              <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                关注 Twitter
              </div>
            </a>
          </div>
        </nav>

        <!-- 移动端菜单 -->
        <div id="mobile-menu" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl hidden flex-col">
          <div class="flex items-center justify-between px-6 py-5 border-b border-white/10">
            <div class="text-[20px] font-medium tracking-tight">
              AI <span class="text-white/50">INSIGHTS</span>
            </div>
            <button id="close-menu-button" class="p-2 rounded-full bg-white/5">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="flex flex-col gap-6 p-6">
            <a href="/" class="text-lg font-medium py-2 border-b border-white/10">首页</a>
            <a href="#stack" class="text-lg font-medium py-2 border-b border-white/10">技术栈</a>
            <a href="#lab" class="text-lg font-medium py-2 border-b border-white/10">开源探索</a>
            <a href="#ai-tools" class="text-lg font-medium py-2 border-b border-white/10">工具推荐</a>
            <a href="#about" class="text-lg font-medium py-2 border-b border-white/10">关于我</a>
            <a href="/articles" class="text-lg font-medium py-2 border-b border-white/10">文章</a>
            <a href="/tutorials" class="text-lg font-medium py-2 border-b border-white/10">教程</a>
            <a href="/search" class="text-lg font-medium py-2 border-b border-white/10">搜索</a>
          </div>
          <div class="mt-auto p-6 border-t border-white/10">
            <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group w-full justify-center">
              <div class="light-streak"></div>
              <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                关注 Twitter
              </div>
            </a>
          </div>
        </div>

        <script>
          // 移动端菜单
          const menuButton = document.getElementById('menu-button');
          const closeMenuButton = document.getElementById('close-menu-button');
          const mobileMenu = document.getElementById('mobile-menu');

          menuButton.addEventListener('click', () => {
            mobileMenu.classList.remove('hidden');
          });

          closeMenuButton.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
          });
        </script>

        <div class="pt-32 pb-20 px-6">
          <div class="article-content max-w-4xl mx-auto">
            <div class="mb-8">
              <a href="/articles" class="text-cyan-400 hover:underline">← 返回文章列表</a>
            </div>
            <h1 class="text-4xl font-bold mb-4">${article.metadata.title}</h1>
            <div class="flex flex-wrap items-center gap-3 text-gray-400 mb-8">
              <span class="flex items-center gap-1 text-sm">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                ${article.metadata.date}
              </span>
              <span class="flex items-center gap-1 text-sm">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                约${article.readingTime}分钟阅读
              </span>
              ${article.metadata.tags ? article.metadata.tags.map(tag => `<a href="/articles?tag=${encodeURIComponent(tag)}" class="px-3 py-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 text-cyan-400 rounded-full text-sm transition-all hover:scale-105">${tag}</a>`).join('') : ''}
            </div>

            ${article.toc && article.toc.length > 0 ? `
            <!-- 文章目录 -->
            <div class="article-toc">
              <div class="article-toc-title">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
                目录
              </div>
              <ul class="article-toc-list">
                ${article.toc.map(item => `
                  <li class="article-toc-item level-${item.level}">
                    <a href="#${item.id}" class="article-toc-link">${item.text}</a>
                  </li>
                `).join('')}
              </ul>
            </div>
            ` : ''}

            <div class="prose prose-invert max-w-none">
              ${addIdsToHeadings(article.content)}
            </div>

            <!-- 点赞/踩功能 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-4">觉得这篇文章如何?</h3>
              <div class="flex items-center gap-4">
                <button id="likeBtn" onclick="handleLike()" class="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all hover:scale-105">
                  <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>
                  <span id="likeCount">0</span> 点赞
                </button>
                <button id="dislikeBtn" onclick="handleDislike()" class="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all hover:scale-105">
                  <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-9V4a1 1 0 00-1-1h-4.486a.486.486 0 00-.354.146l-2.414 2.414a1 1 0 00-.268.394l-.036.073a.486.486 0 00-.146.354V17a2 2 0 002 2h10a2 2 0 002-2v-2.828a.486.486 0 00-.146-.354l-.036-.073a1 1 0 00-.268-.394l-2.414-2.414a.486.486 0 00-.354-.146H6a1 1 0 00-1 1v2.828m8-4a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                  <span id="dislikeCount">0</span> 踩
                </button>
              </div>
            </div>

            <!-- 社交分享按钮 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-4">分享这篇文章</h3>
              <div class="flex flex-wrap gap-3">
                <button onclick="shareToTwitter()" class="flex items-center gap-2 px-4 py-2 bg-[#1DA1F2]/20 hover:bg-[#1DA1F2]/30 text-[#1DA1F2] rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                  Twitter
                </button>
                <button onclick="shareToWechat()" class="flex items-center gap-2 px-4 py-2 bg-[#07C160]/20 hover:bg-[#07C160]/30 text-[#07C160] rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.838.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.173l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89a5.718 5.718 0 00-.406-.032zm-1.84 3.133c.536 0 .97.44.97.983a.976.976 0 01-.97.983.976.976 0 01-.97-.983c0-.542.434-.983.97-.983zm4.857 0c.536 0 .97.44.97.983a.976.976 0 01-.97.983.976.976 0 01-.97-.983c0-.542.434-.983.97-.983z"/></svg>
                  微信
                </button>
                <button onclick="copyLink()" class="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  复制链接
                </button>
              </div>
            </div>

            <!-- 打赏功能 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-6 text-center">💝 支持作者</h3>
              <div class="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 rounded-2xl p-8 border border-white/10">
                <p class="text-center text-white/70 mb-6">如果这篇文章对你有帮助,可以请作者喝杯咖啡~</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <!-- 微信打赏 -->
                  <div class="text-center">
                    <div class="bg-white rounded-xl p-4 mb-3 max-w-[200px] mx-auto">
                      <div class="text-6xl mb-2">💚</div>
                      <p class="text-gray-600 text-sm">微信收款码</p>
                      <p class="text-xs text-gray-400 mt-1">(请添加微信收款码图片)</p>
                    </div>
                    <button onclick="alert('请扫描上方二维码或联系作者获取微信收款码')" class="px-6 py-2 bg-[#07C160] hover:bg-[#06a50e] text-white rounded-lg transition-colors text-sm font-medium">
                      微信支付
                    </button>
                  </div>

                  <!-- 支付宝打赏 -->
                  <div class="text-center">
                    <div class="bg-white rounded-xl p-4 mb-3 max-w-[200px] mx-auto">
                      <div class="text-6xl mb-2">💙</div>
                      <p class="text-gray-600 text-sm">支付宝收款码</p>
                      <p class="text-xs text-gray-400 mt-1">(请添加支付宝收款码图片)</p>
                    </div>
                    <button onclick="alert('请扫描上方二维码或联系作者获取支付宝收款码')" class="px-6 py-2 bg-[#1677FF] hover:bg-[#096dd9] text-white rounded-lg transition-colors text-sm font-medium">
                      支付宝
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <script>
              // 分享到Twitter
              function shareToTwitter() {
                const text = encodeURIComponent(document.title);
                const url = encodeURIComponent(window.location.href);
                window.open('https://twitter.com/intent/tweet?text=' + text + '&url=' + url, '_blank', 'width=550,height=450');
              }

              // 分享到微信(显示二维码提示)
              function shareToWechat() {
                alert('请复制链接后在微信中粘贴分享');
                copyLink();
              }

              // 复制链接
              function copyLink() {
                navigator.clipboard.writeText(window.location.href).then(() => {
                  alert('链接已复制到剪贴板');
                });
              }
              // 代码块复制功能
              document.querySelectorAll('.article-content pre').forEach(pre => {
                const btn = document.createElement('button');
                btn.className = 'copy-btn';
                btn.textContent = '复制';
                btn.onclick = () => {
                  const code = pre.querySelector('code');
                  navigator.clipboard.writeText(code.textContent).then(() => {
                    btn.textContent = '已复制!';
                    setTimeout(() => btn.textContent = '复制', 2000);
                  });
                };
                pre.appendChild(btn);
              });

              // 阅读进度条
              window.addEventListener('scroll', () => {
                const scrollTop = window.scrollY;
                const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                const progress = (scrollTop / docHeight) * 100;
                document.getElementById('readingProgress').style.width = progress + '%';
              });

              // 阅读历史记录功能
              const articleId = '${id}';
              const articleTitle = '${article.metadata.title}';
              const articleUrl = '/article/' + articleId;
              const articleData = {
                id: articleId,
                title: articleTitle,
                url: articleUrl,
                date: '${article.metadata.date}',
                readAt: new Date().toISOString()
              };

              // 获取或初始化阅读历史
              let readingHistory = JSON.parse(localStorage.getItem('readingHistory') || '[]');

              // 移除已存在的相同文章记录
              readingHistory = readingHistory.filter(item => item.id !== articleId);

              // 将当前文章添加到历史记录开头
              readingHistory.unshift(articleData);

              // 限制历史记录数量(最多保存20条)
              if (readingHistory.length > 20) {
                readingHistory = readingHistory.slice(0, 20);
              }

              // 保存到localStorage
              localStorage.setItem('readingHistory', JSON.stringify(readingHistory));

              // 点赞/踩功能
              const likeBtn = document.getElementById('likeBtn');
              const dislikeBtn = document.getElementById('dislikeBtn');
              const likeCount = document.getElementById('likeCount');
              const dislikeCount = document.getElementById('dislikeCount');

              // 从localStorage读取数据
              const likesData = JSON.parse(localStorage.getItem('articleLikes') || '{}');
              const articleLikes = likesData[articleId] || { liked: false, disliked: false, likeCount: Math.floor(Math.random() * 50) + 10, dislikeCount: Math.floor(Math.random() * 10) + 1 };

              // 更新显示
              likeCount.textContent = articleLikes.likeCount;
              dislikeCount.textContent = articleLikes.dislikeCount;

              // 更新按钮状态
              if (articleLikes.liked) {
                likeBtn.classList.add('bg-red-500/20', 'border-red-500/50');
                likeBtn.querySelector('svg').classList.add('fill-current');
              }
              if (articleLikes.disliked) {
                dislikeBtn.classList.add('bg-gray-500/20', 'border-gray-500/50');
                dislikeBtn.querySelector('svg').classList.add('fill-current', 'text-gray-500');
              }

              function handleLike() {
                if (articleLikes.disliked) {
                  articleLikes.disliked = false;
                  articleLikes.dislikeCount = Math.max(0, articleLikes.dislikeCount - 1);
                  dislikeBtn.classList.remove('bg-gray-500/20', 'border-gray-500/50');
                  dislikeBtn.querySelector('svg').classList.remove('fill-current', 'text-gray-500');
                }

                if (!articleLikes.liked) {
                  articleLikes.liked = true;
                  articleLikes.likeCount++;
                  likeBtn.classList.add('bg-red-500/20', 'border-red-500/50');
                  likeBtn.querySelector('svg').classList.add('fill-current');
                } else {
                  articleLikes.liked = false;
                  articleLikes.likeCount = Math.max(0, articleLikes.likeCount - 1);
                  likeBtn.classList.remove('bg-red-500/20', 'border-red-500/50');
                  likeBtn.querySelector('svg').classList.remove('fill-current');
                }

                likeCount.textContent = articleLikes.likeCount;
                dislikeCount.textContent = articleLikes.dislikeCount;
                saveLikes();
              }

              function handleDislike() {
                if (articleLikes.liked) {
                  articleLikes.liked = false;
                  articleLikes.likeCount = Math.max(0, articleLikes.likeCount - 1);
                  likeBtn.classList.remove('bg-red-500/20', 'border-red-500/50');
                  likeBtn.querySelector('svg').classList.remove('fill-current');
                }

                if (!articleLikes.disliked) {
                  articleLikes.disliked = true;
                  articleLikes.dislikeCount++;
                  dislikeBtn.classList.add('bg-gray-500/20', 'border-gray-500/50');
                  dislikeBtn.querySelector('svg').classList.add('fill-current', 'text-gray-500');
                } else {
                  articleLikes.disliked = false;
                  articleLikes.dislikeCount = Math.max(0, articleLikes.dislikeCount - 1);
                  dislikeBtn.classList.remove('bg-gray-500/20', 'border-gray-500/50');
                  dislikeBtn.querySelector('svg').classList.remove('fill-current', 'text-gray-500');
                }

                likeCount.textContent = articleLikes.likeCount;
                dislikeCount.textContent = articleLikes.dislikeCount;
                saveLikes();
              }

              function saveLikes() {
                likesData[articleId] = articleLikes;
                localStorage.setItem('articleLikes', JSON.stringify(likesData));
              }

              // 页面加载后延迟调用 loadComments,确保 DOM 已完全就绪
              function safeLoadComments() {
                try {
                  loadComments();
                } catch (e) {
                  console.error('加载评论失败:', e);
                  const container = document.getElementById('commentsList');
                  if (container) {
                    container.innerHTML = '<div class="text-center py-8 text-gray-400"><p>评论加载失败,请刷新重试</p></div>';
                  }
                }
              }

              // 多种方式确保 loadComments 被调用
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', safeLoadComments);
              } else {
                // 确保在 DOMContentLoaded 之后执行,避免竞态
                requestAnimationFrame(safeLoadComments);
                // 备用:500ms 后强制执行(防止上述方式都失败)
                setTimeout(safeLoadComments, 500);
              }
            </script>

            <!-- 评论系统 -->
            <div class="mt-12 border-t border-white/10 pt-8">
              <h3 class="text-2xl font-bold mb-6">评论</h3>

              <!-- 评论表单 -->
              <div class="mb-8 bg-white/5 rounded-xl p-6 border border-white/10">
                <h4 class="text-lg font-semibold mb-4">发表评论</h4>
                <form id="commentForm">
                  <div class="mb-4">
                    <input type="text" id="commentAuthor" placeholder="您的昵称" class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white" required>
                  </div>
                  <div class="mb-4">
                    <textarea id="commentContent" placeholder="写下您的评论..." rows="4" class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white resize-none" required></textarea>
                  </div>
                  <button type="submit" class="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors font-medium">
                    发布评论
                  </button>
                </form>
              </div>

              <!-- 评论列表 -->
              <div id="commentsList" class="space-y-6">
                <div class="text-center py-8 text-gray-400">
                  <p>加载评论中...</p>
                </div>
              </div>
            </div>

            <script>
              const articleId = '${id}';
              const articleTitle = '${article.metadata.title}';

              function loadComments() {
                const container = document.getElementById('commentsList');
                const allComments = JSON.parse(localStorage.getItem('comments') || '{}');
                const comments = allComments[articleId] || [];

                if (comments.length === 0) {
                  container.innerHTML = '<div class="text-center py-8 text-gray-400"><p>还没有评论,快来抢沙发!</p></div>';
                  return;
                }

                let html = '';
                comments.forEach(function(comment) {
                  html += '<div class="bg-white/5 rounded-xl p-6 border border-white/10">';
                  html += '<div class="flex items-center gap-3 mb-4">';
                  html += '<div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center text-white font-bold">' + comment.author.charAt(0).toUpperCase() + '</div>';
                  html += '<div><h5 class="font-semibold">' + escapeHtml(comment.author) + '</h5><p class="text-xs text-gray-400">' + formatDate(comment.timestamp) + '</p></div></div>';
                  html += '<p class="text-gray-300 mb-4">' + escapeHtml(comment.content) + '</p>';
                  html += '<button class="reply-btn text-cyan-400 hover:text-cyan-300 text-sm">回复</button>';
                  html += '</div>';
                });

                container.innerHTML = html;
                bindReplyBtns();
              }

              function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
              }

              function formatDate(ts) {
                const d = new Date(ts);
                const now = new Date();
                const diff = now - d;
                if (diff < 60000) return '刚刚';
                if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
                if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
                if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
                return d.toLocaleDateString('zh-CN', {year:'numeric', month:'long', day:'numeric'});
              }

              function bindReplyBtns() {
                document.querySelectorAll('.reply-btn').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    alert('回复功能开发中,敬请期待!');
                  });
                });
              }

              document.getElementById('commentForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const author = document.getElementById('commentAuthor').value.trim();
                const content = document.getElementById('commentContent').value.trim();
                if (!author || !content) {
                  alert('请填写昵称和评论');
                  return;
                }
                const comment = {
                  id: 'c' + Date.now(),
                  author: author,
                  content: content,
                  timestamp: new Date().toISOString()
                };
                const all = JSON.parse(localStorage.getItem('comments') || '{}');
                const list = all[articleId] || [];
                list.push(comment);
                all[articleId] = list;
                localStorage.setItem('comments', JSON.stringify(all));
                this.reset();
                loadComments();
              });

              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', loadComments);
              } else {
                loadComments();
              }
            </script>
          </div>
        </div>

        <!-- 返回顶部按钮 -->
        <button id="backToTop" class="fixed bottom-8 right-8 w-12 h-12 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full shadow-lg flex items-center justify-center opacity-0 transition-opacity duration-300 hover:scale-110 z-50" title="返回顶部">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
          </svg>
        </button>

        <script>
          // 返回顶部功能
          const backToTopBtn = document.getElementById('backToTop');
          window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
              backToTopBtn.style.opacity = '1';
            } else {
              backToTopBtn.style.opacity = '0';
            }
          });
          backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });

          // 阅读进度条
          window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = (scrollTop / docHeight) * 100;
            document.getElementById('readingProgress').style.width = progress + '%';
          });

          // 网络断开检测
          window.addEventListener('offline', () => {
            document.getElementById('offlineNotification').classList.remove('hidden');
          });
          window.addEventListener('online', () => {
            document.getElementById('offlineNotification').classList.add('hidden');
          });

          // 点赞/踩功能
          const tutorialId = '${id}';
          const likeBtn = document.getElementById('likeBtn');
          const dislikeBtn = document.getElementById('dislikeBtn');
          const likeCount = document.getElementById('likeCount');
          const dislikeCount = document.getElementById('dislikeCount');

          // 从localStorage读取数据
          const likesData = JSON.parse(localStorage.getItem('tutorialLikes') || '{}');
          const tutorialLikes = likesData[tutorialId] || { liked: false, disliked: false, likeCount: Math.floor(Math.random() * 100) + 20, dislikeCount: Math.floor(Math.random() * 20) + 5 };

          // 更新显示
          likeCount.textContent = tutorialLikes.likeCount;
          dislikeCount.textContent = tutorialLikes.dislikeCount;

          // 更新按钮状态
          if (tutorialLikes.liked) {
            likeBtn.classList.add('bg-red-500/20', 'border-red-500/50');
            likeBtn.querySelector('svg').classList.add('fill-current');
          }
          if (tutorialLikes.disliked) {
            dislikeBtn.classList.add('bg-gray-500/20', 'border-gray-500/50');
            dislikeBtn.querySelector('svg').classList.add('fill-current', 'text-gray-500');
          }

          function handleLike() {
            if (tutorialLikes.disliked) {
              tutorialLikes.disliked = false;
              tutorialLikes.dislikeCount = Math.max(0, tutorialLikes.dislikeCount - 1);
              dislikeBtn.classList.remove('bg-gray-500/20', 'border-gray-500/50');
              dislikeBtn.querySelector('svg').classList.remove('fill-current', 'text-gray-500');
            }

            if (!tutorialLikes.liked) {
              tutorialLikes.liked = true;
              tutorialLikes.likeCount++;
              likeBtn.classList.add('bg-red-500/20', 'border-red-500/50');
              likeBtn.querySelector('svg').classList.add('fill-current');
            } else {
              tutorialLikes.liked = false;
              tutorialLikes.likeCount = Math.max(0, tutorialLikes.likeCount - 1);
              likeBtn.classList.remove('bg-red-500/20', 'border-red-500/50');
              likeBtn.querySelector('svg').classList.remove('fill-current');
            }

            likeCount.textContent = tutorialLikes.likeCount;
            dislikeCount.textContent = tutorialLikes.dislikeCount;
            saveLikes();
          }

          function handleDislike() {
            if (tutorialLikes.liked) {
              tutorialLikes.liked = false;
              tutorialLikes.likeCount = Math.max(0, tutorialLikes.likeCount - 1);
              likeBtn.classList.remove('bg-red-500/20', 'border-red-500/50');
              likeBtn.querySelector('svg').classList.remove('fill-current');
            }

            if (!tutorialLikes.disliked) {
              tutorialLikes.disliked = true;
              tutorialLikes.dislikeCount++;
              dislikeBtn.classList.add('bg-gray-500/20', 'border-gray-500/50');
              dislikeBtn.querySelector('svg').classList.add('fill-current', 'text-gray-500');
            } else {
              tutorialLikes.disliked = false;
              tutorialLikes.dislikeCount = Math.max(0, tutorialLikes.dislikeCount - 1);
              dislikeBtn.classList.remove('bg-gray-500/20', 'border-gray-500/50');
              dislikeBtn.querySelector('svg').classList.remove('fill-current', 'text-gray-500');
            }

            likeCount.textContent = tutorialLikes.likeCount;
            dislikeCount.textContent = tutorialLikes.dislikeCount;
            saveLikes();
          }

          function saveLikes() {
            likesData[tutorialId] = tutorialLikes;
            localStorage.setItem('tutorialLikes', JSON.stringify(likesData));
          }
        </script>

        <footer class="py-12 border-t border-white/5 flex flex-col items-center gap-4">
          <div class="opacity-30 text-[12px] uppercase tracking-widest">© 2026 AI Insights. Built with Passion.</div>
        </footer>

        <style>
          .btn-layered {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 9999px;
            border: 0.6px solid rgba(255, 255, 255, 0.4);
            transition: all 0.3s ease;
            backdrop-filter: blur(8px);
            cursor: pointer;
          }
          .btn-inner {
            border-radius: 9999px;
            padding: 11px 29px;
            position: relative;
            overflow: hidden;
            z-index: 1;
          }
          .light-streak {
            position: absolute;
            top: -2px;
            left: 50%;
            transform: translateX(-50%);
            width: 70%;
            height: 4px;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 70%);
            filter: blur(2px);
            z-index: 2;
            pointer-events: none;
          }
          .btn-layered:hover {
            transform: translateY(-2px);
            border-color: #ffffff;
            box-shadow: 0 10px 25px -10px rgba(255, 255, 255, 0.4);
          }
        </style>
      </body>
      </html>
    `);
  } else {
    res.status(404).send('Article not found');
  }
});

// 文章列表页面
app.get('/articles', (req, res) => {
  const { tag } = req.query;
  let articles = getAllArticles();

  // 按标签筛选
  if (tag) {
    articles = articles.filter(article =>
      article.tags && article.tags.includes(tag)
    );
  }

  // 获取所有标签
  const allTags = [...new Set(
    getAllArticles()
      .filter(a => a.tags)
      .flatMap(a => a.tags)
  )];

  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${tag ? `标签: ${tag} - ` : ''}文章列表 | AI Insights</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'General Sans', sans-serif;
          background-color: #050505;
          color: white;
        }
        .article-card {
          transition: all 0.3s ease;
        }
        .article-card:hover {
          transform: translateY(-5px);
        }
      </style>
    </head>
    <body>
      <nav class="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-5 md:px-[120px] md:py-[18px] z-50 backdrop-blur-2xl bg-black/10 border-b border-white/5">
        <div class="flex items-center gap-[40px]">
          <div class="text-[20px] font-medium tracking-tight cursor-pointer" onclick="window.location.href='/'">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <div class="hidden md:flex items-center gap-[30px]">
            <a href="/" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">首页</a>
            <a href="/articles" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">文章</a>
            <a href="/tutorials" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">教程</a>
            <a href="/search" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">搜索</a>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <button id="menu-button" class="md:hidden p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </nav>

      <!-- 移动端菜单 -->
      <div id="mobile-menu" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl hidden flex-col">
        <div class="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div class="text-[20px] font-medium tracking-tight">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <button id="close-menu-button" class="p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="flex flex-col gap-6 p-6">
          <a href="/" class="text-lg font-medium py-2 border-b border-white/10">首页</a>
          <a href="/articles" class="text-lg font-medium py-2 border-b border-white/10">文章</a>
          <a href="/tutorials" class="text-lg font-medium py-2 border-b border-white/10">教程</a>
          <a href="/search" class="text-lg font-medium py-2 border-b border-white/10">搜索</a>
        </div>
        <div class="mt-auto p-6 border-t border-white/10">
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group w-full justify-center">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </div>

      <script>
        const menuButton = document.getElementById('menu-button');
        const closeMenuButton = document.getElementById('close-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');

        menuButton.addEventListener('click', () => {
          mobileMenu.classList.remove('hidden');
        });

        closeMenuButton.addEventListener('click', () => {
          mobileMenu.classList.add('hidden');
        });
      </script>

      <div class="pt-32 pb-20 px-6">
        <div class="max-w-4xl mx-auto">
          <h1 class="text-4xl font-bold mb-8 text-center">${tag ? `标签: ${tag}` : '文章列表'}</h1>

          <!-- 标签云 -->
          <div class="mb-8 flex flex-wrap gap-2 justify-center">
            <a href="/articles" class="px-3 py-1 rounded-full text-sm transition-all ${!tag ? 'bg-cyan-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">全部</a>
            ${allTags.map(t => `
              <a href="/articles?tag=${encodeURIComponent(t)}" class="px-3 py-1 rounded-full text-sm transition-all ${tag === t ? 'bg-cyan-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">${t}</a>
            `).join('')}
          </div>

          <div class="space-y-8">
            ${articles.length > 0 ? articles.map(article => `
              <div class="article-card bg-white/5 rounded-2xl p-6 border border-white/10">
                <h2 class="text-2xl font-bold mb-3">
                  <a href="/article/${article.id}" class="hover:text-cyan-400 transition-colors">${article.title}</a>
                </h2>
                <div class="flex flex-wrap items-center gap-2 text-gray-400 mb-3">
                  <span class="flex items-center gap-1 text-sm">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    ${article.date}
                  </span>
                  ${article.tags ? article.tags.map(t => `
                    <a href="/articles?tag=${encodeURIComponent(t)}" class="px-2 py-0.5 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 rounded-full text-xs hover:from-cyan-500/30 hover:to-purple-500/30 transition-all">${t}</a>
                  `).join('') : ''}
                </div>
                <p class="text-gray-300 mb-4">${article.description}</p>
                <a href="/article/${article.id}" class="text-cyan-400 hover:underline">阅读全文 →</a>
              </div>
            `).join('') : `
              <div class="text-center py-12 text-gray-400">
                <p class="text-xl mb-4">没有找到相关文章</p>
                <a href="/articles" class="text-cyan-400 hover:underline">查看所有文章</a>
              </div>
            `}
          </div>
        </div>
      </div>

      <footer class="py-12 border-t border-white/5 flex flex-col items-center gap-4">
        <div class="opacity-30 text-[12px] uppercase tracking-widest">© 2026 AI Insights. Built with Passion.</div>
      </footer>

      <style>
        .btn-layered {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          border: 0.6px solid rgba(255, 255, 255, 0.4);
          transition: all 0.3s ease;
          backdrop-filter: blur(8px);
          cursor: pointer;
        }
        .btn-inner {
          border-radius: 9999px;
          padding: 11px 29px;
          position: relative;
          overflow: hidden;
          z-index: 1;
        }
        .light-streak {
          position: absolute;
          top: -2px;
          left: 50%;
          transform: translateX(-50%);
          width: 70%;
          height: 4px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 70%);
          filter: blur(2px);
          z-index: 2;
          pointer-events: none;
        }
        .btn-layered:hover {
          transform: translateY(-2px);
          border-color: #ffffff;
          box-shadow: 0 10px 25px -10px rgba(255, 255, 255, 0.4);
        }
      </style>
    </body>
    </html>
  `);
});

// 标签云页面
app.get('/tags', (req, res) => {
  const articles = getAllArticles();
  const tutorials = getAllTutorials();

  // 统计标签
  const tagCounts = {};
  articles.forEach(article => {
    if (article.tags) {
      article.tags.forEach(tag => {
        tagCounts[tag] = tagCounts[tag] || { count: 0, articles: 0, tutorials: 0 };
        tagCounts[tag].count++;
        tagCounts[tag].articles++;
      });
    }
  });

  tutorials.forEach(tutorial => {
    if (tutorial.tags) {
      tutorial.tags.forEach(tag => {
        tagCounts[tag] = tagCounts[tag] || { count: 0, articles: 0, tutorials: 0 };
        tagCounts[tag].count++;
        tagCounts[tag].tutorials++;
      });
    }
  });

  const tags = Object.entries(tagCounts)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.count - a.count);

  const maxCount = Math.max(...tags.map(t => t.count), 1);

  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>标签云 | AI Insights</title>
      <meta name="description" content="浏览所有标签,快速找到您感兴趣的 AI 技术文章和教程">
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'General Sans', sans-serif;
          background-color: #050505;
          color: white;
        }
        .tag-cloud-item {
          transition: all 0.3s ease;
        }
        .tag-cloud-item:hover {
          transform: scale(1.1);
        }
        .tag-size-1 { font-size: 0.75rem; }
        .tag-size-2 { font-size: 0.875rem; }
        .tag-size-3 { font-size: 1rem; }
        .tag-size-4 { font-size: 1.125rem; }
        .tag-size-5 { font-size: 1.25rem; }
        .tag-size-6 { font-size: 1.5rem; }
      </style>
    </head>
    <body>
      <nav class="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-5 md:px-[120px] md:py-[18px] z-50 backdrop-blur-2xl bg-black/10 border-b border-white/5">
        <div class="flex items-center gap-[40px]">
          <div class="text-[20px] font-medium tracking-tight cursor-pointer" onclick="window.location.href='/'">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <div class="hidden md:flex items-center gap-[30px]">
            <a href="/" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">首页</a>
            <a href="/articles" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">文章</a>
            <a href="/tutorials" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">教程</a>
            <a href="/tags" class="text-[14px] font-medium opacity-100 border-b-2 border-cyan-500">标签</a>
            <a href="/search" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">搜索</a>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <button id="menu-button" class="md:hidden p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </nav>

      <!-- 移动端菜单 -->
      <div id="mobile-menu" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl hidden flex-col">
        <div class="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div class="text-[20px] font-medium tracking-tight">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <button id="close-menu-button" class="p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="flex flex-col gap-6 p-6">
          <a href="/" class="text-lg font-medium py-2 border-b border-white/10">首页</a>
          <a href="/articles" class="text-lg font-medium py-2 border-b border-white/10">文章</a>
          <a href="/tutorials" class="text-lg font-medium py-2 border-b border-white/10">教程</a>
          <a href="/tags" class="text-lg font-medium py-2 border-b border-white/10">标签</a>
          <a href="/search" class="text-lg font-medium py-2 border-b border-white/10">搜索</a>
        </div>
        <div class="mt-auto p-6 border-t border-white/10">
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group w-full justify-center">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </div>

      <script>
        const menuButton = document.getElementById('menu-button');
        const closeMenuButton = document.getElementById('close-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');

        if (menuButton && closeMenuButton && mobileMenu) {
          menuButton.addEventListener('click', () => {
            mobileMenu.classList.remove('hidden');
          });

          closeMenuButton.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
          });
        }
      </script>

      <div class="pt-32 pb-20 px-6">
        <div class="max-w-6xl mx-auto">
          <h1 class="text-4xl font-bold mb-4 text-center">标签云</h1>
          <p class="text-gray-400 text-center mb-12">浏览所有标签,快速找到您感兴趣的 AI 技术文章和教程</p>

          <div class="text-center mb-8">
            <p class="text-white/60">共 ${tags.length} 个标签,${articles.length} 篇文章,${tutorials.length} 篇教程</p>
          </div>

          <div class="flex flex-wrap justify-center gap-4">
            ${tags.map(tag => {
              const ratio = tag.count / maxCount;
              let size = 'tag-size-1';
              if (ratio > 0.8) size = 'tag-size-6';
              else if (ratio > 0.6) size = 'tag-size-5';
              else if (ratio > 0.4) size = 'tag-size-4';
              else if (ratio > 0.2) size = 'tag-size-3';
              else if (ratio > 0.1) size = 'tag-size-2';

              return `
                <a href="/articles?tag=${encodeURIComponent(tag.name)}"
                   class="tag-cloud-item tag-size-${Math.ceil(ratio * 6)} px-4 py-2 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 text-cyan-400 rounded-full border border-white/10 hover:border-cyan-500/50 transition-all inline-flex items-center gap-2">
                  ${tag.name}
                  <span class="text-xs opacity-60">(${tag.count})</span>
                </a>
              `;
            }).join('')}
          </div>

          <!-- 标签统计表格 -->
          <div class="mt-16">
            <h2 class="text-2xl font-bold mb-6 text-center">标签统计</h2>
            <div class="overflow-x-auto">
              <table class="w-full max-w-4xl mx-auto">
                <thead>
                  <tr class="border-b border-white/10">
                    <th class="text-left py-3 px-4 text-gray-400">标签</th>
                    <th class="text-center py-3 px-4 text-gray-400">文章</th>
                    <th class="text-center py-3 px-4 text-gray-400">教程</th>
                    <th class="text-center py-3 px-4 text-gray-400">总计</th>
                  </tr>
                </thead>
                <tbody>
                  ${tags.map(tag => `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td class="py-3 px-4">
                        <a href="/articles?tag=${encodeURIComponent(tag.name)}" class="text-cyan-400 hover:underline">${tag.name}</a>
                      </td>
                      <td class="text-center py-3 px-4 text-gray-300">${tag.articles}</td>
                      <td class="text-center py-3 px-4 text-gray-300">${tag.tutorials}</td>
                      <td class="text-center py-3 px-4 font-bold text-white">${tag.count}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <footer class="py-12 border-t border-white/5 flex flex-col items-center gap-4">
        <div class="opacity-30 text-[12px] uppercase tracking-widest">© 2026 AI Insights. Built with Passion.</div>
      </footer>

      <style>
        .btn-layered {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          border: 0.6px solid rgba(255, 255, 255, 0.4);
          transition: all 0.3s ease;
          backdrop-filter: blur(8px);
          cursor: pointer;
        }
        .btn-inner {
          border-radius: 9999px;
          padding: 11px 29px;
          position: relative;
          overflow: hidden;
          z-index: 1;
        }
        .light-streak {
          position: absolute;
          top: -2px;
          left: 50%;
          transform: translateX(-50%);
          width: 70%;
          height: 4px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 70%);
          filter: blur(2px);
          z-index: 2;
          pointer-events: none;
        }
        .btn-layered:hover {
          transform: translateY(-2px);
          border-color: #ffffff;
          box-shadow: 0 10px 25px -10px rgba(255, 255, 255, 0.4);
        }
      </style>
    </body>
    </html>
  `);
});

// 教程列表页面
app.get('/tutorials', (req, res) => {
  const { tag } = req.query;
  let tutorials = getAllTutorials();

  // 按标签筛选
  if (tag) {
    tutorials = tutorials.filter(tutorial =>
      tutorial.tags && tutorial.tags.includes(tag)
    );
  }

  // 按分类分组
  const categories = {};
  tutorials.forEach(t => {
    const cat = t.category || 'other';
    const catName = t.categoryName || '其他';
    if (!categories[cat]) {
      categories[cat] = { name: catName, items: [] };
    }
    categories[cat].items.push(t);
  });

  // 获取所有标签
  const allTags = [...new Set(
    getAllTutorials()
      .filter(a => a.tags)
      .flatMap(a => a.tags)
  )];

  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${tag ? `标签: ${tag} - ` : ''}技术教程 | AI Insights</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'General Sans', sans-serif;
          background-color: #050505;
          color: white;
        }
        .tutorial-card {
          transition: all 0.3s ease;
        }
        .tutorial-card:hover {
          transform: translateY(-5px);
        }
        .category-badge {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
      </style>
    </head>
    <body>
      <nav class="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-5 md:px-[120px] md:py-[18px] z-50 backdrop-blur-2xl bg-black/10 border-b border-white/5">
        <div class="flex items-center gap-[40px]">
          <div class="text-[20px] font-medium tracking-tight cursor-pointer" onclick="window.location.href='/'">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <div class="hidden md:flex items-center gap-[30px]">
            <a href="/" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">首页</a>
            <a href="/articles" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">文章</a>
            <a href="/tutorials" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">教程</a>
            <a href="/search" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">搜索</a>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <button id="menu-button" class="md:hidden p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </nav>

      <!-- 移动端菜单 -->
      <div id="mobile-menu" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl hidden flex-col">
        <div class="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div class="text-[20px] font-medium tracking-tight">
            AI <span class="text-white/50">INSIGHTS</span>
          </div>
          <button id="close-menu-button" class="p-2 rounded-full bg-white/5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="flex flex-col gap-6 p-6">
          <a href="/" class="text-lg font-medium py-2 border-b border-white/10">首页</a>
          <a href="/articles" class="text-lg font-medium py-2 border-b border-white/10">文章</a>
          <a href="/tutorials" class="text-lg font-medium py-2 border-b border-white/10">教程</a>
          <a href="/search" class="text-lg font-medium py-2 border-b border-white/10">搜索</a>
        </div>
        <div class="mt-auto p-6 border-t border-white/10">
          <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group w-full justify-center">
            <div class="light-streak"></div>
            <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              关注 Twitter
            </div>
          </a>
        </div>
      </div>

      <script>
        const menuButton = document.getElementById('menu-button');
        const closeMenuButton = document.getElementById('close-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');

        menuButton.addEventListener('click', () => {
          mobileMenu.classList.remove('hidden');
        });

        closeMenuButton.addEventListener('click', () => {
          mobileMenu.classList.add('hidden');
        });
      </script>

      <div class="pt-32 pb-20 px-6">
        <div class="max-w-6xl mx-auto">
          <h1 class="text-4xl font-bold mb-4 text-center">${tag ? `标签: ${tag}` : '技术教程'}</h1>
          <p class="text-gray-400 text-center mb-8">${tag ? '查看该标签下的所有教程' : '系统学习 AI 相关技术,从基础到实战'}</p>

          <!-- 标签云 -->
          <div class="mb-8 flex flex-wrap gap-2 justify-center">
            <a href="/tutorials" class="px-3 py-1 rounded-full text-sm transition-all ${!tag ? 'bg-cyan-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">全部</a>
            ${allTags.map(t => `
              <a href="/tutorials?tag=${encodeURIComponent(t)}" class="px-3 py-1 rounded-full text-sm transition-all ${tag === t ? 'bg-cyan-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}">${t}</a>
            `).join('')}
          </div>

          ${Object.entries(categories).length > 0 ? Object.entries(categories).map(([catKey, cat]) => `
            <div class="mb-12">
              <h2 class="text-2xl font-bold mb-6 flex items-center gap-3">
                <span class="category-badge px-3 py-1 rounded-lg text-sm">${cat.name}</span>
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                ${cat.items.map(tutorial => `
                  <div class="tutorial-card bg-white/5 rounded-2xl p-6 border border-white/10">
                    <h3 class="text-xl font-bold mb-3">
                      <a href="/tutorial/${tutorial.id}" class="hover:text-cyan-400 transition-colors">${tutorial.title}</a>
                    </h3>
                    <div class="flex flex-wrap items-center gap-2 text-gray-400 mb-3">
                      <span class="flex items-center gap-1 text-sm">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        ${tutorial.date}
                      </span>
                      ${tutorial.readingTime ? `
                      <span class="flex items-center gap-1 text-sm">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        ${tutorial.readingTime}分钟
                      </span>` : ''}
                      ${tutorial.tags ? tutorial.tags.map(t => `
                        <a href="/tutorials?tag=${encodeURIComponent(t)}" class="px-2 py-0.5 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-400 rounded-full text-xs hover:from-cyan-500/30 hover:to-purple-500/30 transition-all">${t}</a>
                      `).join('') : ''}
                    </div>
                    <p class="text-gray-300 mb-4">${tutorial.description}</p>
                    <a href="/tutorial/${tutorial.id}" class="text-cyan-400 hover:underline">开始学习 →</a>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('') : `
            <div class="text-center py-12 text-gray-400">
              <p class="text-xl mb-4">没有找到相关教程</p>
              <a href="/tutorials" class="text-cyan-400 hover:underline">查看所有教程</a>
            </div>
          `}
        </div>
      </div>

      <footer class="py-12 border-t border-white/5 flex flex-col items-center gap-4">
        <div class="opacity-30 text-[12px] uppercase tracking-widest">© 2026 AI Insights. Built with Passion.</div>
      </footer>

      <style>
        .btn-layered {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          border: 0.6px solid rgba(255, 255, 255, 0.4);
          transition: all 0.3s ease;
          backdrop-filter: blur(8px);
          cursor: pointer;
        }
        .btn-inner {
          border-radius: 9999px;
          padding: 11px 29px;
          position: relative;
          overflow: hidden;
          z-index: 1;
        }
        .light-streak {
          position: absolute;
          top: -2px;
          left: 50%;
          transform: translateX(-50%);
          width: 70%;
          height: 4px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 70%);
          filter: blur(2px);
          z-index: 2;
          pointer-events: none;
        }
        .btn-layered:hover {
          transform: translateY(-2px);
          border-color: #ffffff;
          box-shadow: 0 10px 25px -10px rgba(255, 255, 255, 0.4);
        }
      </style>
    </body>
    </html>
  `);
});

// 教程详情页面
app.get('/tutorial/:id', (req, res) => {
  const { id } = req.params;
  const tutorial = parseArticle(path.join(__dirname, 'tutorials', `${id}.md`));

  if (tutorial) {
    const siteUrl = 'https://aiinsights.example.com';
    const tutorialUrl = `${siteUrl}/tutorial/${id}`;
    const description = tutorial.metadata.description || `${tutorial.metadata.title} - 实用的AI技术教程`;

    res.send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${tutorial.metadata.title} | AI Insights 教程</title>
        <meta name="description" content="${description}">
        <meta name="keywords" content="${tutorial.metadata.tags ? tutorial.metadata.tags.join(', ') : 'AI教程, 技术教程, 人工智能'}">
        <meta name="author" content="${tutorial.metadata.author || 'Lucas'}">
        <meta name="robots" content="index, follow">
        <link rel="canonical" href="${tutorialUrl}">

        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="article">
        <meta property="og:url" content="${tutorialUrl}">
        <meta property="og:title" content="${tutorial.metadata.title} | AI Insights 教程">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${tutorial.metadata.cover || siteUrl + '/og-image.png'}">
        <meta property="og:locale" content="zh_CN">
        <meta property="article:published_time" content="${tutorial.metadata.date}">
        <meta property="article:author" content="${tutorial.metadata.author || 'Lucas'}">

        <!-- Twitter Card -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="${tutorialUrl}">
        <meta name="twitter:title" content="${tutorial.metadata.title} | AI Insights 教程">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${tutorial.metadata.cover || siteUrl + '/og-image.png'}">
        <meta name="twitter:creator" content="@Lucas9693265618">

        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'General Sans', sans-serif;
            background-color: #050505;
            color: white;
          }
          .tutorial-content {
            max-width: 800px;
            margin: 0 auto;
          }
          .tutorial-content h1, .tutorial-content h2, .tutorial-content h3 {
            margin-top: 2rem;
            margin-bottom: 1rem;
          }
          .tutorial-content h1 { font-size: 2.5rem; }
          .tutorial-content h2 { font-size: 1.75rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem; }
          .tutorial-content h3 { font-size: 1.25rem; }
          .tutorial-content p {
            margin-bottom: 1rem;
            line-height: 1.6;
          }
          .tutorial-content a {
            color: #38bdf8;
            text-decoration: none;
          }
          .tutorial-content a:hover {
            text-decoration: underline;
          }
          .tutorial-content ul, .tutorial-content ol {
            margin-bottom: 1rem;
            padding-left: 1.5rem;
          }
          .tutorial-content li {
            margin-bottom: 0.5rem;
          }
          /* 代码块样式 */
          .tutorial-content pre {
            background: #0d1117;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            margin: 1.5rem 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
          }
          .tutorial-content code {
            font-family: 'Fira Code', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
          }
          .tutorial-content :not(pre) > code {
            background: rgba(255, 255, 255, 0.1);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
          }
          /* 代码块复制按钮 */
          .copy-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(255, 255, 255, 0.1);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            color: white;
            cursor: pointer;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
          }
          .tutorial-content pre:hover .copy-btn {
            opacity: 1;
          }
          .copy-btn:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          /* 表格样式 */
          .tutorial-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            font-size: 0.95rem;
          }
          .tutorial-content th {
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            font-weight: 600;
            text-align: left;
            padding: 10px 16px;
            border-bottom: 2px solid rgba(56, 189, 248, 0.4);
          }
          .tutorial-content td {
            padding: 10px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            color: #e5e7eb;
          }
          .tutorial-content tr:hover td {
            background: rgba(255, 255, 255, 0.03);
          }
          /* 阅读进度条 */
          .reading-progress {
            position: fixed;
            top: 0;
            left: 0;
            width: 0%;
            height: 3px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            z-index: 9999;
            transition: width 0.1s ease-out;
          }
          /* 教程目录导航 */
          .tutorial-toc {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
          }
          .tutorial-toc-title {
            font-weight: 600;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .tutorial-toc-list {
            list-style: none;
            padding: 0;
            margin: 0;
          }
          .tutorial-toc-item {
            margin-bottom: 0.5rem;
          }
          .tutorial-toc-item.level-3 {
            padding-left: 1rem;
          }
          .tutorial-toc-link {
            color: rgba(255, 255, 255, 0.6);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
            display: block;
            padding: 0.25rem 0;
            border-left: 2px solid transparent;
            padding-left: 0.75rem;
          }
          .tutorial-toc-link:hover {
            color: #38bdf8;
            border-left-color: #38bdf8;
          }
        </style>
      </head>
      <body>
        <!-- 阅读进度条 -->
        <div class="reading-progress" id="readingProgress"></div>

        <nav class="fixed top-0 left-0 w-full flex items-center justify-between px-6 py-5 md:px-[120px] md:py-[18px] z-50 backdrop-blur-2xl bg-black/10 border-b border-white/5">
          <div class="flex items-center gap-[40px]">
            <div class="text-[20px] font-medium tracking-tight cursor-pointer" onclick="window.location.href='/'">
              AI <span class="text-white/50">INSIGHTS</span>
            </div>
            <div class="hidden md:flex items-center gap-[30px]">
              <a href="/" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">首页</a>
              <a href="/articles" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">文章</a>
              <a href="/tutorials" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">教程</a>
              <a href="/search" class="text-[14px] font-medium opacity-70 hover:opacity-100 transition-opacity">搜索</a>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <button id="menu-button" class="md:hidden p-2 rounded-full bg-white/5">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </button>
            <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group">
              <div class="light-streak"></div>
              <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                关注 Twitter
              </div>
            </a>
          </div>
        </nav>

        <!-- 移动端菜单 -->
        <div id="mobile-menu" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl hidden flex-col">
          <div class="flex items-center justify-between px-6 py-5 border-b border-white/10">
            <div class="text-[20px] font-medium tracking-tight">
              AI <span class="text-white/50">INSIGHTS</span>
            </div>
            <button id="close-menu-button" class="p-2 rounded-full bg-white/5">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div class="flex flex-col gap-6 p-6">
            <a href="/" class="text-lg font-medium py-2 border-b border-white/10">首页</a>
            <a href="#stack" class="text-lg font-medium py-2 border-b border-white/10">技术栈</a>
            <a href="#lab" class="text-lg font-medium py-2 border-b border-white/10">开源探索</a>
            <a href="#ai-tools" class="text-lg font-medium py-2 border-b border-white/10">工具推荐</a>
            <a href="#about" class="text-lg font-medium py-2 border-b border-white/10">关于我</a>
            <a href="/articles" class="text-lg font-medium py-2 border-b border-white/10">文章</a>
            <a href="/tutorials" class="text-lg font-medium py-2 border-b border-white/10">教程</a>
            <a href="/search" class="text-lg font-medium py-2 border-b border-white/10">搜索</a>
          </div>
          <div class="mt-auto p-6 border-t border-white/10">
            <a href="https://twitter.com/Lucas9693265618" target="_blank" class="btn-layered group w-full justify-center">
              <div class="light-streak"></div>
              <div class="btn-inner bg-black/40 text-[14px] font-medium flex items-center gap-2">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                关注 Twitter
              </div>
            </a>
          </div>
        </div>

        <script>
          // 移动端菜单
          const menuButton = document.getElementById('menu-button');
          const closeMenuButton = document.getElementById('close-menu-button');
          const mobileMenu = document.getElementById('mobile-menu');

          menuButton.addEventListener('click', () => {
            mobileMenu.classList.remove('hidden');
          });

          closeMenuButton.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
          });
        </script>

        <div class="pt-32 pb-20 px-6">
          <div class="tutorial-content max-w-4xl mx-auto">
            <div class="mb-8">
              <a href="/tutorials" class="text-cyan-400 hover:underline">← 返回教程列表</a>
            </div>
            <h1 class="text-4xl font-bold mb-4">${tutorial.metadata.title}</h1>
            <div class="flex flex-wrap items-center gap-3 text-gray-400 mb-8">
              <span class="flex items-center gap-1 text-sm">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                ${tutorial.metadata.date}
              </span>
              <span class="flex items-center gap-1 text-sm">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                约${tutorial.readingTime}分钟阅读
              </span>
              ${tutorial.metadata.tags ? tutorial.metadata.tags.map(t => `<a href="/tutorials?tag=${encodeURIComponent(t)}" class="px-3 py-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 text-cyan-400 rounded-full text-sm">${t}</a>`).join('') : ''}
              ${tutorial.metadata.categoryName ? `<span class="ml-2 px-2 py-0.5 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 rounded text-sm">${tutorial.metadata.categoryName}</span>` : ''}
            </div>

            ${tutorial.toc && tutorial.toc.length > 0 ? `
            <!-- 教程目录 -->
            <div class="tutorial-toc">
              <div class="tutorial-toc-title">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
                目录
              </div>
              <ul class="tutorial-toc-list">
                ${tutorial.toc.map(item => `
                  <li class="tutorial-toc-item level-${item.level}">
                    <a href="#${item.id}" class="tutorial-toc-link">${item.text}</a>
                  </li>
                `).join('')}
              </ul>
            </div>
            ` : ''}

            <div class="prose prose-invert max-w-none">
              ${addIdsToHeadings(tutorial.content)}
            </div>

            <!-- 点赞/踩功能 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-4">觉得这个教程如何?</h3>
              <div class="flex items-center gap-4">
                <button id="likeBtn" onclick="handleLike()" class="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all hover:scale-105">
                  <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>
                  <span id="likeCount">0</span> 点赞
                </button>
                <button id="dislikeBtn" onclick="handleDislike()" class="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all hover:scale-105">
                  <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-9V4a1 1 0 00-1-1h-4.486a.486.486 0 00-.354.146l-2.414 2.414a1 1 0 00-.268.394l-.036.073a.486.486 0 00-.146.354V17a2 2 0 002 2h10a2 2 0 002-2v-2.828a.486.486 0 00-.146-.354l-.036-.073a1 1 0 00-.268-.394l-2.414-2.414a.486.486 0 00-.354-.146H6a1 1 0 00-1 1v2.828m8-4a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                  <span id="dislikeCount">0</span> 踩
                </button>
              </div>
            </div>

            <!-- 社交分享按钮 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-4">分享这个教程</h3>
              <div class="flex flex-wrap gap-3">
                <button onclick="shareToTwitter()" class="flex items-center gap-2 px-4 py-2 bg-[#1DA1F2]/20 hover:bg-[#1DA1F2]/30 text-[#1DA1F2] rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                  Twitter
                </button>
                <button onclick="shareToWechat()" class="flex items-center gap-2 px-4 py-2 bg-[#07C160]/20 hover:bg-[#07C160]/30 text-[#07C160] rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.838.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.173l-.327-1.233a.582.582 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89a5.718 5.718 0 00-.406-.032zm-1.84 3.133c.536 0 .97.44.97.983a.976.976 0 01-.97.983.976.976 0 01-.97-.983c0-.542.434-.983.97-.983zm4.857 0c.536 0 .97.44.97.983a.976.976 0 01-.97.983.976.976 0 01-.97-.983c0-.542.434-.983.97-.983z"/></svg>
                  微信
                </button>
                <button onclick="copyLink()" class="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg transition-colors">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  复制链接
                </button>
              </div>
            </div>

            <!-- 打赏功能 -->
            <div class="mt-12 pt-8 border-t border-white/10">
              <h3 class="text-lg font-semibold mb-6 text-center">💝 支持作者</h3>
              <div class="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 rounded-2xl p-8 border border-white/10">
                <p class="text-center text-white/70 mb-6">如果这篇文章对你有帮助,可以请作者喝杯咖啡~</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <!-- 微信打赏 -->
                  <div class="text-center">
                    <div class="bg-white rounded-xl p-4 mb-3 max-w-[200px] mx-auto">
                      <div class="text-6xl mb-2">💚</div>
                      <p class="text-gray-600 text-sm">微信收款码</p>
                      <p class="text-xs text-gray-400 mt-1">(请添加微信收款码图片)</p>
                    </div>
                    <button onclick="alert('请扫描上方二维码或联系作者获取微信收款码')" class="px-6 py-2 bg-[#07C160] hover:bg-[#06a50e] text-white rounded-lg transition-colors text-sm font-medium">
                      微信支付
                    </button>
                  </div>

                  <!-- 支付宝打赏 -->
                  <div class="text-center">
                    <div class="bg-white rounded-xl p-4 mb-3 max-w-[200px] mx-auto">
                      <div class="text-6xl mb-2">💙</div>
                      <p class="text-gray-600 text-sm">支付宝收款码</p>
                      <p class="text-xs text-gray-400 mt-1">(请添加支付宝收款码图片)</p>
                    </div>
                    <button onclick="alert('请扫描上方二维码或联系作者获取支付宝收款码')" class="px-6 py-2 bg-[#1677FF] hover:bg-[#096dd9] text-white rounded-lg transition-colors text-sm font-medium">
                      支付宝
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <script>
              // 分享到Twitter
              function shareToTwitter() {
                const text = encodeURIComponent(document.title);
                const url = encodeURIComponent(window.location.href);
                window.open('https://twitter.com/intent/tweet?text=' + text + '&url=' + url, '_blank', 'width=550,height=450');
              }

              // 分享到微信(显示二维码提示)
              function shareToWechat() {
                alert('请复制链接后在微信中粘贴分享');
                copyLink();
              }

              // 复制链接
              function copyLink() {
                navigator.clipboard.writeText(window.location.href).then(() => {
                  alert('链接已复制到剪贴板');
                });
              }

              // 代码块复制功能
              document.querySelectorAll('.tutorial-content pre').forEach(pre => {
                const btn = document.createElement('button');
                btn.className = 'copy-btn';
                btn.textContent = '复制';
                btn.onclick = () => {
                  const code = pre.querySelector('code');
                  navigator.clipboard.writeText(code.textContent).then(() => {
                    btn.textContent = '已复制!';
                    setTimeout(() => btn.textContent = '复制', 2000);
                  });
                };
                pre.appendChild(btn);
              });
            </script>

            <!-- 评论系统 -->
            <div class="mt-12 border-t border-white/10 pt-8">
              <h3 class="text-2xl font-bold mb-6">评论</h3>

              <!-- 评论表单 -->
              <div class="mb-8 bg-white/5 rounded-xl p-6 border border-white/10">
                <h4 class="text-lg font-semibold mb-4">发表评论</h4>
                <form id="commentForm">
                  <div class="mb-4">
                    <input type="text" id="commentAuthor" placeholder="您的昵称" class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white" required>
                  </div>
                  <div class="mb-4">
                    <textarea id="commentContent" placeholder="写下您的评论..." rows="4" class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-white resize-none" required></textarea>
                  </div>
                  <button type="submit" class="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors font-medium">
                    发布评论
                  </button>
                </form>
              </div>

              <!-- 评论列表 -->
              <div id="commentsList" class="space-y-6">
                <div class="text-center py-8 text-gray-400">
                  <p>加载评论中...</p>
                </div>
              </div>
            </div>

            <script>
              const tutorialId = '${id}';
              const tutorialTitle = '${tutorial.metadata.title}';

              function loadComments() {
                const container = document.getElementById('commentsList');
                const allComments = JSON.parse(localStorage.getItem('comments') || '{}');
                const comments = allComments['tutorial_' + tutorialId] || [];

                if (comments.length === 0) {
                  container.innerHTML = '<div class="text-center py-8 text-gray-400"><p>还没有评论,快来抢沙发!</p></div>';
                  return;
                }

                let html = '';
                comments.forEach(function(comment) {
                  html += '<div class="bg-white/5 rounded-xl p-6 border border-white/10">';
                  html += '<div class="flex items-center gap-3 mb-4">';
                  html += '<div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center text-white font-bold">' + comment.author.charAt(0).toUpperCase() + '</div>';
                  html += '<div><h5 class="font-semibold">' + escapeHtml(comment.author) + '</h5><p class="text-xs text-gray-400">' + formatDate(comment.timestamp) + '</p></div></div>';
                  html += '<p class="text-gray-300 mb-4">' + escapeHtml(comment.content) + '</p>';
                  html += '<button class="reply-btn text-cyan-400 hover:text-cyan-300 text-sm">回复</button>';
                  html += '</div>';
                });

                container.innerHTML = html;
                bindReplyBtns();
              }

              function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
              }

              function formatDate(ts) {
                const d = new Date(ts);
                const now = new Date();
                const diff = now - d;
                if (diff < 60000) return '刚刚';
                if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
                if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
                if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
                return d.toLocaleDateString('zh-CN', {year:'numeric', month:'long', day:'numeric'});
              }

              function bindReplyBtns() {
                document.querySelectorAll('.reply-btn').forEach(function(btn) {
                  btn.addEventListener('click', function() {
                    alert('回复功能开发中,敬请期待!');
                  });
                });
              }

              document.getElementById('commentForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const author = document.getElementById('commentAuthor').value.trim();
                const content = document.getElementById('commentContent').value.trim();
                if (!author || !content) {
                  alert('请填写昵称和评论');
                  return;
                }
                const comment = {
                  id: 'c' + Date.now(),
                  author: author,
                  content: content,
                  timestamp: new Date().toISOString()
                };
                const all = JSON.parse(localStorage.getItem('comments') || '{}');
                const list = all['tutorial_' + tutorialId] || [];
                list.push(comment);
                all['tutorial_' + tutorialId] = list;
                localStorage.setItem('comments', JSON.stringify(all));
                this.reset();
                loadComments();
              });

              // 页面加载后延迟调用 loadComments,确保 DOM 已完全就绪
              function safeLoadComments() {
                try {
                  loadComments();
                } catch (e) {
                  console.error('加载评论失败:', e);
                  const container = document.getElementById('commentsList');
                  if (container) {
                    container.innerHTML = '<div class="text-center py-8 text-gray-400"><p>评论加载失败,请刷新重试</p></div>';
                  }
                }
              }

              // 多种方式确保 loadComments 被调用
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', safeLoadComments);
              } else {
                requestAnimationFrame(safeLoadComments);
                setTimeout(safeLoadComments, 500);
              }
            </script>
          </div>
        </div>

        <!-- 返回顶部按钮 -->
        <button id="backToTop" class="fixed bottom-8 right-8 w-12 h-12 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full shadow-lg flex items-center justify-center opacity-0 transition-opacity duration-300 hover:scale-110 z-50" title="返回顶部">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
          </svg>
        </button>

        <script>
          // 返回顶部功能
          const backToTopBtn = document.getElementById('backToTop');
          window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
              backToTopBtn.style.opacity = '1';
            } else {
              backToTopBtn.style.opacity = '0';
            }
          });
          backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });

          // 阅读进度条
          window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = (scrollTop / docHeight) * 100;
            document.getElementById('readingProgress').style.width = progress + '%';
          });

          // 网络断开检测
          window.addEventListener('offline', () => {
            document.getElementById('offlineNotification').classList.remove('hidden');
          });
          window.addEventListener('online', () => {
            document.getElementById('offlineNotification').classList.add('hidden');
          });
        </script>

            
        <footer class="py-12 border-t border-white/5 flex flex-col items-center gap-4">
          <div class="opacity-30 text-[12px] uppercase tracking-widest">© 2026 AI Insights. Built with Passion.</div>
        </footer>

        <style>
          .btn-layered {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 9999px;
            border: 0.6px solid rgba(255, 255, 255, 0.4);
            transition: all 0.3s ease;
            backdrop-filter: blur(8px);
            cursor: pointer;
          }
          .btn-inner {
            border-radius: 9999px;
            padding: 11px 29px;
            position: relative;
            overflow: hidden;
            z-index: 1;
          }
          .light-streak {
            position: absolute;
            top: -2px;
            left: 50%;
            transform: translateX(-50%);
            width: 70%;
            height: 4px;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 70%);
            filter: blur(2px);
            z-index: 2;
            pointer-events: none;
          }
          .btn-layered:hover {
            transform: translateY(-2px);
            border-color: #ffffff;
            box-shadow: 0 10px 25px -10px rgba(255, 255, 255, 0.4);
          }
          .category-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
        </style>
      </body>
      </html>
    `);
  } else {
    res.status(404).send('Tutorial not found');
  }
});

// 搜索页面
app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'search.html'));
});

// Sitemap 生成
app.get('/sitemap.xml', (req, res) => {
  const siteUrl = 'https://aiinsights.example.com';

  // 解析 frontmatter 的辅助函数
  function parseFrontmatter(content) {
    const parts = content.split('---\n');
    const frontMatter = parts[1];
    const metadata = {};
    frontMatter.split('\n').forEach(line => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        let key = match[1].trim();
        let value = match[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith('[') && value.endsWith(']')) {
          value = JSON.parse(value);
        }
        metadata[key] = value;
      }
    });
    return metadata;
  }

  // 获取所有文章
  const articles = fs.readdirSync(path.join(__dirname, 'articles'))
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const id = file.replace('.md', '');
      const content = fs.readFileSync(path.join(__dirname, 'articles', file), 'utf-8');
      const frontmatter = parseFrontmatter(content);
      return {
        id,
        url: `${siteUrl}/article/${id}`,
        lastmod: frontmatter.date || new Date().toISOString().split('T')[0],
        priority: '0.8',
        changefreq: 'weekly'
      };
    });

  // 获取所有教程
  const tutorials = fs.readdirSync(path.join(__dirname, 'tutorials'))
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const id = file.replace('.md', '');
      const content = fs.readFileSync(path.join(__dirname, 'tutorials', file), 'utf-8');
      const frontmatter = parseFrontmatter(content);
      return {
        id,
        url: `${siteUrl}/tutorial/${id}`,
        lastmod: frontmatter.date || new Date().toISOString().split('T')[0],
        priority: '0.7',
        changefreq: 'monthly'
      };
    });

  const today = new Date().toISOString().split('T')[0];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${today}</lastmod>
    <priority>1.0</priority>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>${siteUrl}/articles</loc>
    <lastmod>${today}</lastmod>
    <priority>0.9</priority>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>${siteUrl}/tutorials</loc>
    <lastmod>${today}</lastmod>
    <priority>0.9</priority>
    <changefreq>weekly</changefreq>
  </url>
  <url>
    <loc>${siteUrl}/search</loc>
    <lastmod>${today}</lastmod>
    <priority>0.5</priority>
    <changefreq>monthly</changefreq>
  </url>
  ${articles.map(a => `
  <url>
    <loc>${a.url}</loc>
    <lastmod>${a.lastmod}</lastmod>
    <priority>${a.priority}</priority>
    <changefreq>${a.changefreq}</changefreq>
  </url>`).join('')}
  ${tutorials.map(t => `
  <url>
    <loc>${t.url}</loc>
    <lastmod>${t.lastmod}</lastmod>
    <priority>${t.priority}</priority>
    <changefreq>${t.changefreq}</changefreq>
  </url>`).join('')}
</urlset>`;

  res.header('Content-Type', 'application/xml');
  res.send(sitemap);
});

// RSS Feed 生成
app.get('/rss.xml', (req, res) => {
  const siteUrl = 'https://aiinsights.example.com';

  // 解析 frontmatter 的辅助函数
  function parseFrontmatter(content) {
    const parts = content.split('---\n');
    const frontMatter = parts[1];
    const metadata = {};
    frontMatter.split('\n').forEach(line => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        let key = match[1].trim();
        let value = match[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith('[') && value.endsWith(']')) {
          value = JSON.parse(value);
        }
        metadata[key] = value;
      }
    });
    return metadata;
  }

  const articles = fs.readdirSync(path.join(__dirname, 'articles'))
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const id = file.replace('.md', '');
      const content = fs.readFileSync(path.join(__dirname, 'articles', file), 'utf-8');
      const frontmatter = parseFrontmatter(content);
      return {
        id,
        title: frontmatter.title || 'Untitled',
        description: frontmatter.description || '',
        date: frontmatter.date || new Date().toISOString(),
        url: `${siteUrl}/article/${id}`
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const tutorials = fs.readdirSync(path.join(__dirname, 'tutorials'))
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const id = file.replace('.md', '');
      const content = fs.readFileSync(path.join(__dirname, 'tutorials', file), 'utf-8');
      const frontmatter = parseFrontmatter(content);
      return {
        id,
        title: frontmatter.title || 'Untitled',
        description: frontmatter.description || '',
        date: frontmatter.date || new Date().toISOString(),
        url: `${siteUrl}/tutorial/${id}`
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const allItems = [...articles, ...tutorials]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Insights</title>
    <link>${siteUrl}</link>
    <description>深入探索AI前沿技术、开源项目和智能工具</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    ${allItems.map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.url}</link>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${new Date(item.date).toUTCString()}</pubDate>
      <guid>${item.url}</guid>
    </item>`).join('')}
  </channel>
</rss>`;

  res.header('Content-Type', 'application/rss+xml');
  res.send(rss);
});

// 静态文件服务(放在路由之后,作为 fallback)
app.use(express.static(__dirname));

// 404 错误页面
app.use((req, res, next) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - 页面未找到 | AI Insights</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
          color: white;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          text-align: center;
          max-width: 600px;
        }
        .error-code {
          font-size: 150px;
          font-weight: bold;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 20px;
          line-height: 1;
        }
        h1 {
          font-size: 32px;
          margin-bottom: 16px;
          color: #fff;
        }
        p {
          font-size: 18px;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 32px;
          line-height: 1.6;
        }
        .buttons {
          display: flex;
          gap: 16px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .btn {
          padding: 12px 32px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          transition: all 0.3s ease;
        }
        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .illustration {
          margin-bottom: 40px;
        }
        .illustration svg {
          width: 200px;
          height: 200px;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="illustration">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" stroke="rgba(102, 126, 234, 0.3)" stroke-width="2" fill="none"/>
            <circle cx="100" cy="100" r="60" stroke="rgba(118, 75, 162, 0.3)" stroke-width="2" fill="none"/>
            <text x="100" y="115" text-anchor="middle" fill="rgba(255, 255, 255, 0.5)" font-size="40" font-weight="bold">?</text>
          </svg>
        </div>
        <div class="error-code">404</div>
        <h1>页面未找到</h1>
        <p>抱歉,您访问的页面不存在或已被移除。<br>可能的原因:链接错误、页面已删除或URL输入有误。</p>
        <div class="buttons">
          <a href="/" class="btn btn-primary">返回首页</a>
          <a href="/articles" class="btn btn-secondary">浏览文章</a>
          <a href="/search" class="btn btn-secondary">搜索内容</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 根路径重定向到 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});