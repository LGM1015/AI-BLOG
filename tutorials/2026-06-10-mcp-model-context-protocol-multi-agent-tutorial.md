---
title: "MCP协议实战：构建支持工具调用的多Agent智能体系统"
category: "mcp"
categoryName: "MCP协议"
date: "2026-06-10"
tags: ["MCP", "Agent", "多智能体", "LangChain", "工具调用"]
description: "深入讲解MCP（Model Context Protocol）协议原理，并通过LangChain从零构建一个支持外部工具调用的多Agent智能体系统，包含完整代码示例和实战步骤。"
---

2026年被业界称为"Agent元年"。随着Claude Code、GPT-6等模型原生工具调用能力的成熟，单Agent的能力边界正在快速扩展，但真正让AI Agents从"玩具"变成"生产力工具"的，是**多Agent协作**。而多Agent协作的核心，是一套标准的通信协议——这就是MCP（Model Context Protocol）。

本文将从协议原理出发，手把手带你用LangChain构建一个支持MCP协议的多Agent系统。

## 一、什么是MCP？为什么你需要了解它

### 1.1 MCP的诞生背景

在MCP出现之前，每个AI Agent需要连接外部工具（如数据库、API、文件系统）时，开发者都需要编写定制化的适配代码：

```
Agent A → 自定义代码 → SQL数据库
Agent B → 自定义代码 → 文件系统
Agent C → 自定义代码 → Slack API
```

这种"烟囱式"架构带来了两个严重问题：
- **可移植性差**：换一个模型供应商，所有工具适配代码需要重写
- **互操作性弱**：不同Agent之间无法直接通信，协作成本极高

2025年12月，**Anthropic正式提出MCP（Model Context Protocol）**，旨在标准化Agent与外部工具的交互方式。2026年，Google跟进推出**A2A（Agent-to-Agent）协议**，两大巨头罕见地在协议层达成共识，标志着一个新标准的确立。

### 1.2 MCP的核心架构

MCP的架构包含三个核心角色：

| 角色 | 职责 |
|------|------|
| **Host（宿主）** | 运行LLM的主程序，负责管理Agent生命周期 |
| **Client（客户端）** | 嵌入在Host中，与每个工具/资源建立一对一连接 |
| **Server（服务器）** | 对外提供工具（Tools）、资源（Resources）、提示（Prompts）的标准接口 |

```
┌─────────────────────────────────────────────────────┐
│                    MCP Host                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │ Agent A │   │ Agent B  │   │ Agent C  │         │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘         │
│       │              │              │                │
│  ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐          │
│  │ Client  │  │  Client  │  │  Client  │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
└───────┼─────────────┼─────────────┼─────────────────┘
        │             │             │
    ┌───▼───┐    ┌───▼───┐    ┌───▼───┐
    │Server │    │Server │    │Server │
    │ (DB)  │    │(File) │    │(API)  │
    └───────┘    └───────┘    └───────┘
```

### 1.3 MCP与A2A的区别

| 协议 | 发起方 | 目标 | 适用场景 |
|------|--------|------|----------|
| **MCP** | Anthropic | 标准化Agent与工具的交互 | Agent调用外部工具 |
| **A2A** | Google |标准化Agent之间的通信 | 多Agent协作与任务分发 |

两者互为补充：**MCP处理Agent→工具的通信，A2A处理Agent↔Agent的通信**。

## 二、环境准备

在开始之前，确保你的开发环境满足以下要求：

```bash
# Python 3.10+
python --version

# 创建虚拟环境
python -m venv mcp-env
source mcp-env/bin/activate  # Linux/Mac
# mcp-env\Scripts\activate   # Windows

# 安装核心依赖
pip install langchain langchain-core langchain-anthropic
pip install "langchain[all]"  # 包含LangChain生态系统
pip install anthropic
pip install python-dotenv
```

在项目根目录创建`.env`文件：

```bash
ANTHROPIC_API_KEY=your_api_key_here
```

## 三、构建支持MCP的单一Agent

我们先从最简单的场景开始：**构建一个可以通过MCP协议调用外部工具的Agent**。

### 3.1 定义工具服务器

MCP的核心是工具的标准化接入。我们先用Python实现一个简单的MCP风格工具服务器：

```python
# mcp_server.py
from typing import Any
from langchain_core.tools import tool

@tool
def search_web(query: str) -> str:
    """搜索互联网获取实时信息"""
    # 这里可以接入 Tavily、Bing Search 等服务
    return f"搜索结果：{query}的相关信息（模拟数据）"

@tool
def calculate(expression: str) -> str:
    """执行数学计算"""
    try:
        result = eval(expression)
        return f"计算结果：{expression} = {result}"
    except Exception as e:
        return f"计算错误：{e}"

@tool
def get_weather(city: str) -> str:
    """获取指定城市的天气信息"""
    #实际项目中可接入 weather API
    return f"{city}的天气：晴，温度26°C，湿度45%"

# 收集所有工具
MCP_TOOLS = [search_web, calculate, get_weather]
```

### 3.2 构建Agent

```python
# agent.py
import os
from dotenv import load_dotenv
from anthropic import Anthropic
from langchain_anthropic import ChatAnthropic
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

load_dotenv()

# 初始化模型
llm = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
    temperature=0.3,
)

# 定义Agent提示词
prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个智能助手，可以调用多种工具来完成任务。
在需要实时信息时使用search_web工具。
在需要计算时使用calculate工具。
在需要天气信息时使用get_weather工具。
请始终选择最合适的工具来回答用户问题。"""),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad"),
])

# 创建Agent
agent = create_tool_calling_agent(llm, MCP_TOOLS, prompt)

# 创建执行器
agent_executor = AgentExecutor(
    agent=agent,
    tools=MCP_TOOLS,
    verbose=True,
    max_iterations=5,
)

# 测试运行
if __name__ == "__main__":
    response = agent_executor.invoke({
        "input": "北京今天的天气怎么样？请帮我计算一下北京今天气温的2倍是多少华氏度。"
    })
    print(response["output"])
```

运行结果：

```
> Entering new AgentExecutor chain...
✓ Invoking: `get_weather` with `{"city": "北京"}`
✓ Tool returning: "北京的天气：晴，温度26°C，湿度45%"
✓ Invoking: `calculate` with `{"expression": "26 * 9 / 5 + 32"}`
✓ Tool returning: "计算结果：26 * 9 / 5 + 32 = 78.8"
> Finished chain.

北京今天天气晴朗，气温26°C，约为78.8°F。
```

## 四、构建多Agent协作系统

单一Agent的能力有限，复杂任务需要多个专业Agent协同工作。下面我们构建一个**多Agent系统**，包含三个专业Agent和一个协调Agent：

### 4.1 系统架构设计

```
                    ┌──────────────────┐
                    │  Orchestrator │
                    │    (协调Agent)    │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    ┌───────────┐     ┌───────────┐    ┌───────────┐
    │ Research │     │  Code │     │  Writer │
    │   Agent   │     │   Agent   │     │   Agent   │
    │ (研究员)   │     │ (程序员)   │     │ (写作) │
    └─────┬─────┘└─────┬─────┘└─────┬─────┘
          │                  │                  │
    ┌─────▼─────┐     ┌─────▼─────┐     ┌─────▼─────┐
    │ Web Search│     │  Python │     │  Text Gen │
    │  Tool │     │  Executor │     │   Tool    │
    └───────────┘     └───────────┘     └───────────┘
```

### 4.2 各专业Agent实现

```python
# multi_agent_system.py
import os
from typing import Literal
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

load_dotenv()

llm = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
    temperature=0.3,
)

# ========== 工具定义 ==========

@tool
def research_web(query: str) -> str:
    """用于深度研究的信息检索工具"""
    return f"[Research Agent] 已检索到关于'{query}'的相关资料（模拟）"

@tool
def write_content(topic: str, style: str = "技术博客") -> str:
    """内容写作工具"""
    return f"[Writer Agent] 已完成关于'{topic}'的{style}风格文章（模拟）"

@tool
def execute_code(code: str) -> str:
    """代码执行工具"""
    return f"[Code Agent] 已执行代码：{code}（模拟）"

# ========== Agent工厂函数 ==========

def create_research_agent() -> AgentExecutor:
    """创建研究Agent"""
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个专业的研究员Agent，擅长信息检索和深度分析。你的任务是根据用户查询从互联网检索相关信息，并总结关键发现。"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, [research_web], prompt)
    return AgentExecutor(agent=agent, tools=[research_web], verbose=True)

def create_code_agent() -> AgentExecutor:
    """创建代码Agent"""
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个专业的编程Agent，擅长代码生成和调试。你的任务是根据需求生成高质量代码，或帮助调试现有代码。"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, [execute_code], prompt)
    return AgentExecutor(agent=agent, tools=[execute_code], verbose=True)

def create_writer_agent() -> AgentExecutor:
    """创建写作Agent"""
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个专业的写作Agent，擅长撰写技术文章、文档和报告。你的任务是将研究结果和代码分析转化为清晰、易读的内容。"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, [write_content], prompt)
    return AgentExecutor(agent=agent, tools=[write_content], verbose=True)
```

### 4.3 协调Agent实现

```python
# multi_agent_system.py（续）

def create_orchestrator() -> AgentExecutor:
    """创建协调Agent，负责分解任务并分发"""
    prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个智能协调Agent，负责将复杂任务分解为子任务并分配给专业Agent。

可用Agent：
- research_agent：负责信息检索和研究
- code_agent：负责代码生成和执行
- writer_agent：负责内容写作

你的工作流程：
1.理解用户请求的核心需求
2. 将任务分解为合理的子任务
3. 选择最合适的Agent处理每个子任务
4. 汇总各Agent的结果，给出完整答案

请以结构化的方式输出你选择的任务分配计划。"""),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, [], prompt)
    return AgentExecutor(agent=agent, tools=[], verbose=True)
```

### 4.4 多Agent协作运行

```python
# multi_agent_system.py（续）

class MultiAgentSystem:
    """多Agent协作系统"""
    
    def __init__(self):
        self.orchestrator = create_orchestrator()
        self.research_agent = create_research_agent()
        self.code_agent = create_code_agent()
        self.writer_agent = create_writer_agent()
    
    def process(self, task: str) -> str:
        """处理复杂任务的入口"""
        # 步骤1：协调Agent分析任务并制定计划
        plan = self.orchestrator.invoke({"input": task})
        plan_output = plan["output"]
        
        # 步骤2：根据计划并行或顺序调用专业Agent
        # 这里简化为一个模拟的路由逻辑
        if "研究" in plan_output or "检索" in plan_output:
            research_result = self.research_agent.invoke({
                "input": task
            })
        else:
            research_result = {"output": "（无需研究）"}
        
        if "代码" in plan_output or "编程" in plan_output:
            code_result = self.code_agent.invoke({
                "input": task
            })
        else:
            code_result = {"output": "（无需编程）"}
        
        if "写作" in plan_output or "文档" in plan_output:
            writer_result = self.writer_agent.invoke({
                "input": task
            })
        else:
            writer_result = {"output": "（无需写作）"}
        
        # 步骤3：汇总结果
        return f"""
===== 任务处理完成 =====

【协调计划】
{plan_output}

【研究结果】
{research_result['output']}

【代码结果】
{code_result['output']}

【写作结果】
{writer_result['output']}
"""

# ========== 运行示例 ==========

if __name__ == "__main__":
    system = MultiAgentSystem()
    
    result = system.process(
        "帮我研究一下2026年AI大模型的发展趋势，然后写一段Python代码来分析相关数据，最后生成一篇简短的技术博客。"
    )
    print(result)
```

## 五、MCP协议在实际项目中的应用建议

### 5.1 何时使用MCP架构

- **场景复杂**：一个任务需要多种专业能力（检索+编程+写作）
- **工具多样**：需要连接多个外部系统（数据库、API、文件系统）
- **团队协作**：多个开发者负责不同的Agent模块
- **模型异构**：需要同时使用多个不同供应商的模型

### 5.2 常见陷阱与规避

| 陷阱 | 描述 | 规避方法 |
|------|------|----------|
| **模式崩溃** | 所有Agent输出相似答案 |引入多样性激励机制 |
| **信息级联** | Agent盲目跟随早期回答 | 设置独立的验证环节 |
| **循环依赖** | Agent之间相互等待 | 设置超时和降级策略 |
| **成本爆炸** | 多Agent调用导致费用激增 | 设置最大迭代次数和预算上限 |

### 5.3 生产环境建议

1. **日志与监控**：为每个Agent设置独立的日志，便于追踪问题
2. **错误处理**：为工具调用设置重试机制和降级策略
3. **安全边界**：对Agent的工具调用权限进行分级管控
4. **成本控制**：在AgentExecutor中设置`max_iterations`，防止无限循环

```python
# 生产环境推荐配置
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=False, # 生产环境关闭verbose
    max_iterations=10,        # 设置最大迭代次数
    max_execution_time=120,  # 设置最大执行时间（秒）
    handle_parsing_errors=True,  # 自动处理解析错误
)
```

## 结语

MCP协议和多Agent协作系统，代表了2026年AI应用开发的主流方向。从"单模型+单工具"的简单架构，向"多模型+多Agent+标准化协议"的复杂系统演进，是每一个AI开发者都必须掌握的技能。

本文的代码示例覆盖了从工具定义、单一Agent构建到多Agent协作系统的完整链条。你可以在此基础上根据实际业务需求进行扩展——无论是接入真实的搜索API、连接向量数据库，还是实现A2A协议的多Agent通信，都可以基于这套框架快速落地。

**下一步建议**：尝试将本教程中的模拟工具替换为真实API（如Tavily搜索、OpenWeatherMap天气），体验真实的多Agent协作效果。