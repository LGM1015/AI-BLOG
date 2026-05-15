---
title: "LangGraph 入门指南：用 Python 构建有记忆的 AI Agent"
category: "agent-development"
categoryName: "Agent 开发"
date: "2026-05-15"
tags: ["LangGraph", "AI Agent", "Python", "工作流", "状态管理"]
description: "从零开始，用 LangGraph 构建一个带状态管理和工具调用能力的 AI Agent，掌握 LangGraph 的核心概念和实战技巧。"
---

如果你已经用 LangChain 写过一些 LLM 应用，但总觉得 pipeline 写得太"线性"——用户问一个问题，LLM 生成回答，结束——那么是时候了解一下 **LangGraph** 了。

LangGraph 是 LangChain 生态中最强大的框架，专门解决"**复杂、多步骤、状态持久化**"的 AI 应用场景。它将 AI 应用建模为一个**图（Graph）**，每个节点是一个处理步骤，边代表状态流转方向。支持条件分支、循环、人机协作（Human-in-the-Loop）等高级特性。

本文将从核心概念讲起，用一个完整的实战案例，带你从零构建一个有记忆的 AI Agent。

## 一、为什么需要 LangGraph？

用一个具体场景来说明：做一个"多来源 Research Agent"。

用户问："帮我比较一下特斯拉和比亚迪最新财年的财务数据。"

一个聪明的 Agent 需要：
1. **调用搜索工具**，分别搜索特斯拉和比亚迪的财报信息
2. **调用代码执行工具**，对数据进行计算和对比
3. **再次搜索**，补充分析师观点
4. **整合输出**，生成一份结构化报告

在传统 LangChain 中，这样的多步骤、循环、带条件分支的工作流并不好写。LangGraph 正是为这类场景设计的。

## 二、核心概念

LangGraph 的核心是三个概念：**State、Node、Edge**。

### 2.1 State（状态）

State 是一个 Python `TypedDict`，在图的所有节点之间共享。每个节点接收当前状态，处理后返回更新后的状态。

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END

class AgentState(TypedDict):
    messages: list[str]
    query: str
    research_results: dict
    final_report: str | None
```

### 2.2 Node（节点）

每个 Node 是一个 Python 函数，接收当前状态，返回更新的状态。

```python
def search_node(state: AgentState) -> AgentState:
    """搜索相关信息"""
    query = state["query"]
    results = web_search(query)  # 假设的工具函数
    return {"research_results": {"search": results}}
```

### 2.3 Edge（边）

Edge 定义状态如何从一个节点流向下一个节点。有两种边：

- **普通边（Edge）**：无条件从 A 到 B
- **条件边（ConditionalEdge）**：根据状态选择下一个节点

```python
from langgraph.graph import START

# 普通边：从 START 到 search_node
graph.add_edge(START, "search_node")

# 条件边：根据 research_done 标志决定下一步
def should_analyze(state: AgentState) -> str:
    if state["research_results"].get("search"):
        return "analyze_node"
    return END

graph.add_conditional_edges(
    "search_node",
    should_analyze,
    {"analyze_node": "analyze_node", END: END}
)
```

## 三、完整实战：Research Agent

下面我们构建一个完整的多步骤 Research Agent，支持搜索、计算、报告生成三个阶段。

### 3.1 安装依赖

```bash
pip install langgraph langchain-openai langchain-community
```

### 3.2 定义状态

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class ResearchState(TypedDict):
    user_query: str
    search_results: list[dict]
    analysis_results: dict
    report: str
    step: str  # 追踪当前步骤
```

### 3.3 定义工具节点

```python
import json
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o", temperature=0)

def search_ticker(state: ResearchState) -> ResearchState:
    """根据用户查询提取股票代码并进行搜索"""
    query = state["user_query"]
    
    # 简单规则：从查询中提取公司名称
    companies = []
    if "特斯拉" in query or "Tesla" in query:
        companies.append({"name": "特斯拉", "ticker": "TSLA"})
    if "比亚迪" in query:
        companies.append({"name": "比亚迪", "ticker": "002594.SZ"})
    
    # 模拟搜索结果（实际项目中接入 Tavily 或 SerpAPI）
    search_results = []
    for company in companies:
        search_results.append({
            "company": company["name"],
            "ticker": company["ticker"],
            "mock_data": f"2025年财报：收入1000亿美元，净利润50亿美元"
        })
    
    return {
        "search_results": search_results,
        "step": "search_done"
    }

def analyze_data(state: ResearchState) -> ResearchState:
    """分析搜索结果，进行财务对比"""
    results = state["search_results"]
    
    # 模拟计算和对比分析
    analysis = {
        "comparison": "特斯拉收入规模更大，比亚迪增速更高",
        "metrics": {
            "特斯拉": {"revenue_billion_usd": 1000, "net_margin": "5%"},
            "比亚迪": {"revenue_billion_cny": 8000, "net_margin": "4%"}
        },
        "summary": "两家公司均呈现稳健增长态势"
    }
    
    return {
        "analysis_results": analysis,
        "step": "analysis_done"
    }

def generate_report(state: ResearchState) -> ResearchState:
    """生成结构化报告"""
    analysis = state["analysis_results"]
    search_results = state["search_results"]
    
    prompt = f"""基于以下研究数据，生成一份专业的财务对比报告：

公司数据：
{json.dumps(search_results, ensure_ascii=False, indent=2)}

分析结果：
{json.dumps(analysis, ensure_ascii=False, indent=2)}

请生成一份结构清晰的 Markdown 报告。"""
    
    response = llm.invoke(prompt)
    
    return {
        "report": response.content,
        "step": "report_done"
    }
```

### 3.4 构建图

```python
from langgraph.graph import StateGraph

# 创建图
graph = StateGraph(ResearchState)

# 注册节点
graph.add_node("search_ticker", search_ticker)
graph.add_node("analyze_data", analyze_data)
graph.add_node("generate_report", generate_report)

# 设置入口和出口
graph.add_edge(START, "search_ticker")
graph.add_edge("search_ticker", "analyze_data")
graph.add_edge("analyze_data", "generate_report")
graph.add_edge("generate_report", END)

# 编译图
research_agent = graph.compile()
```

### 3.5 运行 Agent

```python
# 调用 Agent
initial_state = {
    "user_query": "帮我比较特斯拉和比亚迪最新财年的财务表现",
    "search_results": [],
    "analysis_results": {},
    "report": "",
    "step": ""
}

result = research_agent.invoke(initial_state)

print("=== 最终报告 ===")
print(result["report"])
print("\n=== 流程状态 ===")
print(f"完成步骤: {result['step']}")
```

## 四、条件分支：让 Agent 自行决策

上面的例子是线性流程，实际应用中 Agent 需要**根据中间结果决定下一步**。

例如：搜索结果足够多则直接分析，结果太少则补充搜索。

```python
def should_research_more(state: ResearchState) -> str:
    """根据搜索结果数量决定下一步"""
    if len(state["search_results"]) >= 2:
        return "analyze_data"
    else:
        return "search_ticker"  # 补充搜索，形成循环

# 在图中间添加条件边
graph.add_conditional_edges(
    "search_ticker",
    should_research_more,
    {
        "analyze_data": "analyze_data",
        "search_ticker": "search_ticker"  # 回到搜索节点
    }
)

# 需要设置递归限制，防止无限循环
research_agent = graph.compile(checkpointer=None)  # 实际使用要配置 checkpointer
```

## 五、持久化状态：让 Agent 支持多轮对话

LangGraph 内置的 `MemorySaver` 允许将 Agent 状态持久化到磁盘或内存，实现**多轮对话中的上下文保持**。

```python
from langgraph.checkpoint.memory import MemorySaver

# 创建带持久化的 Agent
checkpointer = MemorySaver()
research_agent = graph.compile(checkpointer=checkpointer)

# 第一轮对话（用户提出问题）
config = {"configurable": {"thread_id": "user_001"}}
state1 = {"user_query": "特斯拉的财务表现如何？", ...}
result1 = research_agent.invoke(state1, config)

# 第二轮对话（用户追问），同一 thread_id 共享上下文
state2 = {"user_query": "那比亚迪呢？", ...}
result2 = research_agent.invoke(state2, config)  # Agent 能感知前一轮的结果
```

`thread_id` 类似会话 ID，同一个 ID 下的所有对话轮次共享状态。这使得 Agent 能够记住之前的搜索和分析结果，用户追问时不需要重新搜索。

## 六、工具调用的正确姿势：ReAct 模式

LangGraph 推荐使用 **ReAct（Reasoning + Acting）** 模式来做工具调用：

```
用户问题 → LLM思考 → 判断是否需要工具 → 执行工具 → 观察结果 → LLM再次思考 → ...
```

LangGraph 已经内置了 `create_react_agent` 帮助函数：

```python
from langchain import hub
from langgraph.prebuilt import create_react_agent

# 使用预构建的 ReAct Agent（包含工具调用的标准逻辑）
agent = create_react_agent(
    llm,
    tools=[search_ticker, analyze_data],
    state_schema=ResearchState
)

response = agent.invoke({"messages": [("user", "帮我比较特斯拉和比亚迪的财务数据")]})
```

## 七、最佳实践建议

1. **状态设计要精简**：State 中只存储必要的数据，不要把所有中间结果都塞进去，否则状态会越来越臃肿。
2. **善用条件边做循环**：需要反复验证/补充的工作流，用条件边实现循环比硬编码 while 更优雅。
3. **配置 Checkpointer**：生产环境的 Agent 一定要配置持久化，实现多轮对话支持。
4. **设置递归限制**：防止复杂工作流在边界情况下无限循环。
5. **Node 函数保持单一职责**：一个 Node 只做一件事，方便调试和维护。

## 结语

LangGraph 将 AI 应用从"线性 pipeline"提升到了"有状态图"的新范式。掌握了 State、Node、Edge 三个核心概念，你就能构建出支持条件分支、循环、多轮对话的复杂 Agent。

下一步，建议你尝试：
- 在实际项目中接入 Tavily 或 SerpAPI 等真实搜索工具
- 添加 Human-in-the-Loop 支持，让 Agent 在关键步骤停下来等你确认
- 探索 LangGraph 的 `interrupt` 功能，实现暂停-恢复机制

LangGraph 的生态正在快速成熟，2026年已经成为构建生产级 AI Agent 的首选框架。现在入门，正是时候。