---
title: "DeepSeek API 百万Token上下文实战：如何用超长上下文构建「书童级」AI应用"
category: "api-development"
categoryName: "API开发实战"
date: "2026-04-23"
tags: ["DeepSeek", "API", "长上下文", "LLM应用"]
description: "DeepSeek API现已支持100万Token上下文窗口，相当于可以一次性读完《三体》三部曲。本文手把手教你如何调用这一能力，构建长文档分析、多文件比对、超长代码库理解等实用场景。"
---

2026年4月22日，DeepSeek官方API完成重磅升级，上下文窗口从128k tokens直接扩展至100万tokens。这意味着你可以一次性将一整部《三体》三部曲（约80万字）全部喂给模型，让AI真正"读完"你给它的内容后再进行深度分析。

本文将通过实际代码示例，手把手教你如何调用DeepSeek API的这一能力，并构建几个实用的"书童级"AI应用场景。

## 环境准备

### 安装依赖

```bash
pip install openai httpx
```

### API调用基础配置

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-deepseek-api-key",
    base_url="https://api.deepseek.com"
)
```

## 场景一：超长文档分析

### 场景描述

你需要让AI分析一份完整的《中华人民共和国刑法》全文（约8万字），提取所有与"网络安全"相关的条款，并总结关键要点。传统做法需要分段落处理，现在可以一次性完成。

### 实现代码

```python
def analyze_long_document(file_path: str, topic: str) -> str:
    """分析超长文档"""
    with open(file_path, 'r', encoding='utf-8') as f:
        document_content = f.read()
    
    prompt = f"""请仔细阅读以下完整文档，然后完成以下任务：
    1. 找出所有与"{topic}"相关的条款/段落
    2. 总结每个相关条款的核心要点
    3. 如果相关条款之间存在关联，请指出这种关联

    【文档内容】
    {document_content}
    """
    
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )
    
    return response.choices[0].message.content

# 使用示例
result = analyze_long_document("criminal_law.txt", "网络安全")
print(result)
```

### 关于Token计算

100万tokens大约等于：
- 75万汉字
- 50万英文单词
- 约300个代码文件（每个约300行）

建议使用tokenizer进行精确计算：

```python
import httpx

def count_tokens(text: str) -> int:
    """通过API估算token数量"""
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": text}],
        max_tokens=1
    )
    # DeepSeek API会返回usage信息
    return response.usage.prompt_tokens

# 实际测试
sample_text = "这是一段测试文本"
tokens = count_tokens(sample_text)
print(f"这段文本约 {tokens} tokens")
```

## 场景二：多文件代码库分析

### 场景描述

你需要让AI理解一个完整的Python项目（假设有50个文件，总计5万行代码），然后回答"这个项目的架构是怎样的？哪些文件负责数据处理？"

### 实现代码

```python
import os
from pathlib import Path

def build_codebase_context(project_path: str) -> str:
    """构建代码库上下文"""
    context_parts = []
    
    for root, dirs, files in os.walk(project_path):
        # 跳过node_modules等目录
        dirs[:] = [d for d in dirs if d not in ['node_modules', '__pycache__', '.git']]
        
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        # 限制每个文件的长度，避免单个文件过大
                        if len(content) > 20000:
                            content = content[:20000] + "\n... [truncated] ..."
                    
                    relative_path = os.path.relpath(file_path, project_path)
                    context_parts.append(f"=== 文件: {relative_path} ===\n{content}\n")
                except Exception as e:
                    print(f"跳过文件 {file_path}: {e}")
    
    return "\n".join(context_parts)

def analyze_codebase(project_path: str, question: str) -> str:
    """分析代码库"""
    codebase_content = build_codebase_context(project_path)
    
    prompt = f"""请仔细阅读以下完整的代码库内容，然后回答问题。

    【代码库内容】
    {codebase_content}

    【问题】
    {question}
    """
    
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )
    
    return response.choices[0].message.content

# 使用示例
result = analyze_codebase(
    "E:\\my_project",
    "这个项目的架构是怎样的？哪些文件负责数据处理？"
)
print(result)
```

## 场景三：书籍级问答系统

### 场景描述

构建一个"书童"应用，让AI完整阅读一本技术书籍后，能够回答关于这本书的任何问题。例如，让AI读完一整本《算法导论》后，回答"请解释什么是红黑树，它的插入操作的时间复杂度是多少？"

### 实现代码

```python
class BookReadingAssistant:
    """书籍阅读助手"""
    
    def __init__(self, api_key: str):
        self.client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        self.full_content = ""
        self.summary = ""
    
    def load_book(self, book_path: str, chunk_size: int = 50000):
        """分段加载书籍内容"""
        with open(book_path, 'r', encoding='utf-8') as f:
            self.full_content = f.read()
        
        # 先生成一个书籍摘要，帮助模型"记住"整体结构
        summary_prompt = f"""请阅读以下书籍内容，然后生成一份详细的摘要，包括：
        1. 书籍的主题和目标读者
        2. 主要章节和它们之间的关系
        3. 核心概念和关键技术
        4. 书籍的整体结构

        【书籍内容】
        {self.full_content[:100000]}  # 先用前10万字生成摘要
        """
        
        summary_response = self.client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": summary_prompt}],
            max_tokens=2048
        )
        self.summary = summary_response.choices[0].message.content
    
    def ask(self, question: str) -> str:
        """基于完整书籍内容回答问题"""
        prompt = f"""你是一位已经仔细阅读了整本书的"书童"。以下是书籍的摘要和关键内容：

        【书籍摘要】
        {self.summary}

        【完整书籍内容】
        {self.full_content}

        现在请回答读者的问题。如果书中没有直接答案，请说明并尝试根据相关章节的内容进行推断。

        【读者问题】
        {question}
        """
        
        response = self.client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096
        )
        
        return response.choices[0].message.content

# 使用示例
assistant = BookReadingAssistant("your-api-key")
assistant.load_book("algorithm_introduction.txt")

answer = assistant.ask("请解释什么是红黑树，它的插入操作的时间复杂度是多少？")
print(answer)
```

## 场景四：长对话上下文管理

### 实现代码

```python
def create_long_context_conversation(system_prompt: str, context_window: int = 1000000):
    """创建超长上下文的对话"""
    messages = [{"role": "system", "content": system_prompt}]
    
    def add_message(role: str, content: str):
        messages.append({"role": role, "content": content})
        
        # 当上下文过长时，进行摘要压缩
        total_tokens = sum(len(m["content"]) // 4 for m in messages)  # 粗略估算
        
        if total_tokens > context_window * 0.8:  # 达到80%阈值时压缩
            compress_context()
    
    def compress_context():
        """压缩上下文，保留摘要和最近对话"""
        nonlocal messages
        
        # 将前面的消息汇总成背景
        background_prompt = f"""请将以下对话历史压缩成一个摘要，保留关键信息和结论：
        {messages[1:]}"""  # 跳过system prompt
        
        summary_response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": background_prompt}],
            max_tokens=2048
        )
        
        summary = summary_response.choices[0].message.content
        messages = [
            messages[0],  # 保留system prompt
            {"role": "system", "content": f"【对话背景摘要】{summary}"},
            *messages[-10:]  # 保留最近10条对话
        ]
    
    def get_response(user_input: str) -> str:
        add_message("user", user_input)
        
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            max_tokens=4096
        )
        
        assistant_reply = response.choices[0].message.content
        messages.append({"role": "assistant", "content": assistant_reply})
        
        return assistant_reply
    
    return get_response

# 使用示例
chat = create_long_context_conversation(
    system_prompt="你是一位资深的软件架构师，在讨论技术方案时你会从可扩展性、性能、成本等多个维度进行分析。"
)

reply1 = chat("我正在设计一个日活1000万的社交APP，后端应该用什么技术栈？")
print(reply1)

reply2 = chat("那如果我要支持视频流媒体呢？")
print(reply2)
```

## 注意事项与最佳实践

### 1. Token消耗监控

```python
def estimate_cost(tokens: int, model: str = "deepseek-chat") -> float:
    """估算API成本"""
    # DeepSeek价格（示例，实际以官方为准）
    price_per_million_tokens = {
        "deepseek-chat": 1.0,  # 元/百万tokens
        "deepseek-coder": 1.0,
    }
    return (tokens / 1_000_000) * price_per_million_tokens.get(model, 1.0)
```

### 2. 响应超时处理

```python
import httpx

def call_with_timeout(prompt: str, timeout: int = 120) -> str:
    """带超时的API调用"""
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            timeout=timeout
        )
        return response.choices[0].message.content
    except httpx.TimeoutException:
        return "请求超时，请减少上下文长度或稍后重试"
```

### 3. 分块处理大文件

```python
def process_large_file(file_path: str, chunk_size: int = 80000) -> list:
    """分块处理大文件"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    chunks = []
    for i in range(0, len(content), chunk_size):
        chunks.append(content[i:i + chunk_size])
    
    return chunks
```

## 总结

DeepSeek API的100万Token上下文窗口，为开发者打开了"书童级"AI应用的大门。通过本文的示例，你可以快速构建：

- **超长文档分析**：一次性分析整本法律条文、学术论文
- **代码库理解**：让AI完整理解整个项目的架构和逻辑
- **书籍级问答**：构建真正的"读书助手"
- **长对话管理**：自动压缩上下文，保持对话连贯性

关键技巧在于：合理估算Token消耗、分块处理超大文件、以及善用上下文压缩策略。掌握这些，你就能让AI真正成为能"读完"并"记住"一切内容的智能助手。