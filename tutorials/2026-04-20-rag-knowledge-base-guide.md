---
title: "RAG实战指南：用检索增强生成构建企业知识库问答系统"
category: "rag"
categoryName: "RAG技术"
date: "2026-04-20"
tags: ["RAG", "检索增强生成", "向量数据库", "LangChain", "实战"]
description: "手把手教你构建一个基于RAG的知识库问答系统，涵盖文档解析、向量嵌入、相似度检索、生成回答的完整链路，附完整代码示例。"
---

# RAG实战指南：用检索增强生成构建企业知识库问答系统

大语言模型知识有截止日期，也不了解你的内部文档——这是企业落地 AI 的两大痛点。**RAG（Retrieval-Augmented Generation，检索增强生成）** 正是为解决这个问题而生的技术方案。

本教程将带你从零构建一个可用的 RAG 问答系统，技术栈：Python + LangChain + OpenAI Embeddings + ChromaDB。

## 什么是 RAG？

RAG 的核心思路很直接：

1. 把你的私有文档切成小块，转化为向量存入数据库
2. 用户提问时，先从向量库里检索最相关的文档片段
3. 把检索到的内容连同问题一起塞给 LLM，让它基于这些内容回答

这样，LLM 就不需要"记住"所有知识，只需要在给定的上下文里做阅读理解。

```
用户提问
   ↓
向量检索（找最相关的文档片段）
   ↓
组装 Prompt（问题 + 相关片段）
   ↓
LLM 生成回答
   ↓
返回给用户
```

## 环境准备

```bash
pip install langchain langchain-openai chromadb pypdf tiktoken
```

设置 API Key：

```bash
export OPENAI_API_KEY="your-api-key-here"
```

## Step 1：加载和切分文档

RAG 的第一步是处理原始文档。支持 PDF、TXT、Word 等多种格式。

```python
from langchain.document_loaders import PyPDFLoader, TextLoader, DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 加载单个 PDF
loader = PyPDFLoader("company_handbook.pdf")
documents = loader.load()

# 加载整个目录（混合文件类型）
# loader = DirectoryLoader("./docs/", glob="**/*.txt", loader_cls=TextLoader)
# documents = loader.load()

# 切分文档
# chunk_size: 每个片段的字符数
# chunk_overlap: 相邻片段的重叠字符数（保证上下文连贯）
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", " ", ""]
)

chunks = text_splitter.split_documents(documents)
print(f"文档切分完成，共 {len(chunks)} 个片段")
```

**关键参数说明：**

- `chunk_size=500`：适合中文文档，英文可以适当增大到 1000
- `chunk_overlap=50`：重叠确保关键信息不被截断在片段边界
- `separators`：优先按段落、句子切分，保证语义完整性

## Step 2：生成向量嵌入并存储

```python
from langchain_openai import OpenAIEmbeddings
from langchain.vectorstores import Chroma

# 初始化嵌入模型
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# 创建向量数据库（持久化到本地）
vectordb = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="./chroma_db"  # 本地存储路径
)

vectordb.persist()
print("向量数据库创建完成！")
```

**嵌入模型选择：**

| 模型 | 维度 | 适用场景 | 成本 |
|------|------|----------|------|
| text-embedding-3-small | 1536 | 一般用途，性价比高 | 低 |
| text-embedding-3-large | 3072 | 高精度需求 | 中 |
| 本地模型（如 bge-m3） | 1024 | 数据安全要求高 | 免费 |

## Step 3：加载已有数据库并检索

```python
from langchain_openai import OpenAIEmbeddings
from langchain.vectorstores import Chroma

# 加载已有的向量数据库
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vectordb = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings
)

# 相似度检索
query = "公司的年假政策是怎样的？"
docs = vectordb.similarity_search(query, k=3)  # 返回最相关的3个片段

for i, doc in enumerate(docs):
    print(f"--- 片段 {i+1} ---")
    print(doc.page_content[:200])
    print()
```

## Step 4：构建完整的 RAG 问答链

```python
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

# 自定义 Prompt 模板（关键！控制回答风格）
prompt_template = """你是一个专业的企业知识库助手。
请根据以下提供的参考内容回答用户的问题。
如果参考内容中没有相关信息，请明确告知用户"根据现有资料，无法找到相关信息"，不要编造答案。

参考内容：
{context}

用户问题：{question}

回答："""

PROMPT = PromptTemplate(
    template=prompt_template,
    input_variables=["context", "question"]
)

# 初始化 LLM
llm = ChatOpenAI(model="gpt-4o", temperature=0)

# 构建 RAG 链
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",  # 将所有检索结果塞入同一个 prompt
    retriever=vectordb.as_retriever(search_kwargs={"k": 3}),
    chain_type_kwargs={"prompt": PROMPT},
    return_source_documents=True  # 同时返回来源文档，方便溯源
)

# 提问
result = qa_chain.invoke({"query": "公司的年假政策是怎样的？"})
print("回答：", result["result"])
print("\n来源文档：")
for doc in result["source_documents"]:
    print(f"  - {doc.metadata.get('source', '未知来源')} 第{doc.metadata.get('page', '?')}页")
```

## Step 5：构建简单的交互界面

```python
def ask(question: str) -> dict:
    """封装问答函数"""
    result = qa_chain.invoke({"query": question})
    return {
        "answer": result["result"],
        "sources": [
            {
                "source": doc.metadata.get("source", "未知"),
                "page": doc.metadata.get("page", "?"),
                "content": doc.page_content[:100] + "..."
            }
            for doc in result["source_documents"]
        ]
    }

# 命令行交互
print("知识库问答系统已启动（输入 'quit' 退出）")
while True:
    question = input("\n请输入问题：").strip()
    if question.lower() == "quit":
        break
    if not question:
        continue
    
    result = ask(question)
    print(f"\n💡 回答：{result['answer']}")
    print("\n📚 参考来源：")
    for src in result["sources"]:
        print(f"  [{src['source']} 第{src['page']}页] {src['content']}")
```

## 进阶优化技巧

### 1. 混合检索（Hybrid Search）

纯向量检索对关键词匹配效果一般，结合 BM25 关键词检索效果更好：

```python
from langchain.retrievers import BM25Retriever, EnsembleRetriever

# BM25 关键词检索
bm25_retriever = BM25Retriever.from_documents(chunks)
bm25_retriever.k = 3

# 向量检索
vector_retriever = vectordb.as_retriever(search_kwargs={"k": 3})

# 混合检索（0.5 权重各半）
ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.5, 0.5]
)
```

### 2. 添加重排序（Reranking）

检索到候选片段后，用更强的模型对相关性重新排序：

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import CrossEncoderReranker
from langchain_community.cross_encoders import HuggingFaceCrossEncoder

# 加载 Cross-Encoder 重排模型（本地运行，免费）
model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-base")
compressor = CrossEncoderReranker(model=model, top_n=3)

compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=vector_retriever
)
```

### 3. 元数据过滤

当文档库很大时，先用元数据缩小检索范围：

```python
# 只在 "HR手册" 文档中检索
docs = vectordb.similarity_search(
    query,
    k=3,
    filter={"source": "hr_handbook.pdf"}
)
```

## 常见问题排查

**Q：回答内容不准确，胡编乱造**
→ 检查 Prompt 模板，明确要求模型"仅基于提供内容回答"；将 `temperature` 设为 0

**Q：检索不到相关内容**
→ 尝试增大 `k` 值；检查 `chunk_size` 是否太小导致上下文碎片化；考虑换用更好的嵌入模型

**Q：回答速度太慢**
→ 减少 `k` 值；使用更快的模型（如 gpt-4o-mini）；考虑流式输出（streaming）

**Q：文档更新后如何同步**
→ 增量更新：用 `vectordb.add_documents()` 添加新文档；为文档添加唯一 ID，通过 ID 删除旧版本再添加新版本

## 小结

RAG 是目前企业 AI 落地最成熟的技术路线之一，核心流程：

1. **文档处理**：加载 → 切分
2. **向量化存储**：嵌入 → 存入向量库
3. **检索**：问题向量化 → 相似度匹配
4. **生成**：检索结果 + 问题 → LLM 生成答案

掌握了基础链路后，可以进一步探索混合检索、Reranking、多路召回等进阶技术，持续提升回答质量。代码示例均可直接运行，建议从小文档开始实验，熟悉各参数的影响再逐步扩展到真实场景。

---

*作者：AI技术实践 | 发布于 2026-04-20*
