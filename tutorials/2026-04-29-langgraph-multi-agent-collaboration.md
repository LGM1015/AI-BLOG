---
title: "30分钟搭建多智能体协作系统：LangGraph实战完全指南"
category: "ai-agent"
categoryName: "AI智能体开发"
date: "2026-04-29"
tags: ["LangGraph", "Multi-Agent", "AI智能体", "Python实战", "工作流编排"]
description: "从架构设计到代码落地，详细讲解如何用LangGraph构建能自主规划、任务分工、结果汇总的多智能体协作系统，附完整可运行代码示例。"
---

# 30分钟搭建多智能体协作系统：LangGraph实战完全指南

当单Agent的能力遇到瓶颈时，多智能体协作就成为了必然选择。本文将从架构设计出发，手把手教你用LangGraph构建一个能自主规划、任务分工、信息汇总的Multi-Agent系统。

## 为什么需要多智能体协作

单Agent的局限很明显：**一个模型实例很难同时精通所有任务**。擅长代码生成的模型可能不擅长数据分析，擅长中文写作的模型可能英文摘要能力较弱。

多智能体协作的核心思路是：**专业分工 + 有序协作**。让擅长代码的Agent写代码，让擅长总结的Agent整理结果，让擅长校验的Agent做最终检查。各司其职，效率倍增。

## 系统架构设计

我们的演示系统包含三类Agent：

```
用户输入 → 规划Agent（Router）→ 任务分配
                               ↓
              ┌─────────────────┼─────────────────┐
              ↓                 ↓                 ↓
          搜索Agent       代码Agent         写作Agent
          （网络检索）    （代码实现）      （内容输出）
              ↓                 ↓                 ↓
              └─────────────────┼─────────────────┘
                               ↓
                         汇总Agent（Supervisor）
                               ↓
                            最终输出
```

## 环境准备

```bash
pip install langgraph langchain-openai langchain-community
```

配置API Key（以OpenAI为例，国产模型替换base_url和model名称即可）：

```python
import os
os.environ["OPENAI_API_KEY"] = "your-api-key"

from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o", temperature=0)
```

## 第一步：定义Agent节点

每个Agent本质上是一个接收状态、返回结果的函数：

```python
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    user_request: str           # 用户原始请求
    task_type: str              # 任务类型：search / code / write
    search_result: str          # 搜索Agent的结果
    code_result: str            # 代码Agent的结果
    write_result: str           # 写作Agent的结果
    final_answer: str           # 汇总Agent的最终输出
    next_step: str              # 下一步指令

def search_agent(state: AgentState) -> AgentState:
    """搜索Agent：负责从网络检索相关信息"""
    from langchain_community.tools import DuckDuckGoSearchRun
    search = DuckDuckGoSearchRun()
    
    query = f"{state['user_request']} 最新资讯和分析"
    result = search.run(query)
    
    return {"search_result": result, "next_step": "code"}

def code_agent(state: AgentState) -> AgentState:
    """代码Agent：根据搜索结果编写实现代码"""
    prompt = f"""基于以下背景信息，编写实现代码：

背景：{state['search_result']}

请写出完整、可运行的Python代码，实现相关功能。代码需要包含注释和异常处理。
"""
    result = llm.invoke(prompt)
    return {"code_result": result.content, "next_step": "write"}

def write_agent(state: AgentState) -> AgentState:
    """写作Agent：整合搜索和代码结果，生成最终报告"""
    prompt = f"""请整合以下信息，生成一份完整的分析报告：

【搜索结果】
{state['search_result']}

【代码实现】
{state['code_result']}

报告要求：
1. 结构清晰，有引言、分析、结论
2. 包含代码的核心逻辑说明
3. 字数800字以上
"""
    result = llm.invoke(prompt)
    return {"write_result": result.content, "next_step": "finish"}

def supervisor_agent(state: AgentState) -> AgentState:
    """汇总Agent：做最终质量校验和输出"""
    quality_check = llm.invoke(
        f"请检查以下报告的质量，给出修改建议：\n{state['write_result']}"
    )
    
    if "通过" in quality_check.content or "无需修改" in quality_check.content:
        final = state['write_result']
    else:
        # 如果需要修改，反馈给写作Agent重新生成
        revision = llm.invoke(
            f"请根据以下反馈修改报告：\n{quality_check.content}\n\n原文：\n{state['write_result']}"
        )
        final = revision.content
    
    return {"final_answer": final}
```

## 第二步：构建状态机

LangGraph的核心优势是将工作流建模为**有向状态图**。每个节点是一个Agent，边是状态转换条件：

```python
from langgraph.graph import StateGraph, END

workflow = StateGraph(AgentState)

# 注册节点
workflow.add_node("search", search_agent)
workflow.add_node("code", code_agent)
workflow.add_node("write", write_agent)
workflow.add_node("supervisor", supervisor_agent)

# 设置入口
workflow.set_entry_point("search")

# 定义条件边：根据next_step决定下一个节点
def route_to_next(state: AgentState) -> str:
    next_step = state.get("next_step", "search")
    step_map = {
        "code": "code",
        "write": "write", 
        "finish": "supervisor"
    }
    return step_map.get(next_step, "supervisor")

# 添加边
workflow.add_edge("search", "code")
workflow.add_edge("code", "write")
workflow.add_edge("write", "supervisor")
workflow.add_edge("supervisor", END)

# 编译
graph = workflow.compile()
```

## 第三步：运行多智能体系统

```python
# 启动协作流程
initial_state = {
    "user_request": "AI Agent最新发展趋势和投资机会",
    "task_type": "research",
    "search_result": "",
    "code_result": "",
    "write_result": "",
    "final_answer": "",
    "next_step": "search"
}

# 执行（流式输出更直观）
for state in graph.stream(initial_state, stream_mode="values"):
    current_node = list(state.keys())[-1]
    print(f"\n=== 当前节点: {current_node} ===")
    if current_node == "search":
        print(state[current_node].get("search_result", "")[:200])
    elif current_node == "code":
        print(state[current_node].get("code_result", "")[:200])
    elif current_node == "write":
        print(state[current_node].get("write_result", "")[:200])
    elif current_node == "supervisor":
        print(state[current_node].get("final_answer", "")[:200])
```

## 进阶：让Agent能互相「对话」

上面的模式是串行执行，实际项目中Agent之间经常需要**双向信息交换**。比如代码Agent发现搜索结果不够，可以主动要求搜索Agent补充信息。

```python
def code_agent_with_feedback(state: AgentState) -> AgentState:
    """代码Agent：如果搜索结果不足，主动请求补充"""
    prompt = f"""根据以下背景编写代码：

背景：{state['search_result']}

如果上述信息不足以编写完整代码，请明确指出需要补充的信息。
"""
    response = llm.invoke(prompt)
    
    # 检查是否需要补充搜索
    if "需要更多" in response.content or "补充信息" in response.content:
        return {
            "code_result": response.content,
            "next_step": "search",  # 回到搜索节点
            "search_result": state["search_result"]  # 保留之前的搜索结果
        }
    else:
        return {"code_result": response.content, "next_step": "write"}
```

## 实战技巧与常见坑

**1. 状态管理要谨慎**

AgentState里不要放太多数据，大文件或长文本会导致token爆炸。建议在Agent内部单独处理，结果以字符串形式写回状态。

**2. 循环检测要设置**

默认LangGraph不限制节点访问次数，如果Agent之间互相「踢皮球」会无限循环。加入循环计数：

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
graph = workflow.compile(checkpointer=checkpointer)

# 在config中设置最大迭代次数
config = {"recursion_limit": 10}
```

**3. 错误处理要到位**

每个Agent都要有try-except保护，防止单个Agent失败导致整个流程崩溃：

```python
def robust_search(state: AgentState) -> AgentState:
    try:
        result = search.run(state["user_request"])
        return {"search_result": result, "next_step": "code"}
    except Exception as e:
        return {
            "search_result": f"搜索失败: {str(e)}，使用默认信息",
            "next_step": "code"
        }
```

## 总结

多智能体协作的核心价值在于**专业化分工 + 有序编排**。LangGraph提供了简洁的状态图抽象，让你可以：

- 定义清晰的Agent角色
- 灵活控制执行流程
- 通过状态传递实现Agent间通信
- 方便的流式输出和调试

掌握了这一套方法，你就能构建真正实用的大型多智能体系统，让不同专长的AI模型协同完成复杂任务。

---

*完整代码已上传至GitHub，配合 LangGraph 官方文档效果更佳。*
