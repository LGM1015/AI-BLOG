---
title: "构建记忆增强型AI Agent：从零实现上下文管理"
category: "ai-agent"
categoryName: "AI Agent开发"
date: "2026-06-11"
tags: ["AI Agent", "LangGraph", "记忆系统", "实战教程"]
description: "本文手把手教你在LangGraph中实现多层次记忆系统，包括短中长期记忆的架构设计、向量检索集成、以及记忆压缩策略，让你的Agent真正拥有\"经验\"。"
---

## 前言

一个没有记忆的AI Agent，就像一个每次见面都问"你叫什么名字"的朋友——它能聊天，但不能陪伴。

在真实场景中，一个可用的AI Agent需要能够：
- 记住用户的历史偏好和偏好
- 跨会话积累领域知识
- 在长时间对话中保持上下文一致性
- 在记忆成本和效果之间找到平衡

本文将使用 **LangGraph** 从零构建一套多层次记忆系统，涵盖：短期记忆（对话窗口管理）、中期记忆（会话摘要）、长期记忆（向量数据库持久化）。

---

## 一、整体架构

我们的记忆系统分为三层：

```
┌─────────────────────────────────┐
│         长期记忆 (Long-term)      │  ← ChromaDB / FAISS 向量库
│     (跨会话，持久化，向量检索)       │
├─────────────────────────────────┤
│         中期记忆 (Mid-term)        │  ← 当前会话摘要（当Token超限时）
│     (会话级，定期压缩)              │
├─────────────────────────────────┤
│         短期记忆 (Short-term)       │  ← 最近N轮对话
│     (窗口级，快速读写)              │
└─────────────────────────────────┘
```

### 技术栈

- **框架**：LangGraph（状态流编排）
- **向量库**：ChromaDB（轻量、本地可用）
- **Embedding**：OpenAI `text-embedding-3-small` 或本地 `sentence-transformers`
- **LLM**：DeepSeek Chat / GPT-4o

---

## 二、基础配置

```python
# config.py
import os

# LLM 配置（支持 DeepSeek 或 OpenAI）
LLM_PROVIDER = "deepseek"  # "deepseek" | "openai"

LLM_CONFIG = {
    "deepseek": {
        "model": "deepseek-chat",
        "api_key": os.getenv("DEEPSEEK_API_KEY"),
        "base_url": "https://api.deepseek.com"
    },
    "openai": {
        "model": "gpt-4o",
        "api_key": os.getenv("OPENAI_API_KEY"),
        "base_url": "https://api.openai.com/v1"
    }
}

# 向量库配置
VECTOR_DB_PATH = "./memory_store"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # 本地轻量模型

# 记忆参数
MAX_SHORT_TERM_MESSAGES = 10      # 短期记忆：最近10轮对话
SUMMARY_TRIGGER_THRESHOLD = 8000   # Token超此值时触发摘要压缩
MAX_LONG_TERM_RESULTS = 5          # 长期记忆：每次检索返回5条
```

---

## 三、核心数据结构

```python
# memory_state.py
from dataclasses import dataclass, field
from typing import Annotated, Sequence
from langgraph.graph import add_messages
from langchain_core.messages import BaseMessage

@dataclass
class MemoryEntry:
    """单条记忆条目"""
    content: str              # 记忆内容
    embedding: list[float]     # 向量嵌入
    timestamp: float          # 创建时间戳
    importance: float = 0.5   # 重要性评分 (0~1)
    tags: list[str] = field(default_factory=list)  # 标签分类

@dataclass
class MemoryState:
    """Agent记忆状态"""
    # 消息历史（短期记忆）
    messages: Annotated[Sequence[BaseMessage], add_messages] = field(default_factory=list)
    
    # 当前会话摘要（中期记忆）
    session_summary: str = ""
    
    # 长期记忆检索结果（本次推理可见）
    retrieved_memories: list[str] = field(default_factory=list)
    
    # 元数据
    turn_count: int = 0           # 当前会话轮次
    total_token_usage: int = 0    # 累计Token消耗（用于触发摘要）
```

---

## 四、短期记忆：滑动窗口管理

短期记忆是最直观的一层——维护最近N轮对话。

```python
# short_term_memory.py
from langchain_core.messages import HumanMessage, AIMessage
from typing import Annotated

def trim_to_window(messages: list, max_messages: int = 10) -> list:
    """将消息列表裁剪到指定窗口大小（保留首条系统消息）"""
    if len(messages) <= max_messages:
        return messages
    
    # 始终保留第一条系统消息
    system_messages = [m for m in messages if m.type == "system"]
    non_system = [m for m in messages if m.type != "system"]
    
    # 从最近端截取
    trimmed = system_messages + non_system[-max_messages:]
    return trimmed


def add_to_short_term(state: MemoryState, new_message) -> dict:
    """添加新消息到短期记忆（带自动裁剪）"""
    updated_messages = state.messages + [new_message]
    
    # 自动裁剪超出窗口的消息
    trimmed = trim_to_window(updated_messages, MAX_SHORT_TERM_MESSAGES)
    
    return {
        "messages": trimmed,
        "turn_count": state.turn_count + 1
    }
```

---

## 五、中期记忆：会话摘要压缩

当Token消耗超过阈值时，我们将当前对话压缩成一段摘要，释放上下文窗口的空间。

```python
# mid_term_memory.py
from langchain_core.messages import SystemMessage

SUMMARIZER_PROMPT = """你是一个记忆压缩助手。请将以下对话历史压缩成一段摘要，
保留所有重要的用户偏好、已完成的任务、关键结论和未解决的问题。

压缩后的摘要应该能让后续的AI Agent无需阅读原始对话就能理解：
1. 用户是谁，有什么偏好
2. 正在处理什么任务，进度如何
3. 有哪些关键结论和决策
4. 还有什么待办事项

对话历史：
{messages}

请输出一段简洁的摘要："""

async def summarize_if_needed(state: MemoryState, llm) -> str:
    """检查是否需要摘要，并执行压缩"""
    estimated_tokens = estimate_tokens(state.messages)
    
    if estimated_tokens < SUMMARY_TRIGGER_THRESHOLD:
        return state.session_summary  # 不需要摘要
    
    # 执行摘要
    conversation_text = "\n".join([
        f"[{m.type}] {m.content}" for m in state.messages
    ])
    
    prompt = SUMMARIZER_PROMPT.format(messages=conversation_text)
    summary = await llm.ainvoke([SystemMessage(content=prompt)])
    
    return summary.content


def estimate_tokens(messages: list) -> int:
    """粗略估算消息列表的Token数量（中文≈2 tokens/字符，英文≈4 chars/token）"""
    total = 0
    for m in messages:
        content = m.content
        # 简单估算
        chinese_chars = sum(1 for c in content if '\u4e00' <= c <= '\u9fff')
        other_chars = len(content) - chinese_chars
        total += chinese_chars * 2 + other_chars * 0.25
    return int(total)
```

---

## 六、长期记忆：向量检索持久化

长期记忆使用向量数据库存储跨会话的持久化知识，通过语义相似度检索。

```python
# long_term_memory.py
import chromadb
from chromadb.config import Settings
import hashlib

class LongTermMemory:
    """长期记忆管理器——基于ChromaDB向量检索"""
    
    def __init__(self, persist_path: str = VECTOR_DB_PATH):
        self.client = chromadb.PersistentClient(path=persist_path)
        self.collection = self.client.get_or_create_collection(
            name="agent_memories",
            metadata={"hnsw:space": "cosine"}  # 余弦相似度
        )
    
    def add_memory(self, content: str, importance: float = 0.5, 
                   tags: list[str] = None, embedding: list = None) -> str:
        """添加一条记忆到长期存储"""
        if embedding is None:
            embedding = self._embed(content)
        
        memory_id = hashlib.md5(content[:100].encode()).hexdigest()
        
        self.collection.add(
            embeddings=[embedding],
            documents=[content],
            ids=[memory_id],
            metadatas=[{
                "importance": importance,
                "tags": ",".join(tags or []),
                "added_at": str(time.time())
            }]
        )
        return memory_id
    
    def retrieve(self, query: str, top_k: int = MAX_LONG_TERM_RESULTS) -> list[dict]:
        """基于语义相似度检索记忆"""
        query_embedding = self._embed(query)
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )
        
        memories = []
        for i, doc_id in enumerate(results["ids"][0]):
            memories.append({
                "id": doc_id,
                "content": results["documents"][0][i],
                "similarity": 1 - results["distances"][0][i],  # 转换为相似度
                "metadata": results["metadatas"][0][i]
            })
        
        return memories
    
    def _embed(self, text: str) -> list[float]:
        """使用embedding模型生成向量"""
        from langchain_community.embeddings import HuggingFaceEmbeddings
        
        embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        return embeddings.embed_query(text)
    
    def forget_old(self, days: int = 90, importance_threshold: float = 0.3):
        """遗忘策略：删除超过N天的低重要性记忆"""
        # 实际实现需要结合时间戳和重要性做过滤
        pass
```

---

## 七、LangGraph Agent集成

现在将三层记忆整合进LangGraph工作流：

```python
# agent_with_memory.py
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from memory_state import MemoryState
from short_term_memory import add_to_short_term, trim_to_window
from mid_term_memory import summarize_if_needed
from long_term_memory import LongTermMemory

# 初始化
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
    temperature=0.7
)
memory_store = LongTermMemory()

# ── Node 1: 检索长期记忆 ──
def retrieve_long_term(state: MemoryState) -> dict:
    """根据当前用户输入，从向量库检索相关记忆"""
    if not state.messages:
        return {"retrieved_memories": []}
    
    last_msg = state.messages[-1].content
    memories = memory_store.retrieve(last_msg, top_k=5)
    
    # 格式化记忆文本
    memory_text = "\n".join([
        f"[记忆·{m['similarity']:.2f}] {m['content']}" 
        for m in memories
    ])
    
    return {"retrieved_memories": [memory_text]}

# ── Node 2: 压缩中期记忆（条件触发）──
def compress_session(state: MemoryState) -> dict:
    """当Token超限时，压缩会话为摘要"""
    import asyncio
    summary = asyncio.run(summarize_if_needed(state, llm))
    return {
        "session_summary": summary,
        "messages": trim_to_window(state.messages, 3)  # 保留最近3条 + 摘要
    }

# ── Node 3: LLM推理 ──
def llm_reasoning(state: MemoryState) -> dict:
    """基于所有记忆上下文进行推理"""
    # 构建系统提示
    system_prompt = f"""你是一个有记忆的AI助手。

当前会话摘要（中期记忆）：
{state.session_summary or '（空）'}

相关记忆（从长期记忆检索）：
{chr(10).join(state.retrieved_memories) if state.retrieved_memories else '（无相关记忆）'}

请基于以上记忆上下文，回答用户的问题。如果检索到的记忆中有相关信息，请加以利用。"""

    # 裁剪消息（短期记忆窗口）
    trimmed_msgs = trim_to_window(state.messages, MAX_SHORT_TERM_MESSAGES)
    
    # 构建消息链
    full_messages = [SystemMessage(content=system_prompt)] + list(trimmed_msgs)
    
    response = llm.invoke(full_messages)
    
    return {"messages": [response]}

# ── Node 4: 保存新记忆 ──
def save_memory(state: MemoryState) -> dict:
    """将对话中的重要信息存入长期记忆"""
    if not state.messages or len(state.messages) < 2:
        return {}
    
    # 从AI回复中提取值得记忆的内容
    # 简化策略：每5轮对话保存一次总结
    if state.turn_count % 5 == 0 and state.messages:
        summary_text = f"会话要点（第{state.turn_count}轮）: "
        # 这里可以调用LLM来抽取关键信息
        # 为简化，直接存储摘要
        memory_store.add_memory(
            content=f"用户偏好：...（由LLM摘要提取）",
            importance=0.6,
            tags=["session_summary"]
        )
    
    return {}

# ── 条件边：是否需要压缩 ──
def should_compress(state: MemoryState) -> str:
    from mid_term_memory import estimate_tokens
    if estimate_tokens(state.messages) > SUMMARY_TRIGGER_THRESHOLD:
        return "compress"
    return "direct"

# ── 构建图 ──
graph = StateGraph(MemoryState)

graph.add_node("retrieve", retrieve_long_term)
graph.add_node("compress", compress_session)
graph.add_node("reason", llm_reasoning)
graph.add_node("save", save_memory)

graph.set_entry_point("retrieve")
graph.add_edge("retrieve", "compress")
graph.add_conditional_edges(
    "compress",
    should_compress,
    {
        "compress": "compress",  # 压缩后再推理
        "direct": "reason"
    }
)
graph.add_edge("reason", "save")
graph.add_edge("save", END)

agent = graph.compile()
```

---

## 八、使用示例

```python
# run_agent.py
import asyncio

async def main():
    from agent_with_memory import agent, add_to_short_term
    from langchain_core.messages import HumanMessage
    
    # 初始化状态
    state = MemoryState(
        messages=[],
        turn_count=0,
        total_token_usage=0
    )
    
    # 第一轮对话
    user_input = "我叫张三，正在开发一个电商推荐系统"
    state.messages.append(HumanMessage(content=user_input))
    
    # 运行Agent
    result = await agent.ainvoke(state)
    print(result["messages"][-1].content)
    
    # 第五轮后，长期记忆中就会保存关于张三的偏好信息

asyncio.run(main())
```

---

## 九、记忆压缩策略进阶

### 9.1 重要性评分机制

并非所有对话都值得记住。我们可以引入一个简单的评分函数：

```python
def rate_importance(message_content: str, context: list) -> float:
    """评估一条消息是否值得存入长期记忆"""
    importance_signals = [
        "记住", "偏好", "以后", "不要", "喜欢", "讨厌",
        "每次", "总是", "从来不", "特别", "非常"
    ]
    
    score = 0.5  # 基础分
    for signal in importance_signals:
        if signal in message_content:
            score += 0.1
    
    return min(score, 1.0)  # 上限1.0
```

### 9.2 记忆衰减（Forgetting）

```python
def decay_memories(collection, days: int = 30, decay_rate: float = 0.05):
    """定期降低旧记忆的重要性评分"""
    old_memories = collection.get(
        where={"added_at": {"$lt": str(time.time() - days * 86400)}}
    )
    
    for memory_id, metadata in zip(old_memories["ids"], old_memories["metadatas"]):
        new_importance = max(0.1, metadata["importance"] - decay_rate)
        collection.update(
            ids=[memory_id],
            metadatas=[{**metadata, "importance": new_importance}]
        )
```

### 9.3 记忆分层查询

```python
def query_memory_layers(query: str, memory_store: LongTermMemory) -> str:
    """分层次查询记忆，优先级：近期高频 > 历史关键"""
    recent = memory_store.collection.query(
        query_embeddings=[memory_store._embed(query)],
        where={"added_at": {"$gte": str(time.time() - 7 * 86400)}},  # 近7天
        n_results=3
    )
    
    general = memory_store.collection.query(
        query_embeddings=[memory_store._embed(query)],
        n_results=3
    )
    
    # 合并去重，按重要性加权
    return merge_and_rank(recent, general)
```

---

## 十、总结与下一步

本文构建了一套完整的三层记忆系统：

| 层级 | 容量 | 速度 | 持久性 | 适用场景 |
|------|------|------|--------|---------|
| 短期记忆 | 10条消息 | 微秒级 | 随会话结束 | 当前任务上下文 |
| 中期记忆 | 1段摘要 | 100ms级 | 会话级 | 跨轮次一致性 |
| 长期记忆 | 无限制 | 10ms级 | 永久 | 跨会话知识积累 |

**可以进一步探索的方向：**

1. **记忆可视化**：让用户能查看、编辑、删除Agent的记忆
2. **多模态记忆**：存储图片、文件等非文本记忆
3. **共享记忆**：多个Agent共享同一个记忆库（Multi-Agent Memory）
4. **记忆索引优化**：使用BM25+向量混合检索提升召回精度

完整代码示例可以在 GitHub 仓库的 `examples/memory-agent/` 目录找到。

---

*有问题或想法？欢迎提交Issue或PR一起完善这个记忆系统。*