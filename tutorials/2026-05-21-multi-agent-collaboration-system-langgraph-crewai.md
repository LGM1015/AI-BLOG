---
title: "构建多智能体协作系统：从单体Agent到Agentic Workflow实战指南"
category: "agentic-ai"
categoryName: "Agentic AI实战"
date: "2026-05-21"
tags: ["AI Agent", "多智能体", "LangGraph", "CrewAI", "Agentic Workflow", "教程"]
description: "实战指南：从零构建多智能体协作系统，深入讲解Agent角色分工、状态管理、消息传递与故障恢复，提供LangGraph与CrewAI完整代码示例。"
---

# 构建多智能体协作系统：从单体Agent到Agentic Workflow实战指南

在上一篇文章中，我们探讨了2026年AI Agent经济的宏观趋势。本文将进入实操环节——手把手教你构建一个多智能体协作系统。我们将使用两种主流框架：LangGraph（强调状态流与可控性）和CrewAI（强调角色分工与流程编排），完成从单体Agent到完整Agentic Workflow的演进。

## 为什么需要多智能体架构？

单体Agent的能力有上限。当任务复杂度提升时，单一Agent的"认知带宽"会成为瓶颈。多智能体架构通过将任务分解为多个子目标，分配给不同专业的Agent并行或串行执行，可以突破这一限制。

典型场景包括：
- 复杂研究报告生成（研究 → 写作 → 审核）
- 企业级数据分析（数据获取 → 清洗 → 分析 → 可视化）
- 供应链优化（需求预测 → 库存优化 → 物流调度）

## 第一步：用LangGraph构建有状态的多Agent系统

LangGraph是LangChain团队推出的、专为复杂Agent工作流设计的状态机框架。它的核心概念是：**节点（Node）+ 边（Edge）= 有向图**。每个节点就是一个Agent（或工具调用），状态在节点间流转。

### 基础架构：定义状态与节点

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

# 定义共享状态
class AgentState(TypedDict):
    user_query: str
    research_results: list
    draft_content: str
    final_report: str
    next_action: str

# 构建工作流图
workflow = StateGraph(AgentState)

# 节点1：研究Agent
def research_node(state: AgentState):
    """执行网络研究，返回结构化研究结果"""
    query = state["user_query"]
    results = perform_web_search(query)  # 你的搜索实现
    return {"research_results": results, "next_action": "draft"}

# 节点2：写作Agent
def draft_node(state: AgentState):
    """基于研究结果撰写初稿"""
    content = write_report(
        topic=state["user_query"],
        findings=state["research_results"]
    )
    return {"draft_content": content, "next_action": "review"}

# 节点3：审核Agent
def review_node(state: AgentState):
    """审核初稿质量，决定是否需要重写"""
    quality = evaluate_report(state["draft_content"])
    if quality < 0.7:
        return {"next_action": "draft"}  # 打回重写
    return {"final_report": state["draft_content"], "next_action": "END"}

# 添加节点到图
workflow.add_node("research", research_node)
workflow.add_node("draft", draft_node)
workflow.add_node("review", review_node)

# 定义边（条件路由）
workflow.add_edge("research", "draft")
workflow.add_conditional_edges(
    "draft",
    lambda state: state["next_action"],
    {"review": "review", END: END}
)
workflow.add_edge("review", END)

# 编译并运行
app = workflow.compile()
result = app.invoke({
    "user_query": "分析2026年AI Agent市场趋势",
    "research_results": [],
    "draft_content": "",
    "final_report": "",
    "next_action": "research"
})
```

### 关键设计：条件边与循环

LangGraph的精髓在于**条件边（Conditional Edge）**——它允许Agent根据状态决定下一步行动。在上面的例子中，`review`节点会根据内容质量决定是结束流程还是让`draft`节点重写。

对于需要循环的场景（如迭代优化），可以使用：

```python
workflow.add_conditional_edges(
    "review",
    lambda state: "continue" if state["quality_score"] < 0.8 else "END",
    {"continue": "draft", END: END}
)
```

### 长期记忆：让Agent记住上下文

单体Agent难以处理长程任务的原因之一是缺乏持久记忆。在LangGraph中，可以通过在状态中维护历史记录来实现：

```python
class AgentState(TypedDict):
    messages: Annotated[list, operator.add]  # 累积的消息历史
    memory: dict  # 持久化记忆
    iteration_count: int

def research_node(state: AgentState):
    # 读取记忆中的历史上下文
    past_findings = state["memory"].get("past_researches", [])
    # ... 执行研究
    return {
        "messages": [{"role": "researcher", "content": new_findings}],
        "memory": {"past_researches": past_findings + new_findings}
    }
```

## 第二步：用CrewAI实现角色分工协作

CrewAI是另一个强大的多Agent框架，它的核心概念是：**Crew（团队）= Agents（角色）+ Tasks（任务）+ Process（流程）**。每个Agent拥有明确的角色描述、目标和工具，它们按照预定义的流程协作完成任务。

### 核心概念解析

| 概念 | 说明 |
|------|------|
| Agent | 拥有角色（如"数据分析师"）、目标（Goal）和 backstory 的AI角色 |
| Task | 具体的工作任务，有描述、预期输出和分配的执行者 |
| Process | 任务执行流程，可选：-sequential（顺序）、hierarchical（层级）、consensus（共识）|
| Crew | Agent和Task的集合，负责管理整体执行 |

### 实战：构建金融分析Crew

```python
from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI

# 初始化LLM
llm = ChatOpenAI(model="gpt-4")

# 定义分析师Agent
analyst = Agent(
    role="高级金融分析师",
    goal="提供专业的金融市场分析和投资建议",
    backstory=(
        "你是一名有15年经验的金融分析师，曾在顶级投行工作。"
        "擅长从海量数据中提取关键信号，并能以简洁的方式呈现洞察。"
    ),
    verbose=True,
    llm=llm
)

# 定义研究员Agent
researcher = Agent(
    role="市场研究员",
    goal="收集并整理最新的市场数据和新闻",
    backstory=(
        "你是一名资深市场研究员，专注于科技行业。"
        "擅长追踪最新动态、挖掘非公开信息，并快速形成结构化报告。"
    ),
    verbose=True,
    llm=llm
)

# 定义交易策略Agent
strategist = Agent(
    role="量化交易策略师",
    goal="基于分析结果，制定具体的交易策略",
    backstory=(
        "你是一名量化交易策略师，信奉系统化、规则化的投资方法。"
        "你的策略基于数据而非直觉，强调风险管理和仓位控制。"
    ),
    verbose=True,
    llm=llm
)

# 定义任务
task_analyze = Task(
    description="分析NVIDIA、AMD和Intel三家公司的AI芯片业务表现，"
                "包括营收增长、市场份额、技术竞争力等关键指标。",
    agent=analyst,
    expected_output="一份结构化的分析报告，包含数据表格和关键结论"
)

task_research = Task(
    description="收集最近一个月AI芯片行业的重大新闻和政策变化，"
                "包括监管动态、竞争格局变化、新产品发布等。",
    agent=researcher,
    expected_output="一份新闻简报，包含时间线和影响分析"
)

task_strategy = Task(
    description="基于分析师的研究报告和研究员收集的新闻，"
                "制定一个AI芯片板块的投资策略，包含仓位建议和止损位。",
    agent=strategist,
    expected_output="一份交易策略报告，包含具体操作建议"
)

# 构建Crew
crew = Crew(
    agents=[analyst, researcher, strategist],
    tasks=[task_analyze, task_research, task_strategy],
    process=Process.hierarchical,  # 层级流程：analyst协调
    manager_agent=analyst  # 分析师作为协调者
)

# 执行
result = crew.kickoff(inputs={"topic": "AI芯片板块投资分析"})
print(result)
```

### Hierarchical vs Sequential：何时用哪个？

- **Sequential（顺序流程）**：任务有严格的先后依赖，如"先研究 → 再分析 → 最后决策"
- **Hierarchical（层级流程）**：一个Agent作为"经理"，负责分配任务、监督进度、协调冲突。适合复杂项目。

对于金融分析这个场景，`Hierarchical`更合适，因为分析师需要协调研究员和策略师的工作，并根据中间结果动态调整任务分配。

## 第三步：构建可靠的Agentic Workflow

实战中最难的不是让Agent跑起来，而是让它**稳定地跑**、**正确地处理异常**。以下是关键设计模式：

### 1. 人类在环（Human-in-the-Loop）

关键决策点需要人类介入，避免Agent犯下不可逆的错误：

```python
def critical_decision_node(state: AgentState):
    """关键决策节点，需要人工确认"""
    decision = state["proposed_action"]
    
    # 发送决策给人工审批
    approval = send_to_human_approval(decision)
    
    if not approval["approved"]:
        return {"status": "rejected", "feedback": approval["reason"]}
    return {"status": "approved", "action": decision}
```

### 2. 错误重试与降级策略

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def reliable_tool_call(tool_name, **kwargs):
    """带重试的工具调用"""
    try:
        result = execute_tool(tool_name, **kwargs)
        return result
    except Exception as e:
        logging.warning(f"Tool {tool_name} failed: {e}")
        raise  # 触发重试

def agent_node(state: AgentState):
    try:
        result = reliable_tool_call("web_search", query=state["query"])
        return {"result": result, "status": "success"}
    except Exception as e:
        # 降级：使用缓存或简化方案
        return {"result": get_cached_result(state["query"]), "status": "degraded"}
```

### 3. 任务超时与优雅退出

长时间运行的Agent需要有超时机制，避免无限等待：

```python
import signal

def timeout_handler(signum, frame):
    raise TimeoutError("Agent task timed out")

def long_running_node(state: AgentState):
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(300)  # 5分钟超时
    
    try:
        result = perform_deep_research(state["query"])
        return {"result": result}
    finally:
        signal.alarm(0)  # 取消闹钟
```

## 第四步：生产环境部署清单

当你准备将多Agent系统部署到生产环境时，以下检查清单必不可少：

### 架构层面
- [ ] 不同Agent之间是否通过标准化协议通信（MCP/A2A）？
- [ ] 是否有集中的日志和监控面板？
- [ ] Agent状态是否支持持久化（重启后能恢复）？

### 安全层面
- [ ] Agent调用外部API时是否有权限控制？
- [ ] 敏感数据是否加密？跨Agent传输是否安全？
- [ ] 是否有对抗性提示词注入的防护机制？

### 可观测性层面
- [ ] 每个Agent的执行时间、成功率、token消耗是否有监控？
- [ ] 决策链路是否可追溯（方便审计和问题定位）？
- [ ] 异常是否有自动告警？

### 成本控制层面
- [ ] 是否设置了token消费上限？
- [ ] 是否有按需扩展/收缩的机制？
- [ ] 是否区分了生产环境和开发环境的资源配额？

## 进阶：从Workflow到Autonomous Agent

当你对以上模式已经熟练掌握，可以尝试更进一步：**让Agent自己决定下一步该做什么**。

这需要实现一个"规划器（Planner）"Agent，它会：
1. 分析当前状态和最终目标
2. 枚举可选的下一步行动
3. 评估每个选项的预期收益和成本
4. 选择最优行动并执行
5. 根据执行结果更新状态，重复直到完成

这种模式通常使用**ReAct（Reasoning + Acting）**循环实现：

```python
def autonomous_agent(state: AgentState):
    goal = state["goal"]
    current_state = state["situation"]
    
    while not is_goal_achieved(goal, current_state):
        # 推理
        reasoning = llm.invoke(
            f"分析当前状态：{current_state}，目标：{goal}，"
            f"列出下一步可行的行动及其预期结果。"
        )
        
        # 选择行动
        action = select_best_action(reasoning)
        
        # 执行
        result = execute_action(action)
        
        # 更新状态
        current_state = update_state(current_state, result)
        
        # 检查超时
        if elapsed_time > MAX_TIME:
            return {"status": "timeout", "final_state": current_state}
    
    return {"status": "completed", "final_state": current_state}
```

## 总结

本文从实战角度，完整介绍了从单体Agent到多智能体协作系统的构建路径。核心要点回顾：

1. **LangGraph**：适合需要精细控制状态流、高度自定义工作流的场景
2. **CrewAI**：适合需要明确角色分工、流程固定的场景
3. **关键设计模式**：条件路由、人类在环、错误重试、超时控制
4. **生产部署**：需要从架构、安全、可观测性、成本四个维度做好准备

多智能体系统已经从"概念验证"进入"落地阶段"。掌握以上技能，你已经具备了构建企业级Agent系统的核心能力。祝开发顺利！

---

*下一步推荐：尝试将本文的示例与真实的API（搜索引擎、数据库）集成，亲自感受多Agent协作的强大威力。*