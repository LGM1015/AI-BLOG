---
title: "从零打造本地知识图谱RAG系统：LangChain + Neo4j构建智能问答"
category: "rag"
categoryName: "RAG知识库"
date: "2026-05-06"
tags: ["RAG", "知识图谱", "LangChain", "Neo4j", "向量数据库", "LLM"]
description: "详解如何用LangChain结合Neo4j构建知识图谱增强的RAG系统，支持自然语言查询企业知识库，附完整代码示例。"
---

## 前言

传统RAG（检索增强生成）系统的核心痛点是什么？**语义碎片化**。

当用户问"华为自动驾驶的激光雷达供应商是谁"时，传统向量检索可能返回一堆包含"华为"、"激光雷达"、"供应商"等关键词的片段，但无法捕捉它们之间的**关联关系**。检索到的文档可能在讲华为供应商体系，又在讲激光雷达技术指标，却无法直接给出"华为→采购→激光雷达→供应商"这条关系链。

**知识图谱RAG（Graph RAG）**正是来解决这个问题的。它将非结构化文本转化为结构化的知识图谱，让LLM能够像推理人际关系一样推理知识关联。

本教程将手把手教你用**LangChain + Neo4j**搭建一套本地可运行的知识图谱RAG系统。

---

## 一、系统架构概览

```
用户自然语言查询
        ↓
   LangChain Query引擎
        ↓
   知识图谱检索（Neo4j Cypher查询）
        ↓
   关系路径 → Context上下文
        ↓
   LLM生成最终答案
```

核心流程：
1. **图谱构建**：将文档解析，提取实体和关系，存入Neo4j
2. **向量化**：同步将实体描述存入向量数据库（ChromaDB）
3. **混合检索**：根据用户问题，同时查询图谱关系和向量相似度
4. **答案生成**：将检索结果注入Prompt，LLM生成回答

---

## 二、环境准备

### 2.1 依赖安装

```bash
pip install langchain langchain-community langchain-core
pip install neo4j graphdatascience
pip install chromadb unstructured pdfplumber
pip install openai  # 或使用其他LLM API
```

### 2.2 Neo4j本地部署

推荐用Docker快速启动Neo4j：

```bash
docker run \
  -d \
  --name neo4j \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest
```

> 💡 默认凭据：用户名`neo4j`，密码`password`。生产环境请修改。

启动后访问 `http://localhost:7474` 进入Neo4j Browser。

---

## 三、文档解析与知识图谱构建

### 3.1 实体关系抽取Prompt

我们用LLM从文本中抽取三元组（Subject-Predicate-Object）：

```python
# graph_builder.py
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_experimental.graph_transformers import LLMGraphTransformer
from neo4j import GraphDatabase
import chromadb

# LLM配置（使用本地模型或API）
llm = ChatOpenAI(
    base_url="http://localhost:11434/v1",  # Ollama本地
    model="qwen2.5",
    api_key="ollama"
)

# 实体关系抽取
ENTITY_EXTRACTION_PROMPT = """
你是一个知识图谱抽取专家。从给定文本中提取所有实体和关系。

要求：
- 实体类型：人物(PERSON)、组织(ORGANIZATION)、产品(PRODUCT)、技术(TECHNOLOGY)、地点(LOCATION)
- 关系类型：研发(PRODUCE)、采购(PURCHASE)、合作(PARTNER_WITH)、竞争(RIVAL_WITH)、供应(SUPPLY)
- 输出格式：JSON数组，每项包含from, to, rel三个字段

文本：
{text}

输出：
"""

def extract_triplets(text: str) -> list[dict]:
    """从文本中抽取三元组"""
    prompt = ChatPromptTemplate.from_template(ENTITY_EXTRACTION_PROMPT)
    chain = prompt | llm
    response = chain.invoke({"text": text})
    
    import json
    # 解析LLM输出为三元组
    content = response.content
    # 找到JSON起始位置
    start = content.find('[')
    end = content.rfind(']') + 1
    if start != -1 and end > start:
        return json.loads(content[start:end])
    return []
```

### 3.2 存入Neo4j图谱

```python
class Neo4jGraphBuilder:
    def __init__(self, uri="bolt://localhost:7687", user="neo4j", password="password"):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
    
    def create_entities_and_relations(self, triplets: list[dict]):
        """将三元组写入Neo4j"""
        with self.driver.session() as session:
            for triplet in triplets:
                # 写入节点（实体）
                for entity_type in ["from", "to"]:
                    session.run(f"""
                        MERGE (e:{entity_type.upper()}{{name: $name}})
                    """, name=triplet[entity_type])
                
                # 写入关系
                session.run("""
                    MATCH (a {name: $from}), (b {name: $to})
                    MERGE (a)-[r:`{rel}`]->(b)
                """.format(rel=triplet["rel"]), 
                from_=triplet["from"], to=triplet["to"])
    
    def close(self):
        self.driver.close()
```

### 3.3 同步存入ChromaDB向量库

```python
class ChromaVectorStore:
    def __init__(self, collection_name="kg_rag"):
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection(name=collection_name)
    
    def add_entity_description(self, entity_name: str, description: str, entity_id: str):
        """将实体描述向量化"""
        # 用嵌入模型获取向量
        from langchain_community.embeddings import OllamaEmbeddings
        embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")
        
        vector = embeddings.embed_query(description)
        self.collection.add(
            ids=[entity_id],
            embeddings=[vector],
            documents=[f"{entity_name}: {description}"]
        )
    
    def similarity_search(self, query: str, top_k: int = 5) -> list[str]:
        """向量相似度检索"""
        from langchain_community.embeddings import OllamaEmbeddings
        embeddings = OllamaEmbeddings(model="nomic-embed-text", base_url="http://localhost:11434")
        
        query_vector = embeddings.embed_query(query)
        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=top_k
        )
        return results["documents"][0] if results["documents"] else []
```

---

## 四、混合检索与问答

### 4.1 Cypher查询生成器

核心难点：把自然语言问题转换为Cypher图数据库查询语言。

```python
class CypherQueryGenerator:
    def __init__(self, llm):
        self.llm = llm
    
    CYHPER_TEMPLATE = """
你是一个Neo4j图数据库专家。根据用户问题，生成Cypher查询语句。

图谱schema：
- 节点类型：PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY, LOCATION
- 关系类型：PRODUCE, PURCHASE, PARTNER_WITH, RIVAL_WITH, SUPPLY

要求：
- 查询从用户意图中提取的关键实体之间的关系
- 返回完整的Cypher语句
- 只需要MATCH语句，不要执行写入操作

用户问题：{question}

Cypher查询：
"""
    
    def generate(self, question: str) -> str:
        prompt = ChatPromptTemplate.from_template(self.CYHPER_TEMPLATE)
        chain = prompt | self.llm
        response = chain.invoke({"question": question})
        return response.content.strip()
```

### 4.2 图谱问答Chain

```python
class GraphRAGChain:
    def __init__(self, neo4j_driver, cypher_gen, vector_store, llm):
        self.neo4j = neo4j_driver
        self.cypher_gen = cypher_gen
        self.vector_store = vector_store
        self.llm = llm
    
    def query(self, question: str) -> str:
        # Step 1: 生成Cypher查询
        cypher = self.cypher_gen.generate(question)
        
        # Step 2: 执行图谱查询
        graph_context = self._execute_cypher(cypher)
        
        # Step 3: 向量补充检索
        vector_results = self.vector_store.similarity_search(question)
        
        # Step 4: 构造Prompt生成答案
        final_prompt = f"""
你是一个知识库问答助手。请根据以下信息回答用户问题。

【图谱查询结果】
{graph_context}

【相关文档片段】
{chr(10).join(vector_results)}

【用户问题】
{question}

请给出准确、完整的回答。如果信息不足以回答，请明确说明。
"""
        response = self.llm.invoke(final_prompt)
        return response.content
    
    def _execute_cypher(self, cypher: str) -> str:
        """安全执行Cypher查询"""
        with self.neo4j.driver.session() as session:
            result = session.run(cypher)
            records = [dict(record) for record in result]
            return str(records) if records else "未找到相关关系"
```

---

## 五、完整使用示例

```python
# main.py
from graph_builder import Neo4jGraphBuilder, ChromaVectorStore
from query_chain import CypherQueryGenerator, GraphRAGChain
from langchain_openai import ChatOpenAI

def main():
    # 初始化组件
    llm = ChatOpenAI(base_url="http://localhost:11434/v1", model="qwen2.5", api_key="ollama")
    neo4j_builder = Neo4jGraphBuilder()
    vector_store = ChromaVectorStore()
    cypher_gen = CypherQueryGenerator(llm)
    
    # 构建RAG Chain
    rag_chain = GraphRAGChain(
        neo4j_driver=neo4j_builder,
        cypher_gen=cypher_gen,
        vector_store=vector_store,
        llm=llm
    )
    
    # 示例：从文档构建图谱
    sample_text = """
    华为公司自主研发了MDC智能驾驶计算平台，该平台采用自研的昇腾AI芯片。
    华为还与宁德时代在智能汽车领域建立了战略合作伙伴关系。
    宁德时代是全球领先的动力电池供应商，为多家车企供应电池。
    """
    
    from graph_builder import extract_triplets
    triplets = extract_triplets(sample_text)
    print(f"抽取三元组: {triplets}")
    
    for triplet in triplets:
        neo4j_builder.create_entities_and_relations([triplet])
        # 存入向量库
        vector_store.add_entity_description(
            entity_name=triplet["from"],
            description=f"{triplet['from']} {triplet['rel']} {triplet['to']}",
            entity_id=f"{triplet['from']}_{triplet['to']}"
        )
    
    # 问答测试
    question = "华为在智能驾驶领域和哪些公司有合作？"
    answer = rag_chain.query(question)
    print(f"问题: {question}")
    print(f"答案: {answer}")

if __name__ == "__main__":
    main()
```

---

## 六、进阶优化方向

### 6.1 动态图谱更新

当前示例是批量构建，生产环境推荐接入**LangChain的Document Loader + Vector Store + Graph**组合流水线，支持增量更新文档和图谱。

### 6.2 多跳推理

当前Chain是单轮查询。复杂问题（如"A和B公司的间接竞争关系"）需要**多轮Cypher查询 + 路径探索**，可使用ReAct（Reasoning + Acting）模式迭代扩展查询图。

### 6.3 图神经网络（GNN）增强

在Neo4j中可以使用**Graph Data Science（GDS）**库计算节点重要性、社区发现等，用于对检索结果做二次排序。

---

## 总结

本教程实现了一个可用的本地知识图谱RAG系统，核心价值在于：

| 能力 | 传统RAG | 知识图谱RAG |
|------|---------|------------|
| 关系推理 | ❌ | ✅ 支持多跳关系查询 |
| 结构化知识 | ❌ | ✅ 实体-关系清晰可查 |
| 溯源能力 | 弱 | 强（图路径可解释） |
| 部署复杂度 | 低 | 中（Neo4j依赖） |

知识图谱RAG是当前RAG领域的重要进化方向，尤其适合**企业知识库、产业链分析、合规审查**等需要深层关系推理的场景。建议从本教程示例出发，根据实际数据特点逐步迭代。

---

*完整代码仓库：https://github.com/LGM1015/AI-BLOG*
