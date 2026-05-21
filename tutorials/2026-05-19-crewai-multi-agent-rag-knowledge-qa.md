---
title: "手把手教你用 CrewAI 构建多智能体 RAG 问答系统"
category: "ai-agent"
categoryName: "AI Agent 实战"
date: "2026-05-19"
tags: ["CrewAI", "RAG", "向量数据库", "多智能体", "AI Agent"]
description: "从环境搭建到生产部署，手把手实现一个基于 CrewAI 的多智能体 RAG 问答系统，支持本地知识库检索、意图分析、内容生成全流程，适合想落地 AI 应用一二线的开发者。"
---

## 前言：为什么需要多智能体 RAG？

传统单 Agent RAG 系统的典型流程是：**用户提问 → 向量检索 → 拼 Prompts → 大模型回答**。这条链路简单有效，但存在两个致命问题：

1. **检索质量无法动态评估**：无论检索结果好不好，都直接拼进 Context 给大模型，回答质量完全取决于召回的文档相关性。
2. **多任务处理能力弱**：当用户的问题是复合型问题（需要先分析、再搜索、再总结）时，单 Agent 无法优雅地处理任务间的依赖关系。

CrewAI 的多智能体架构天然解决了这两个问题：可以用专门的 **Researcher Agent** 负责评估检索质量并决定是否补充搜索，用 **Analyst Agent** 负责拆解问题并路由到不同知识库，用 **Writer Agent** 负责最终输出——每个 Agent 各司其职，协作链路清晰可调试。

本文教你从零构建这样一套系统。

---

## 环境准备

### 依赖安装

```bash
pip install crewai==0.80.0 \
  crewai-tools==0.15.0 \
  faiss-cpu==1.9.0 \
  sentence-transformers==3.3.0 \
  langchain==0.3.17 \
  langchain-community==0.3.17 \
  unstructured==0.16.0 \
  tiktoken==0.8.0
```

> 推荐 Python 3.10+，16GB 以上内存（跑本地 Embedding 模型）。

### API 配置

```bash
export OPENAI_API_KEY="sk-..."
# 如果你使用其他模型，可以用 LiteLLM 方式接入
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## 第一步：构建本地向量知识库

### 1.1 文档加载与分块

使用 LangChain 的文档加载器读取 Markdown、PDF、TXT 等格式的本地文档：

```python
from langchain_community.document_loaders import DirectoryLoader, UnstructuredMarkdownLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 加载 Markdown 文档
loader = DirectoryLoader(
    "knowledge_base/",
    glob="**/*.md",
    loader_cls=UnstructuredMarkdownLoader
)
documents = loader.load()

# 分块：每块 512 tokens，块重叠 64 tokens
splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=64,
    length_function=lambda text: len(text.encode("utf-8"))
)
chunks = splitter.split_documents(documents)
print(f"共生成 {len(chunks)} 个文档块")
```

### 1.2 生成 Embedding 并存入 FAISS

```python
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

# 使用本地 BGE 模型生成向量（中文效果好）
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-large-zh-v1.5",
    model_kwargs={"device": "cpu"}
)

# 构建 FAISS 向量库
vectorstore = FAISS.from_documents(
    documents=chunks,
    embedding=embeddings
)

# 保存到本地
vectorstore.save_local("faiss_index")
print("向量库构建完成，已保存至 faiss_index/")
```

> 如果你的知识库数据量大（>10万段），建议使用 Milvus 或 Qdrant 替代 FAISS，支持分布式查询。

---

## 第二步：定义多 Agent 协作流程

### 2.1 创建检索工具

```python
from crewai.tools import BaseTool
from langchain_community.vectorstores import FAISS

class KnowledgeBaseSearchTool(BaseTool):
    name: str = "知识库检索"
    description: str = "当需要从本地知识库中查找相关文档时使用此工具。输入问题，输出最相关的知识库片段。"

    def _run(self, query: str) -> str:
        vectorstore = FAISS.load_local(
            "faiss_index",
            embeddings=HuggingFaceEmbeddings(model_name="BAAI/bge-large-zh-v1.5"),
            allow_dangerous_deserialization=True
        )
        docs = vectorstore.similarity_search(query, k=5)
        return "\n\n---\n\n".join([f"[来源: {d.metadata.get('source','未知')}]\n{d.page_content}" for d in docs])
```

### 2.2 定义三个专业 Agent

```python
from crewai import Agent, Task, Crew, Process

# 研究员 Agent：负责从知识库检索并评估内容质量
researcher = Agent(
    role="知识库研究员",
    goal="从本地知识库中精准检索与问题最相关的文档片段，并评估内容是否足够回答用户问题。",
    backstory="你是一个严谨的研究员，善于在大量信息中找到最关键的内容。你会批判性地评估检索结果的相关性。",
    verbose=True,
    tools=[KnowledgeBaseSearchTool()]
)

# 分析师 Agent：负责理解问题意图，决定回答策略
analyst = Agent(
    role="问题分析师",
    goal="深入理解用户提问的真实意图，拆解为子问题并给出回答策略。",
    backstory="你是一个经验丰富的战略分析师，擅长将复杂问题拆解为可执行的子任务，并制定最佳回答路径。",
    verbose=True,
    allow_delegation=True  # 允许将子任务委托给研究员
)

# 写作 Agent：负责整合信息，生成最终回答
writer = Agent(
    role="技术写作师",
    goal="基于研究员提供的文档资料，用清晰、专业、有深度的语言撰写完整的回答。",
    backstory="你是一个资深技术作家，曾在顶级科技媒体发表文章，擅长将复杂技术内容转化为易于理解的文字。",
    verbose=True
)
```

### 2.3 定义任务与 Crew 编排

```python
# 任务一：检索并评估
research_task = Task(
    description="用户问题是：「{user_query}」。请使用知识库检索工具搜索相关内容，并判断检索结果是否能充分回答该问题。如果内容不足，请明确说明还缺什么信息。",
    expected_output="一份结构化的检索报告，包含相关文档片段、来源、以及内容充足性评估。",
    agent=researcher
)

# 任务二：分析与策略
analyze_task = Task(
    description="基于研究员的检索报告，深入分析用户问题的意图和最佳回答策略。拆解需要回答的子问题。",
    expected_output="一份问题分析报告，包含意图拆解、回答策略和需要覆盖的关键点。",
    agent=analyst,
    context=[research_task]  # 依赖研究任务的结果
)

# 任务三：撰写回答
write_task = Task(
    description="根据知识库检索内容和问题分析报告，以专业技术博客的风格撰写完整的回答。",
    expected_output="一篇结构清晰、内容详实的完整回答，包含引言、核心分析和总结，适当引用知识库来源。",
    agent=writer,
    context=[research_task, analyze_task]  # 依赖前两个任务
)

# 组建 Crew
crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analyze_task, write_task],
    process=Process.hierarchical,  # 层级协作：分析师主导，其他 Agent 配合
    verbose=True
)
```

> **Process.hierarchical vs. sequential**：层级协作（hierarchical）适合复杂、需要主控协调的任务；顺序协作（sequential）适合线性流程清晰的任务。

---

## 第三步：执行查询并获取结果

```python
# 启动查询
result = crew.kickoff(inputs={"user_query": "CrewAI 多智能体如何在生产环境中实现高可用？"})

# 获取最终输出
final_output = result.tasks_output[-1].raw
print(final_output)

# 查看中间过程（各 Agent 输出）
for task in result.tasks:
    print(f"\n=== Agent: {task.agent} 输出 ===")
    print(task.raw)
```

完整输出示例：

```
=== Agent: 知识库研究员 输出 ===
检索到 3 条相关文档，涉及 CrewAI 部署架构、容错机制和监控方案...

=== Agent: 问题分析师 输出 ===
问题拆解为：(1) 高可用架构设计 (2) 容错与降级策略 (3) 监控与告警...

=== Agent: 技术写作师 输出 ===
# CrewAI 多智能体高可用部署实战指南

（完整文章内容...）
```

---

## 第四步：生产部署关键配置

### 4.1 添加超时与重试机制

```python
from crewai import Crew, Process
from langchain_core.runnables import RunnableConfig

crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analyze_task, write_task],
    process=Process.hierarchical,
    max_iter=5,        # 单个 Agent 最大迭代次数（防止死循环）
    max_time=120,      # 整个 Crew 最大执行时间（秒）
    retry_count=2,     # 失败重试次数
    verbose=True
)
```

### 4.2 添加自定义回调实现监控

```python
from crewai.callbacks import CrewCallback

class LoggingCallback(CrewCallback):
    def on_agent_start(self, agent, task):
        print(f"[START] Agent: {agent.role} | Task: {task.description[:50]}...")

    def on_agent_end(self, agent, task, output):
        print(f"[END] Agent: {agent.role} | Output: {output[:100]}...")

    def on_task_end(self, task, output):
        print(f"[TASK END] {task.description[:50]}...")

crew = Crew(
    agents=[researcher, analyst, writer],
    tasks=[research_task, analyze_task, write_task],
    process=Process.hierarchical,
    callbacks=[LoggingCallback()]
)
```

### 4.3 接入 FastAPI 构建 API 服务

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Multi-Agent RAG API")

class QueryRequest(BaseModel):
    question: str
    top_k: int = 5

@app.post("/ask")
def ask(request: QueryRequest):
    result = crew.kickoff(inputs={"user_query": request.question})
    return {"answer": result.tasks_output[-1].raw}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 检索结果不相关 | Embedding 模型与知识库语言不匹配 | 换成对应语言的 Embedding 模型 |
| Agent 输出为空 | Context 依赖未正确传递 | 检查 tasks 的 context 参数顺序 |
| 向量库查询超时 | FAISS 数据量太大 | 换用 Milvus/Qdrant，支持分布式 |
| 回答质量差 | 检索块 chunk_size 过大/过小 | 调整 chunk_size 至 256~1024 |
| Agent 陷入死循环 | 任务目标定义模糊 | 增加 max_iter 限制，或细化 task description |

---

## 总结

本文从零实现了一套基于 CrewAI 的多智能体 RAG 问答系统：

- **知识库层**：使用 BGE 中文 Embedding + FAISS 构建本地向量库，支持 Markdown 文档直接加载
- **Agent 层**：研究员（检索）、分析师（意图拆解）、写作师（内容生成）三级分工，各司其职
- **编排层**：CrewAI 的 Process.hierarchical 实现主控协调，支持任务依赖传递
- **生产层**：超时重试、自定义回调、FastAPI 部署，实现生产级可用性

相比单 Agent RAG，多智能体架构的核心优势在于**任务分治与可调试性**：每个 Agent 的输出都是可见的中间结果，哪里出问题修哪里，而不是面对黑盒化的最终输出干瞪眼。

---

*参考资料：CrewAI 官方文档 v0.80.0、LangChain 官方文档、BAAI/bge-large-zh-v1.5 模型说明*