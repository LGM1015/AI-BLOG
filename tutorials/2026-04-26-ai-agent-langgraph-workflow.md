---
title: "使用LangGraph构建AI Agent：从任务规划到工具调用的完整实战"
category: "agent-development"
categoryName: "Agent开发"
date: "2026-04-26"
tags: ["LangGraph", "AI Agent", "工作流", "实战"]
description: "通过LangGraph实现具备任务分解、工具调用和自我纠错能力的AI Agent，掌握Agent开发的核心架构与代码实现。"
---

AI Agent（智能体）是2026年最热门的技术方向。与传统大模型"你问我答"的模式不同，Agent能够自主规划路径、调用工具、执行多步骤任务。本教程通过LangGraph框架，手把手构建一个具备完整规划-执行-检查能力的AI Agent。

## 什么是LangGraph

LangGraph是LangChain团队推出的用于构建有状态、多角色Agent工作流的框架。它的核心思想是将Agent行为建模为一张状态图（StateGraph），每个节点代表一个步骤，边代表状态转换，循环边则实现自我纠错和反复思考。

与普通Chain相比，LangGraph的优势在于：
- 支持条件分支和循环，可以实现"如果失败则重试"的逻辑
- 每个步骤都可以读写状态，实现复杂的信息累积
- 内置持久化支持，工作流可以在任意步骤暂停和恢复

## 环境准备

```bash
pip install langgraph langchain-openai langchain-community
```

本教程使用DeepSeek V4作为底层模型，你也可以替换为其他兼容OpenAI接口的模型。

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://api.deepseek.com/v1",
    api_key="your-api-key",
    model="deepseek-chat",
    streaming=True
)
```

## 定义Agent状态

Agent的核心是状态（State）。我们定义一个包含消息历史、当前任务、已执行步骤和工具调用结果的状态结构：

```python
from typing import TypedDict, Annotated, Sequence
from langgraph.graph import StateGraph, END
import operator

class AgentState(TypedDict):
    messages: Annotated[Sequence[str], operator.add]  # 对话历史
    task: str                                            # 当前任务描述
    plan: list[str]                                      # 任务分解步骤
    step_index: int                                      # 当前执行到第几步
    tool_result: str                                     # 工具调用结果
    needs_retry: bool                                    # 是否需要重试
```

## 任务规划节点

第一个关键节点是任务规划。当用户输入一个模糊的高层目标时，Agent需要先将其分解为可执行的子步骤：

```python
def planner_node(state: AgentState):
    """将高层任务分解为具体执行步骤"""
    task = state["task"]
    
    prompt = f"""你是一个任务规划专家。请将以下任务分解为3-7个具体可执行的步骤。

任务：{task}

请按顺序列出每个步骤，格式如下：
STEP 1: [具体行动]
STEP 2: [具体行动]
...

每个步骤必须是原子性的、可以直接执行的操作。"""
    
    response = llm.invoke([("human", prompt)])
    steps = extract_steps(response.content)  # 自定义解析函数
    
    return {"plan": steps, "step_index": 0}

def extract_steps(text: str) -> list[str]:
    """从LLM输出中解析出步骤列表"""
    lines = text.split('\n')
    steps = []
    for line in lines:
        if 'STEP' in line and ':' in line:
            step = line.split(':', 1)[1].strip()
            steps.append(step)
    return steps
```

## 工具定义与调用

我们定义几个实用工具供Agent调用：

```python
from langchain_core.tools import tool

@tool
def web_search(query: str) -> str:
    """搜索互联网获取最新信息"""
    # 实际项目中接入搜索API
    return f"搜索结果：关于'{query}'的信息..."

@tool
def calculator(expression: str) -> str:
    """执行数学计算"""
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"

@tool
def file_writer(filename: str, content: str) -> str:
    """写入文件"""
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    return f"文件 {filename} 已写入"

tools = [web_search, calculator, file_writer]
```

## 执行节点与自检循环

这是Agent最核心的部分：执行节点需要判断当前步骤应该调用哪个工具，并在执行后检查结果是否需要重试：

```python
def executor_node(state: AgentState):
    """执行当前步骤，调用合适的工具"""
    plan = state["plan"]
    step_index = state["step_index"]
    
    if step_index >= len(plan):
        return {"needs_retry": False}
    
    current_step = plan[step_index]
    
    # 让LLM决定使用哪个工具
    prompt = f"""当前任务：{state['task']}
执行计划：{plan}
当前步骤（步骤{step_index + 1}/{len(plan)}）：{current_step}

可用工具：web_search, calculator, file_writer

请决定：
1. 当前步骤应该调用哪个工具？（如果没有工具能完成此步骤，直接回答"无需工具"）
2. 调用的工具名称和参数是什么？

以JSON格式回答：{{"tool": "工具名", "args": {{"参数名": "参数值"}}}} 或 {{"tool": null}}"""

    response = llm.invoke([("human", prompt)])
    decision = parse_llm_json(response.content)
    
    tool_name = decision.get("tool")
    tool_args = decision.get("args", {})
    
    result = ""
    if tool_name:
        # 找到对应工具并调用
        for t in tools:
            if t.name == tool_name:
                result = t.invoke(tool_args)
                break
    else:
        result = f"步骤完成：{current_step}"
    
    return {
        "tool_result": result,
        "needs_retry": False
    }
```

## 检查节点：纠错与重试

检查节点评估上一步的执行结果。如果结果不理想，Agent可以回到上一步重新执行：

```python
def checker_node(state: AgentState):
    """检查执行结果，决定是否需要重试或进入下一步"""
    tool_result = state["tool_result"]
    step_index = state["step_index"]
    plan = state["plan"]
    
    prompt = f"""检查以下执行结果是否达到了预期目标：

当前步骤：{plan[step_index]}
执行结果：{tool_result}

评估标准：
1. 是否成功完成该步骤的任务？
2. 是否有错误或遗漏？
3. 是否需要重试？

回答格式：{{"pass": true/false, "reason": "原因", "suggestion": "如果失败，改进建议"}}"""

    response = llm.invoke([("human", prompt)])
    check = parse_llm_json(response.content)
    
    if check["pass"]:
        # 步骤完成，进入下一步
        next_index = step_index + 1
        if next_index >= len(plan):
            return {"step_index": next_index, "needs_retry": False}
        return {"step_index": next_index, "needs_retry": False}
    else:
        # 需要重试，保持step_index不变
        return {"needs_retry": True}
```

## 构建状态图

现在将所有节点组装成完整的工作流：

```python
from langgraph.graph import START

workflow = StateGraph(AgentState)

# 添加节点
workflow.add_node("planner", planner_node)
workflow.add_node("executor", executor_node)
workflow.add_node("checker", checker_node)

# 设置入口和边
workflow.add_edge(START, "planner")
workflow.add_edge("planner", "executor")
workflow.add_edge("executor", "checker")

# 条件边：检查结果决定是重试还是继续
def should_continue(state: AgentState):
    if state["step_index"] >= len(state["plan"]):
        return END
    elif state["needs_retry"]:
        return "executor"  # 重试当前步骤
    else:
        return "executor"  # 进入下一步

workflow.add_conditional_edges("checker", should_continue)

# 编译并运行
app = workflow.compile()

# 启动Agent
result = app.invoke({
    "messages": [],
    "task": "帮我分析某只股票的投资价值，包括行业前景、财务数据和风险评估，并将报告保存到stock_analysis.md",
    "plan": [],
    "step_index": 0,
    "tool_result": "",
    "needs_retry": False
})

print(result["messages"][-1])
```

## 效果与进阶

上述Agent具备了基础的任务分解、工具调用和自检纠错能力。在实际生产中，你可以进一步扩展：

1. **记忆模块**：为Agent添加长期记忆，将历史任务和结果存入向量数据库，避免重复劳动
2. **多Agent协作**：将规划Agent、执行Agent、审核Agent分离，由一个总控Agent协调
3. **人机协同**：在关键决策点插入人工确认环节，确保Agent行为安全可控
4. **错误恢复**：为每个工具添加超时处理和降级策略，提升整体鲁棒性

LangGraph的精髓在于"状态即一切"——只要状态设计得足够完善，几乎任何复杂的工作流程都可以用这张状态图表达。掌握了这个思路，Agent开发就不再神秘。
