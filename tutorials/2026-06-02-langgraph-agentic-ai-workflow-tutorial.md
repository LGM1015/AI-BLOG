---
title: "使用 LangGraph 构建 Agentic AI 工作流：从概念到实战"
category: "agentic-ai"
categoryName: "Agentic AI 开发指南"
date: "2026-06-02"
tags: ["LangGraph", "Agentic AI", "工作流", "AI Agent", "Python"]
description: "深入讲解 LangGraph 的核心概念，通过实战案例教你构建一个具备多步骤推理、工具调用和状态管理能力的 Agentic AI 工作流系统。"
---

## 前言

Agentic AI（代理式 AI）是 2026 年最热门的技术方向之一。与传统大语言模型"一问一答"的工作模式不同，Agentic AI 能够自主规划任务、调用工具、跨应用协作，真正成为"数字员工"。在上一篇文章中，我们分析了英伟达 RTX Spark 如何从硬件层面赋能 Agentic AI PC——本文则从软件层面入手，手把手教你使用 **LangGraph** 构建生产级的 Agentic AI 工作流。

## 一、什么是 LangGraph？为什么需要它？

### 1.1 LLM 应用的两大范式

在 LangChain 生态中，LLM 应用的开发模式可以分为两大类：

- **链式（Chain）**：LLM 按固定顺序执行步骤，适合简单任务，如问答、摘要、翻译。数据流是线性的，没有分支和循环。
- **图式（Graph）**：LLM 在一个状态机中运行，可以根据中间结果选择不同的下一步路径，适合复杂任务。数据流是非线性的，支持条件分支、循环、自适应。

**LangGraph** 正是为第二类场景而生的框架。它将 AI 工作流建模为**有向图**（Directed Graph），每个节点（Node）是一个 LLM 调用或工具执行，每个边（Edge）代表状态转移的规则。这种建模方式天然适合 Agentic AI 的核心特征：**感知→推理→规划→执行**的循环。

### 1.2 LangGraph 的核心概念

| 概念 | 说明 |
|---|---|
| **State** | 跨节点共享的上下文数据结构，包含对话历史、工具执行结果、LLM 输出等 |
| **Node** | 图中的计算节点，通常是 LLM 调用或工具函数 |
| **Edge** | 连接节点的边，定义状态如何从一个节点流向下一个节点 |
| **Conditional Edge** | 条件边，根据当前状态动态决定下一个节点 |
| **Graph** | 由节点和边组成的完整工作流定义 |
| **Checkpoint** | 状态快照，用于实现多轮对话的记忆和回溯 |

理解 State 是掌握 LangGraph 的关键——它是整个图的"全局内存"，每个节点都可以读取和修改 State，下游节点基于上游节点的修改继续执行。

## 二、环境准备

### 2.1 安装依赖

```bash
pip install langchain langgraph langchain-openai python-dotenv
```

### 2.2 配置 API Key

```python
import os
from dotenv import load_dotenv

load_dotenv()  # 读取 .env 文件

os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")
```

确保在项目根目录创建 `.env` 文件：

```
OPENAI_API_KEY=sk-your-api-key-here
```

## 三、从概念到代码：构建一个 Strava 训练助手

下面我们通过一个实战案例——**Strava 训练助手**——来理解 LangGraph 的完整开发流程。这个 Agent 的工作流程如下：

1. 获取用户最近的跑步/骑行记录
2. 分析训练数据，评估运动表现
3. 生成下一周的个性化训练计划
4. 发送总结邮件给用户

### 3.1 第一步：定义 State

State 是跨节点共享的数据结构。我们使用 `TypedDict` 来定义一个类型安全的 State：

```python
from typing import TypedDict, Annotated, Sequence
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

class TrainState(TypedDict):
    """Strava 训练 Agent 的状态定义"""
    user_id: str                      # 用户 ID
    recent_activities: list           # 最近的活动记录
    training_summary: str              # 训练数据分析结果
    weekly_plan: str                   # 生成的一周训练计划
    email_content: str                 # 发送的邮件内容
    messages: list                     # 对话历史（用于 LLM 上下文）
```

### 3.2 第二步：定义 Node（节点）

每个 Node 是一个 Python 函数，接收当前 State，返回需要更新到 State 中的字段。LangGraph 会自动合并这些更新。

```python
from datetime import datetime, timedelta

# 模拟从 Strava API 获取数据
def fetch_activities(state: TrainState) -> TrainState:
    """Node 1: 获取用户最近一周的活动记录"""
    user_id = state["user_id"]
    
    # 在实际项目中，这里调用 Strava API
    # activities = strava_client.get_activities(user_id, days=7)
    activities = [
        {"type": "Run", "distance": 5.2, "date": "2026-05-27", "pace": "5.3min/km"},
        {"type": "Ride", "distance": 32.1, "date": "2026-05-28", "pace": "25.2km/h"},
        {"type": "Run", "distance": 8.0, "date": "2026-05-30", "pace": "5.1min/km"},
        {"type": "Rest", "distance": 0, "date": "2026-05-31", "pace": None},
        {"type": "Run", "distance": 10.5, "date": "2026-06-01", "pace": "5.0min/km"},
    ]
    
    return {"recent_activities": activities}


def analyze_training(state: TrainState) -> TrainState:
    """Node 2: 分析训练数据，评估运动表现"""
    activities = state["recent_activities"]
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""分析以下训练数据，评估用户本周的运动表现：
    
    活动记录：
    {activities}
    
    请给出：
    1. 总训练量（跑步里程、骑行里程）
    2. 训练强度评估（高/中/低）
    3. 运动表现趋势（进步/维持/下滑）
    4. 发现的问题或建议
    
    回复简洁专业，使用中文。"""
    
    response = llm.invoke([("human", prompt)])
    return {"training_summary": response.content}


def generate_plan(state: TrainState) -> TrainState:
    """Node 3: 根据分析结果生成下周训练计划"""
    summary = state["training_summary"]
    activities = state["recent_activities"]
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""基于以下训练分析，为用户生成下周（6月3日-6月9日）的训练计划：
    
    训练分析：
    {summary}
    
    历史活动：
    {activities}
    
    请生成包含每一天训练内容的周计划，包括：
    - 训练类型（跑步/骑行/休息/力量训练）
    - 训练强度和时长
    - 具体的训练目标
    
    回复使用中文，格式清晰。"""
    
    response = llm.invoke([("human", prompt)])
    return {"weekly_plan": response.content}


def compose_email(state: TrainState) -> TrainState:
    """Node 4: 撰写并发送训练总结邮件"""
    summary = state["training_summary"]
    plan = state["weekly_plan"]
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""撰写一封给用户的个性化训练总结邮件，包含：
    
    1. 本周训练回顾（基于分析结果）
    2. 下周训练计划预览
    3. 鼓励和温馨提示
    
    训练分析：
    {summary}
    
    下周计划：
    {plan}
    
    语气友好专业，像一个私人教练。中文回复。"""
    
    response = llm.invoke([("human", prompt)])
    return {"email_content": response.content}
```

### 3.3 第三步：构建 Graph（图）

定义好节点后，我们需要将它们组装成一个 Graph。LangGraph 的工作流遵循「开始 → 节点 → 边 → 节点 → ... → 结束」的模式：

```python
def build_training_agent():
    """构建完整的训练 Agent 工作流图"""
    
    # 1. 创建状态图
    workflow = StateGraph(TrainState)
    
    # 2. 注册节点
    workflow.add_node("fetch_activities", fetch_activities)
    workflow.add_node("analyze_training", analyze_training)
    workflow.add_node("generate_plan", generate_plan)
    workflow.add_node("compose_email", compose_email)
    
    # 3. 定义边（固定顺序执行）
    workflow.set_entry_point("fetch_activities")
    workflow.add_edge("fetch_activities", "analyze_training")
    workflow.add_edge("analyze_training", "generate_plan")
    workflow.add_edge("generate_plan", "compose_email")
    workflow.add_edge("compose_email", END)
    
    # 4. 编译图
    return workflow.compile()


# 实例化 Agent
agent = build_training_agent()
```

### 3.4 第四步：执行工作流

```python
# 初始化状态并执行
initial_state = TrainState(
    user_id="user_12345",
    recent_activities=[],
    training_summary="",
    weekly_plan="",
    email_content="",
    messages=[]
)

# 执行工作流
result = agent.invoke(initial_state)

print("=== 训练分析 ===")
print(result["training_summary"])
print("\n=== 下周计划 ===")
print(result["weekly_plan"])
print("\n=== 邮件内容 ===")
print(result["email_content"])
```

运行后，你会看到 LLM 基于模拟的 Strava 活动数据生成了完整的训练分析、周计划和邮件内容。

## 四、增加条件分支：让 Agent 学会"决策"

上述工作流是纯顺序执行的。但在真实场景中，Agent 需要根据中间结果做出判断——比如训练量不足时自动增加有氧训练，发现伤病迹象时建议就医等。这就需要**条件边（Conditional Edge）**。

### 4.1 添加评估节点

```python
def evaluate_readiness(state: TrainState) -> TrainState:
    """评估用户是否适合高强度训练"""
    summary = state["training_summary"]
    llm = ChatOpenAI(model="gpt-4o")
    
    prompt = f"""根据以下训练分析，判断用户当前状态是否适合进行高强度训练。
    
    分析结果：{summary}
    
    直接回复以下格式之一：
    - "READY_HIGH_INTENSITY"（适合高强度）
    - "NEED_EASY"（建议轻松训练）
    - "REST_NEEDED"（建议休息）
    """
    
    response = llm.invoke([("human", prompt)])
    decision = response.content.strip()
    return {"readiness_decision": decision}


def high_intensity_plan(state: TrainState) -> TrainState:
    """生成高强度训练计划"""
    # ... 包含间歇跑、坡度训练等高强度内容
    return {"weekly_plan": "[高强度版本] 间歇跑 5x800m，坡度跑 6km，节奏跑 10km..."}


def easy_plan(state: TrainState) -> TrainState:
    """生成轻松训练计划"""
    return {"weekly_plan": "[轻松版本] 慢跑 5-6km，轻松骑行 30min，瑜伽/拉伸..."}
```

### 4.2 条件路由函数

```python
def should_intensify(state: TrainState) -> str:
    """根据评估结果决定下一步"""
    decision = state.get("readiness_decision", "READY_HIGH_INTENSITY")
    
    if "HIGH_INTENSITY" in decision:
        return "high_intensity"
    elif "EASY" in decision:
        return "easy"
    else:
        return "rest"


def build_conditional_agent():
    workflow = StateGraph(TrainState)
    
    # 注册所有节点
    workflow.add_node("fetch_activities", fetch_activities)
    workflow.add_node("analyze_training", analyze_training)
    workflow.add_node("evaluate_readiness", evaluate_readiness)
    workflow.add_node("high_intensity_plan", high_intensity_plan)
    workflow.add_node("easy_plan", easy_plan)
    workflow.add_node("rest_plan", lambda s: {"weekly_plan": "[休息计划] 本周建议完全休息，以恢复为主。"})
    workflow.add_node("compose_email", compose_email)
    
    # 设置入口
    workflow.set_entry_point("fetch_activities")
    workflow.add_edge("fetch_activities", "analyze_training")
    workflow.add_edge("analyze_training", "evaluate_readiness")
    
    # 条件边：根据评估结果选择不同分支
    workflow.add_conditional_edges(
        "evaluate_readiness",
        should_intensify,
        {
            "high_intensity": "high_intensity_plan",
            "easy": "easy_plan",
            "rest": "rest_plan"
        }
    )
    
    # 所有分支最终汇聚到 compose_email
    workflow.add_edge("high_intensity_plan", "compose_email")
    workflow.add_edge("easy_plan", "compose_email")
    workflow.add_edge("rest_plan", "compose_email")
    workflow.add_edge("compose_email", END)
    
    return workflow.compile()
```

这就是 LangGraph 最强大的能力——**用图的方式清晰表达复杂的多分支工作流**，而不是把决策逻辑散落在 if-else 的泥潭里。

## 五、添加记忆（Memory）：让 Agent 记住上下文

LangGraph 的另一个核心能力是 **Checkpointing**（检查点）。通过为 State 添加检查点机制，Agent 可以在多轮对话中保持记忆，支持暂停、恢复和回溯。

### 5.1 使用 MemorySaver

```python
from langgraph.checkpoint.memory import MemorySaver

def build_persistent_agent():
    workflow = StateGraph(TrainState)
    
    # ...（节点和边的定义同上）
    workflow.set_entry_point("fetch_activities")
    workflow.add_edge("fetch_activities", "analyze_training")
    workflow.add_edge("analyze_training", "generate_plan")
    workflow.add_edge("generate_plan", "compose_email")
    workflow.add_edge("compose_email", END)
    
    # 使用 MemorySaver 作为检查点存储
    checkpointer = MemorySaver()
    
    return workflow.compile(checkpointer=checkpointer)
```

### 5.2 多轮对话示例

```python
# 第一次对话
config = {"configurable": {"thread_id": "user_12345_session_1"}}

initial_state = TrainState(
    user_id="user_12345",
    recent_activities=[],
    training_summary="",
    weekly_plan="",
    email_content="",
    messages=[("human", "生成我的训练计划")]
)

result = agent.invoke(initial_state, config=config)

# 第二次对话（Agent 记得之前的上下文）
follow_up = TrainState(
    user_id="user_12345",
    recent_activities=[],
    training_summary="",
    weekly_plan="",
    email_content="",
    messages=[("human", "把间歇跑改成节奏跑")]
)

result2 = agent.invoke(follow_up, config=config)
# Agent 能够理解上下文："把间歇跑改成节奏跑"指的是之前生成的周计划
```

## 六、最佳实践与避坑指南

### 6.1 节点设计原则

- **单一职责**：每个节点只做一件事，不要在一个节点里既获取数据又做分析
- **无副作用**：节点应该是纯函数，相同输入总产生相同输出。IO 操作（API 调用、文件读写）统一封装在节点内
- **错误处理**：为每个工具调用添加异常捕获，避免单点故障导致整个工作流崩溃

```python
def safe_fetch_activities(state: TrainState) -> TrainState:
    """带错误处理的版本"""
    try:
        activities = strava_client.get_activities(state["user_id"], days=7)
        return {"recent_activities": activities}
    except StravaAPIError as e:
        # 降级处理：使用缓存数据
        cached = get_cached_activities(state["user_id"])
        return {"recent_activities": cached, "error": str(e)}
```

### 6.2 状态压缩

State 会随着工作流执行不断增长，可能导致 token 费用飙升和性能下降。建议：

- 在适当的节点对历史数据进行摘要压缩
- 使用 `messages` 的滑动窗口，保留最近 N 轮对话
- 将大块数据（如原始 API 响应）存储在外部，State 只保留引用 ID

### 6.3 调试技巧

```python
# 使用 visualize 打印图结构
agent.get_graph().print_ascii()

# 使用 LangSmith 进行分布式追踪（需要 API Key）
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = os.getenv("LANGSMITH_API_KEY")
```

## 七、完整项目结构推荐

一个生产级的 LangGraph Agent 项目推荐按以下结构组织：

```
strava_training_agent/
├── agent/
│   ├── __init__.py
│   ├── state.py          # State 定义
│   ├── nodes.py          # 所有 Node 函数
│   ├── edges.py          # 边和条件路由函数
│   └── graph.py          # Graph 构建和编译
├── tools/
│   ├── __init__.py
│   ├── strava_client.py  # Strava API 封装
│   └── email_client.py    # 邮件发送服务
├── .env
├── requirements.txt
└── run.py                # 入口脚本
```

## 结语

LangGraph 将复杂的 Agentic AI 工作流用**图**的方式建模，使系统的逻辑清晰可见、调试方便、扩展容易。本文从 State 定义、Node 开发、Graph 构建、条件路由到记忆机制，由浅入深地介绍了 LangGraph 的核心用法。

结合我们上篇文章讨论的 RTX Spark 硬件革命——当本地 AI 算力足够强大时，这些在云端运行的工作流将逐步迁移到端侧，实现更低延迟、更强隐私的 Agentic AI 体验。掌握 LangGraph，就是掌握 Agentic AI 时代最核心的工作流开发能力。

---

*本文代码基于 LangGraph 0.1.x 版本编写，Python 3.10+。*
