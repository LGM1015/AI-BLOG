---
title: "用 LangGraph 构建多角色多智能体协作系统：从架构设计到生产部署"
category: "multi-agent"
categoryName: "多智能体开发"
date: "2026-05-28"
tags: ["LangGraph", "多智能体", "AI Agent", "Python", "生产级"]
description: "本文详解如何用 LangGraph 构建多角色多智能体协作系统，涵盖状态机设计、角色分工、循环控制与生产级异常处理，配合完整代码示例，帮助开发者快速搭建企业级多智能体工作流。"
---

# 用 LangGraph 构建多角色多智能体协作系统：从架构设计到生产部署

在单智能体时代，一个模型+一条链就能完成大多数任务。但当任务复杂度持续上升——涉及多个专业角色、需要相互校验、存在循环修正时——单链架构的局限性就会暴露无遗：无法循环、状态不透明、无法并发协作。

LangGraph 为解决这一问题而生。它将 AI 工作流建模为**有向状态图**，支持节点（Agent/Tools）之间的条件跳转、循环迭代和多分支并发。本文将从零开始，用一个「研究→审核→修订→交付」的完整多角色工作流演示 LangGraph 的核心用法，帮你搭建第一套生产级多智能体系统。

## 一、为什么需要 LangGraph 多智能体架构？

先明确一个核心区别：

| 特性 | 单链（LangChain Chain） | 多智能体（LangGraph） |
|------|----------------------|----------------------|
| 流程控制 | 线性，下一步唯一 | 有向图，条件分支 |
| 循环支持 | ❌ 不支持 | ✅ 支持 |
| 状态共享 | 上下文窗口 | 显式 State 对象 |
| 多角色协作 | 困难 | 原生支持 |
| 节点并发 | ❌ | ✅ |

以一个企业内容生产工作流为例：研究员负责搜集信息，审核员负责质量把关，修订员负责修正问题。如果审核员发现内容不合规，工作流需要**返回修订员重新修正**，这是一个典型的循环结构——单链根本无法表达。

## 二、核心概念速览

LangGraph 有四个核心概念：

- **State**：在整个图中流动的共享数据结构，用 `TypedDict` 定义
- **Node**：一个函数，代表图中的一个处理节点（Agent 或 Tool）
- **Edge**：连接两个节点的边，决定节点之间的流转关系
- **ConditionalEdge**：条件边，根据 State 内容决定下一步跳转到哪个节点

理解这四个概念之后，就可以开始构建我们的多智能体系统了。

## 三、完整实战：研究-审核-修订-交付工作流

### 3.1 环境准备

```bash
pip install langgraph langchain-openai langchain-core
```

### 3.2 定义状态结构

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
import operator

class MultiAgentState(TypedDict):
    """多智能体共享状态"""
    user_query: str                          # 用户输入
    research_result: str                     # 研究员输出
    review_result: str                       # 审核员输出
    revision_count: int                      # 修订次数
    final_result: str                        # 最终交付内容
    approval_status: str                     # 审核状态: approved / rejected / needs_revision
    iteration_limit: int                    # 防止无限循环
```

### 3.3 创建各个角色的 Agent 节点

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o", temperature=0.3)

def researcher_node(state: MultiAgentState) -> MultiAgentState:
    """研究员节点：负责搜集和处理信息"""
    query = state["user_query"]
    system_prompt = """你是一位专业的研究分析师。
根据用户提供的查询，输出一份结构化的研究报告。
报告需要包含：背景分析、核心观点、关键数据和结论。
语言简洁专业，使用中文输出。"""
    
    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": query}
    ])
    
    return {"research_result": response.content}


def reviewer_node(state: MultiAgentState) -> MultiAgentState:
    """审核员节点：负责质量审核和合规检查"""
    research = state["research_result"]
    system_prompt = """你是一位严格的内容审核专家。
审核研究员产出的报告，检查以下方面：
1. 事实准确性：数据是否可信，有无明显错误
2. 逻辑完整性：论证是否充分，结论是否有依据
3. 合规性：内容是否符合专业标准，有无敏感表述
4. 可读性：表述是否清晰，结构是否合理

输出格式：
- 审核结论：[approved / needs_revision / rejected]
- 问题列表：如果需要修订，列出具体问题
- 评分（1-10）：综合质量评分"""
    
    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"待审核报告内容：\n{research}"}
    ])
    
    content = response.content
    # 解析审核结论
    if "approved" in content.lower() and "needs_revision" not in content.lower():
        approval = "approved"
    elif "rejected" in content.lower():
        approval = "rejected"
    else:
        approval = "needs_revision"
    
    return {
        "review_result": content,
        "approval_status": approval,
        "revision_count": state.get("revision_count", 0)
    }


def reviser_node(state: MultiAgentState) -> MultiAgentState:
    """修订员节点：根据审核意见修订报告"""
    research = state["research_result"]
    review = state["review_result"]
    revision_count = state.get("revision_count", 0) + 1
    
    system_prompt = """你是一位专业的文字编辑和内容优化专家。
根据审核员的反馈意见，对原报告进行针对性修订。
要求：
1. 逐条解决审核提出的所有问题
2. 保持原报告的核心观点和数据不变
3. 只修改有问题部分，不做过度发挥
4. 修订后说明每项修改的原因
输出语言为中文。"""
    
    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"原报告：\n{research}\n\n审核意见：\n{review}"}
    ])
    
    return {
        "research_result": response.content,
        "revision_count": revision_count
    }


def deliver_node(state: MultiAgentState) -> MultiAgentState:
    """交付节点：最终整理和输出"""
    return {
        "final_result": state["research_result"]
    }
```

### 3.4 构建条件路由函数

```python
def should_continue(state: MultiAgentState) -> str:
    """根据审核状态决定下一步路由"""
    approval = state["approval_status"]
    revision_count = state.get("revision_count", 0)
    iteration_limit = state.get("iteration_limit", 3)
    
    if approval == "approved":
        return "deliver"
    elif revision_count >= iteration_limit:
        # 达到修订上限，强制交付
        return "deliver"
    elif approval == "rejected":
        # 严重问题，中止工作流
        return "abort"
    else:
        # 需要修订，返回修订节点
        return "revisor"
```

### 3.5 组装工作流图

```python
from langgraph.graph import StateGraph

workflow = StateGraph(MultiAgentState)

# 注册节点
workflow.add_node("researcher", researcher_node)
workflow.add_node("reviewer", reviewer_node)
workflow.add_node("revisor", reviser_node)
workflow.add_node("deliver", deliver_node)

# 设置入口
workflow.set_entry_point("researcher")

# 添加边
workflow.add_edge("researcher", "reviewer")

# 添加条件边：从审核员出发，根据审核结果决定下一步
workflow.add_conditional_edges(
    "reviewer",
    should_continue,
    {
        "deliver": "deliver",
        "revisor": "revisor",
        "abort": END
    }
)

# 添加循环边：修订完成后返回审核员重新审核
workflow.add_edge("revisor", "reviewer")

# 结束节点
workflow.add_edge("deliver", END)

# 编译图
graph = workflow.compile()
```

### 3.6 运行工作流

```python
import uuid

initial_state = MultiAgentState(
    user_query="分析2026年全球AI芯片产业的发展格局，包括主要厂商、产品路线图和市场格局变化",
    research_result="",
    review_result="",
    revision_count=0,
    final_result="",
    approval_status="",
    iteration_limit=3
)

# 运行工作流
thread_id = str(uuid.uuid4())
result = graph.invoke(initial_state, config={"thread_id": thread_id})

print("=== 最终交付内容 ===")
print(result["final_result"])
print(f"\n修订轮次：{result['revision_count']}")
```

## 四、生产级增强：异常处理与监控

以上是一个最小可用的多智能体系统，但在生产环境中，还需要处理以下场景：

### 4.1 超时和异常捕获

```python
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

logger = logging.getLogger(__name__)

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
def researcher_node_with_retry(state: MultiAgentState) -> MultiAgentState:
    try:
        return researcher_node(state)
    except Exception as e:
        logger.error(f"研究员节点异常: {e}")
        return {**state, "research_result": f"[研究失败，请重试] 错误: {str(e)}"}
```

### 4.2 人工介入节点

```python
def human_review_node(state: MultiAgentState) -> MultiAgentState:
    """人工审核节点：用于高敏感内容"""
    print("=" * 50)
    print("【人工审核】请检查以下内容：")
    print(state["research_result"])
    print("=" * 50)
    approval = input("审核结果 (approved/rejected/needs_revision): ").strip().lower()
    
    return {"approval_status": approval}
```

### 4.3 持久化状态与恢复

```python
from langgraph.checkpoint.sqlite import SqliteSaver

# 使用 SQLite 保存检查点，支持断点恢复
memory = SqliteSaver.from_conn_string(":memory:")

graph = workflow.compile(
    checkpointer=memory,
    interrupt_before=["human_review_node"]  # 在人工审核前中断
)

# 中断后可以查看状态并继续
snapshot = graph.get_state(config["thread_id"])
print(snapshot.values)
graph.update_state(config["thread_id"], {"approval_status": "approved"})
```

## 五、架构模式总结

在实际项目中，LangGraph 多智能体系统通常遵循以下几种模式：

### 5.1 编排器-工作者模式（Orchestrator-Worker）

```
编排器（Planner）
  ├──→ 研究员（Researcher）→ 审核（Reviewer）
  │         ↑
  │         └── 修订（Revisor）←┘
  └──→ 数据收集（Collector）
```

编排器负责任务分解和结果聚合，各个 Worker 并行执行子任务。这是最常见的模式，适合任务可拆分的场景。

### 5.2 层级审批模式（Hierarchical Approval）

```
用户输入
  └──→ 自动处理链
        ├── 初级审核
        ├── 高级审核（循环修正）
        └── 人工终审（中断等待）
```

每上一层拥有更大的决策权限，下层失败则返回上一层重新处理。适合高风险内容的处理流程。

### 5.3 专家会诊模式（Expert Panel）

```
用户问题
  ├──→ 技术专家
  ├──→ 商业专家  ──→ 决策融合 ──→ 响应
  └──→ 合规专家
```

多个专家角色独立分析问题，最后由融合节点综合多方意见形成最终答案。适合复杂决策和综合性分析。

## 六、避坑指南：LangGraph 生产常见问题

**1. 状态对象必须是可哈希的**
不要在 State 中放置不可哈希的对象（如 list of dict），使用 `Annotated[Sequence[str], operator.concat]` 代替可变列表。

**2. 循环必须有退出条件**
每次循环递增计数器，条件边检查上限，防止死循环。建议上限设置在 3-5 次。

**3. LLM 调用必须加错误处理**
网络超时、API 限流、模型返回格式错误——生产环境中这些问题几乎必然发生，一定要有重试机制。

**4. 条件路由函数要覆盖所有分支**
未覆盖的分支会导致图执行失败。可以在 `should_continue` 中添加 `else: return "deliver"` 作为保底。

## 结语

LangGraph 让我们第一次能够用声明式的方式精确描述复杂的多智能体协作流程。循环不再是 hack，而是架构的一等公民。在 2026 年的 Agent 元年，构建可靠的多智能体协作系统，正在成为每个 AI 工程师的必备技能。

希望本文能帮助你在下一个项目中，从单链架构顺利迁移到多智能体架构。

---

*本文代码基于 LangGraph 0.2.x 版本验证。*