---
title: "用 Python 从零构建 AI Agent：ReAct 循环实战指南"
category: "python-ai"
categoryName: "Python AI开发"
date: "2026-05-25"
tags: ["Python", "AI Agent", "ReAct", "LLM", "智能体"]
description: "不依赖 LangChain，用 Python 从零实现一个完整的 AI Agent。深入理解 ReAct 循环、工具调用与 Agent 架构的核心原理。"
---

说起 AI Agent，很多人第一反应是"用 LangChain/CrewAI 搭一个"。但如果你真正想理解 Agent 的本质，**从零构建才是最有效的方式**。本文手把手教你用 Python + Anthropic SDK，实现一个完整可用的 AI Agent，核心代码不过 60 行。

## 一、AI Agent 到底是什么？

一个 AI Agent 本质上是一个**循环程序**：

```
用户输入 → LLM思考 → 选择工具 → 执行工具 → 观察结果 → 重复直到完成
```

这就是著名的 **ReAct 循环**（Reasoning + Acting）。

Agent 由三个核心组件和一个循环构成：

| 组件 | 作用 |
|------|------|
| **LLM** | 理解任务、推理下一步、生成工具调用 |
| **工具（Tools）** | 让 Agent 能够操作外部世界（搜索、计算、读写文件） |
| **内存（Memory）** | 存储对话历史和中间结果 |
| **ReAct 循环** | 协调三者，持续执行直到任务完成 |

## 二、环境准备

```bash
pip install anthropic
```

然后获取 API Key（支持 Claude 3.5/3.7 系列）：

```python
import os
os.environ["ANTHROPIC_API_KEY"] = "your-api-key-here"
```

## 三、第一步：定义工具

工具是 Agent 与外界交互的桥梁。每个工具本质上是一个 Python 函数，配合一段**描述**（告诉 LLM 什么时候该用它）。

```python
import anthropic
from typing import Literal

client = anthropic.Anthropic()

# ============ 工具定义 ============

def web_search(query: str) -> str:
    """使用搜索工具在互联网上搜索信息。适用于需要最新资讯、实时数据或不确定事实的场景。"""
    # 这里接入 Tavily/Brave Search API
    # 简化示例，返回模拟结果
    return f"[搜索结果] 关于「{query}」的信息（请接入真实搜索API）"

def calculator(expression: str) -> str:
    """执行数学计算。适用于需要精确数值结果的场景。注意：表达式必须是有效的 Python 数学表达式。"""
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"

def get_current_time() -> str:
    """获取当前时间。适用于需要时间相关上下文的任务。"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# 工具注册表
TOOLS = {
    "web_search": web_search,
    "calculator": calculator,
    "get_current_time": get_current_time,
}

# 供 LLM 使用的工具描述（JSON Schema 格式）
TOOL_SCHEMAS = [
    {
        "name": "web_search",
        "description": "使用搜索工具在互联网上搜索信息。适用于需要最新资讯、实时数据或不确定事实的场景。",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "搜索查询词"}},
            "required": ["query"]
        }
    },
    {
        "name": "calculator",
        "description": "执行数学计算。适用于需要精确数值结果的场景。",
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string", "description": "数学表达式，如 2**10 + 5"}},
            "required": ["expression"]
        }
    },
    {
        "name": "get_current_time",
        "description": "获取当前时间。适用于需要时间相关上下文的任务。",
        "input_schema": {"type": "object", "properties": {}}
    }
]
```

> **实战技巧**：工具描述的写法直接影响 Agent 效果。描述要具体说明"什么时候该用这个工具"，而不仅仅是"这个工具是干什么的"。

## 四、第二步：实现 ReAct 循环

这是 Agent 的核心。我们用一个 `while` 循环，持续让 LLM 思考并调用工具，直到任务完成。

```python
def run_agent(user_message: str, model: str = "claude-sonnet-4-20250514", max_turns: int = 10):
    """运行 AI Agent 的主循环"""
    
    messages = [{"role": "user", "content": user_message}]
    
    turn = 0
    while turn < max_turns:
        turn += 1
        print(f"\n{'='*50}")
        print(f"[回合 {turn}] 正在思考...")

        # 1. 调用 LLM
        response = client.messages.create(
            model=model,
            max_tokens=2048,
            tools=TOOL_SCHEMAS,
            system="""你是一个智能助手。当用户提出问题时：
1. 先思考是否需要调用工具
2. 如果需要，在 tool_use 字段中返回工具调用
3. 工具调用完毕后，根据结果回答用户
保持回答简洁、准确。""",
            messages=messages,
        )

        # 2. 收集 LLM 的回复内容
        assistant_message = {"role": "assistant", "content": response.content}
        messages.append(assistant_message)

        # 3. 检查是否有工具调用
        tool_uses = [block for block in response.content if block.type == "tool_use"]
        
        if not tool_uses:
            # 没有工具调用，直接返回最终答案
            final_text = "".join(
                block.text for block in response.content if block.type == "text"
            )
            print(f"[最终回答] {final_text}")
            return final_text

        # 4. 执行工具调用
        for tool_use in tool_uses:
            tool_name = tool_use.name
            tool_args = tool_use.input
            
            print(f"[工具调用] {tool_name}({tool_args})")
            
            if tool_name in TOOLS:
                result = TOOLS[tool_name](**tool_args)
            else:
                result = f"错误：未找到工具 {tool_name}"
            
            print(f"[工具返回] {result}")
            
            # 5. 将工具结果反馈给 LLM（继续循环）
            messages.append({
                "role": "user", 
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result,
                }]
            })
    
    return "Agent 执行达到最大回合数限制"
```

## 五、第三步：运行 Agent

```python
# 基础对话（无需工具）
result = run_agent("你好，请介绍一下你自己")

# 需要计算的任务（触发 calculator 工具）
result = run_agent("计算 2 的 10 次方加 100")

# 需要搜索的任务（触发 web_search 工具）
result = run_agent("2026年具身智能领域有什么最新进展？")

# 需要时间的任务（触发 get_current_time 工具）
result = run_agent("现在几点了？请结合当前时间给一个今日工作建议")
```

输出示例：

```
[回合 1] 正在思考...
[工具调用] get_current_time({})
[工具返回] 2026-05-25 20:30:00
[回合 2] 正在思考...
[最终回答] 现在是 2026年5月25日晚上 20:30。建议：可以回顾一下今天的任务完成情况，为明天做计划。
```

## 六、扩展：给 Agent 加上记忆

上面的 Agent 每次运行都是独立的，不记得之前的对话。我们加一个简单的**会话记忆**：

```python
class AgentWithMemory:
    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.Anthropic()
        self.model = model
        self.conversation_history: list[dict] = []
    
    def ask(self, user_message: str) -> str:
        # 将用户消息加入历史
        self.conversation_history.append({"role": "user", "content": user_message})
        
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            tools=TOOL_SCHEMAS,
            system="你是一个有帮助的智能助手，记住之前的对话内容。",
            messages=self.conversation_history,
        )
        
        # 提取回复
        reply_text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        
        self.conversation_history.append({"role": "assistant", "content": reply_text})
        return reply_text

# 使用方式
agent = AgentWithMemory()
print(agent.ask("我叫小明"))
print(agent.ask("你记得我叫什么吗？"))  # 能记住"小明"
```

## 七、常见错误与排查

| 错误现象 | 原因 | 解决方案 |
|----------|------|----------|
| LLM 不调用工具 | 工具描述不够具体 | 在描述中明确"什么时候该用" |
| 工具参数格式错误 | `input_schema` 与实际函数签名不符 | 严格对照 JSON Schema 检查类型 |
| 循环不终止 | 任务设计不当或 max_turns 太小 | 增加 max_turns 或拆分任务 |
| 工具返回空结果 | API 调用失败或参数错误 | 加 try-except 捕获异常 |

## 八、总结

本文实现了一个最小可用的 AI Agent，核心要点：

1. **ReAct 循环**是 Agent 的灵魂：思考→行动→观察→重复
2. **工具描述**决定 Agent 能力边界，描述要具体
3. **从零实现**比使用框架更能深入理解原理
4. 在此基础上，可以继续扩展：多 Agent 协作、向量记忆、外部知识库检索（RAG）

掌握了这些，你再看 LangChain、AutoGPT、CrewAI 这些框架，会发现它们不过是这些基础组件的工程化封装。

---

*完整代码已上传至 GitHub，有问题欢迎提交 Issue。*
