---
title: "MCP协议实战：用 Model Context Protocol 打造可靠的多Agent工具调用系统"
category: "agent-development"
categoryName: "Agent开发"
date: "2026-06-08"
tags: ["MCP", "Model Context Protocol", "Agent", "工具调用", "LangGraph", "Python"]
description: "MCP（Model Context Protocol）是2026年最受关注的AI Agent通信协议标准。本文从协议原理出发，手把手教你在 LangGraph 中集成 MCP 工具，实现多Agent系统的可靠工具调用与协作。"
---

在构建复杂的 AI Agent 系统时，工具调用（Tool Calling）是核心能力——Agent 需要通过调用外部工具（搜索、数据库、API、文件系统）来获取最新信息、完成任务。但现实很骨感：每个 Agent 接入新工具时都需要写定制代码，工具多了以后维护成本极高，不同 Agent 之间"说不同语言"的问题让多Agent协作变得极其困难。

**MCP（Model Context Protocol）** 正是为解决这些问题而生的。它是 Anthropic 在2024年底提出的开放协议标准，2026年已经成为 AI Agent 工具调用领域的事实标准。本文将从协议原理出发，通过完整代码示例，教你在 LangGraph 中集成 MCP，构建一个可靠的多Agent工具调用系统。

## 一、MCP 协议是什么

MCP 的设计目标非常清晰：**让 AI 模型与外部工具之间的连接标准化、可复用、可组合**。

传统的工具调用模式是这样的：LLM通过Function Calling描述想调用的工具→开发者手写代码解析这个意图→调用对应API→返回结果。每个新工具都需要重复这套流程，而且不同项目之间无法复用。

MCP 引入了一个**中间协议层**：

```
┌──────────────┐      MCP协议       ┌──────────────────┐
│   LLM/Agent  │◄─────────────────►│   MCP Host/Client │
└──────────────┘                    └────────┬─────────┘
                                             │
                               ┌─────────────┼─────────────┐
                               ▼             ▼             ▼
                        ┌──────────┐  ┌──────────┐  ┌──────────┐
                        │ File System│  │  Search   │  │  Database │
                        │   Tool      │  │   Tool     │  │   Tool    │
                        └──────────────┘  └──────────────┘  └───────────┘
```

**MCP 的核心优势：**

1. **一次实现，到处运行**：同一个 MCP 工具可以在任何兼容 MCP 的 Agent 中使用
2. **工具发现机制**：Agent 启动时自动发现可用的工具列表，无需硬编码
3. **类型安全**：工具输入输出有强类型定义，LLM 不会胡乱调用
4. **可组合**：多个工具可以组合成工具集，Agent 可以批量调用

## 二、环境准备

首先安装必要的依赖：

```bash
pip install langgraph langchain-core mcp python-dotenv
```

> **注意**：MCP 的 Python SDK 提供了 `mcp` 包，你需要同时安装想要使用的 MCP 服务器工具。例如，本教程使用 `mcp-codeassistant`（代码助手）和 `mcp-search`（搜索工具）。

```bash
# 安装 MCP 服务器工具包
pip install mcp-server-filesystem mcp-server-fetch
```

## 三、MCP 工具定义：构建可复用的工具集

MCP 的核心是**工具的标准化描述**。每个工具通过一个 JSON Schema 风格的定义来描述其功能：

```python
# mcp_tools.py
from mcp import ClientSession, types
from mcp.client.stdio import stdio_client
import json

# 定义一个 MCP 工具集
MCP_TOOLS_MANIFEST = {
    "name": "developer_assistant",
    "version": "1.0.0",
    "tools": [
        {
            "name": "read_file",
            "description": "读取本地文件内容",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径"
                    },
                    "max_lines": {
                        "type": "integer",
                        "description": "最多读取行数",
                        "default": 1000
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "search_code",
            "description": "在代码库中搜索关键词",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
                    },
                    "file_pattern": {
                        "type": "string",
                        "description": "文件匹配模式，如 *.py",
                        "default": "*"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "最多返回结果数",
                        "default": 10
                    }
                },
                "required": ["query"]
            }
        },
        {
            "name": "web_search",
            "description": "搜索互联网获取最新信息",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "最多返回结果数",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        },
        {
            "name": "write_file",
            "description": "写入内容到本地文件",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径"
                    },
                    "content": {
                        "type": "string",
                        "description": "文件内容"
                    },
                    "append": {
                        "type": "boolean",
                        "description": "是否追加模式",
                        "default": False
                    }
                },
                "required": ["path", "content"]
            }
        }
    ]
}
```

这个 JSON 描述就是 MCP 的**工具契约**——LLM 通过阅读这段描述就知道有哪些工具可用、每个工具接受什么参数、返回什么格式的数据。

## 四、实现 MCP 工具处理函数

光有描述还不够，我们需要为每个工具实现真实的处理逻辑：

```python
# tool_handlers.py
import os
import re
from pathlib import Path
from typing import Any

async def handle_read_file(args: dict) -> str:
    """读取文件工具的处理函数"""
    path = args["path"]
    max_lines = args.get("max_lines", 1000)
    
    if not os.path.exists(path):
        return f"错误：文件 {path} 不存在"
    
    try:
        with open(path, 'r', encoding='utf-8') as f:
            lines = [f.readline() for _ in range(max_lines)]
            content = ''.join(lines)
        
        # 如果文件超过最大行数，添加截断提示
        remaining = sum(1 for _ in open(path, 'r', encoding='utf-8')) - max_lines
        if remaining > 0:
            content += f"\n... (文件还有 {remaining} 行未显示)"
        
        return content
    except Exception as e:
        return f"读取文件出错：{str(e)}"


async def handle_search_code(args: dict) -> str:
    """代码搜索工具的处理函数"""
    query = args["query"]
    file_pattern = args.get("file_pattern", "*")
    max_results = args.get("max_results", 10)
    
    # 模拟代码搜索（实际项目中接入 Grep 或其他搜索引擎）
    results = []
    search_path = Path(".")  # 从当前目录搜索
    
    for file in search_path.rglob(file_pattern):
        if file.is_file() and file.suffix in ['.py', '.js', '.ts', '.md']:
            try:
                content = file.read_text(encoding='utf-8', errors='ignore')
                if query.lower() in content.lower():
                    # 找到匹配行
                    for i, line in enumerate(content.split('\n'), 1):
                        if query.lower() in line.lower():
                            results.append(f"{file}:{i}: {line.strip()}")
                            if len(results) >= max_results:
                                break
            except Exception:
                pass
    
    if not results:
        return f"未找到包含 '{query}' 的代码"
    
    return "搜索结果：\n" + "\n".join(results[:max_results])


async def handle_web_search(args: dict) -> str:
    """网络搜索工具的处理函数（需要接入 Tavily/SerpAPI 等）"""
    query = args["query"]
    max_results = args.get("max_results", 5)
    
    # 这里接入真实的搜索API，示例使用伪代码
    # from tavily import TavilyClient
    # client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
    # results = client.search(query=query, max_results=max_results)
    
    return f"[模拟搜索结果] 关键词 '{query}' 的搜索已完成，共找到 {max_results} 条结果。\n（请接入真实搜索API）"


async def handle_write_file(args: dict) -> str:
    """写文件工具的处理函数"""
    path = args["path"]
    content = args["content"]
    append = args.get("append", False)
    
    try:
        mode = 'a' if append else 'w'
        with open(path, mode, encoding='utf-8') as f:
            f.write(content)
        
        action = "追加写入" if append else "覆盖写入"
        return f"成功：{action} {len(content)} 字符到 {path}"
    except Exception as e:
        return f"写入文件出错：{str(e)}"


# 工具名称到处理函数的映射
TOOL_HANDLERS = {
    "read_file": handle_read_file,
    "search_code": handle_search_code,
    "web_search": handle_web_search,
    "write_file": handle_write_file,
}
```

## 五、在 LangGraph 中集成 MCP

现在将这些 MCP 工具集成到 LangGraph Agent 中：

```python
# mcp_langgraph_agent.py
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from typing import TypedDict, Annotated
import operator

# 状态定义
class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    tool_calls: list
    last_result: str

# 初始化 LLM（使用支持 Function Calling 的模型）
llm = ChatOpenAI(model="gpt-4o", temperature=0)

# 构建工具列表（来自 MCP manifest）
tools = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文件内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "max_lines": {"type": "integer", "description": "最多读取行数", "default": 1000}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "在代码库中搜索关键词",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "file_pattern": {"type": "string", "description": "文件匹配模式", "default": "*"},
                    "max_results": {"type": "integer", "description": "最多返回结果数", "default": 10}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索查询"},
                    "max_results": {"type": "integer", "description": "最多返回结果数", "default": 5}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "写入内容到本地文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "content": {"type": "string", "description": "文件内容"},
                    "append": {"type": "boolean", "description": "是否追加模式", "default": False}
                },
                "required": ["path", "content"]
            }
        }
    }
]

# 绑定工具到 LLM
llm_with_tools = llm.bind_tools(tools)

# Agent 决策节点
def agent_node(state: AgentState) -> AgentState:
    messages = state["messages"]
    
    # 只传递最近 10 条消息以控制 token 消耗
    context = messages[-10:]
    
    response = llm_with_tools.invoke(context)
    
    return {
        "messages": [response],
        "tool_calls": response.additional_kwargs.get("tool_calls", []),
        "last_result": ""
    }

# 工具执行节点
def tool_node(state: AgentState) -> AgentState:
    tool_calls = state["tool_calls"]
    results = []
    
    for call in tool_calls:
        func_name = call["function"]["name"]
        args = json.loads(call["function"]["arguments"])
        
        # 通过 MCP 处理函数执行工具
        if func_name in TOOL_HANDLERS:
            import asyncio
            result = asyncio.run(TOOL_HANDLERS[func_name](args))
            results.append(f"[{func_name}] {result}")
        else:
            results.append(f"[{func_name}] 错误：未知工具")
    
    return {
        "messages": [AIMessage(content="\n".join(results))],
        "tool_calls": [],
        "last_result": "\n".join(results)
    }

# 判断是否需要继续调用工具
def should_continue(state: AgentState) -> str:
    if state["tool_calls"]:
        return "tool_node"
    return END

# 构建图
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
graph.add_node("tool_node", tool_node)

graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue, {
    "tool_node": "tool_node",
    END: END
})
graph.add_edge("tool_node", "agent")

agent = graph.compile()
```

## 六、多Agent协作：MCP 在多Agent系统中的价值

单 Agent 能做的事情有限，真正的威力在于多 Agent 协作。MCP 协议的价值在多 Agent 场景下体现得最为明显——每个 Agent 只需要接入同一个 MCP 工具集，就可以相互调用对方的工具，无需重复对接：

```python
# multi_agent_mcp.py
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated, Literal
import operator

class MultiAgentState(TypedDict):
    task: str
    current_agent: str
    research_result: str
    code_result: str
    final_answer: str

# ============ 子 Agent 1: 研究员 ============
def researcher_agent(state: MultiAgentState) -> MultiAgentState:
    """研究员 Agent：负责信息搜集"""
    task = state["task"]
    
    # 调用 web_search 工具（通过 MCP）
    search_result = asyncio.run(TOOL_HANDLERS["web_search"]({
        "query": task,
        "max_results": 5
    }))
    
    return {
        "current_agent": "coder",
        "research_result": search_result
    }

# ============ 子 Agent 2: 程序员 ============
def coder_agent(state: MultiAgentState) -> MultiAgentState:
    """程序员 Agent：负责代码实现"""
    task = state["task"]
    research = state["research_result"]
    
    # 调用 search_code 搜索现有代码
    code_search = asyncio.run(TOOL_HANDLERS["search_code"]({
        "query": task,
        "file_pattern": "*.py",
        "max_results": 5
    }))
    
    return {
        "current_agent": "synthesizer",
        "code_result": code_search
    }

# ============ 子 Agent 3: 综合师 ============
def synthesizer_agent(state: MultiAgentState) -> MultiAgentState:
    """综合师 Agent：整合结果并输出"""
    return {
        "final_answer": f"研究结果：{state['research_result']}\n\n代码调研：{state['code_result']}"
    }

# 构建多 Agent 协作图
multi_graph = StateGraph(MultiAgentState)
multi_graph.add_node("researcher", researcher_agent)
multi_graph.add_node("coder", coder_agent)
multi_graph.add_node("synthesizer", synthesizer_agent)

multi_graph.set_entry_point("researcher")
multi_graph.add_edge("researcher", "coder")
multi_graph.add_edge("coder", "synthesizer")
multi_graph.add_edge("synthesizer", END)

multi_agent = multi_graph.compile()

# 运行多 Agent 系统
async def main():
    result = await multi_agent.ainvoke({
        "task": "如何使用 MCP 协议构建 AI Agent",
        "current_agent": "researcher",
        "research_result": "",
        "code_result": "",
        "final_answer": ""
    })
    print(result["final_answer"])

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## 七、运行示例

完整运行一个任务：

```python
import asyncio
from mcp_langgraph_agent import agent
from langchain_core.messages import HumanMessage

async def demo():
    result = await agent.ainvoke({
        "messages": [
            HumanMessage(content="帮我搜索一下 2026年6月有什么 AI 技术热点，然后在当前目录创建一个 README.md 记录搜索结果")
        ],
        "tool_calls": [],
        "last_result": ""
    })
    
    for msg in result["messages"]:
        print(f"[{type(msg).__name__}]: {msg.content[:200]}...")
        print("---")

asyncio.run(demo())
```

执行流程：
1. **Agent 规划**：LLM 分析用户请求，识别需要调用 `web_search` 和 `write_file` 两个工具
2. **工具调用**：依次执行搜索（通过 MCP）和文件写入（通过 MCP）
3. **结果汇总**：LLM 整合工具返回结果，形成最终回答

## 八、MCP 生态：有哪些现成工具可用

MCP 生态在2026年已经非常丰富，以下是一些值得关注的官方和社区工具：

| 工具名称 | 功能 | 使用场景 |
|---------|------|---------|
| `mcp-server-filesystem` | 文件系统读写 | 代码编辑、文档处理 |
| `mcp-server-fetch` | HTTP 请求 | 爬虫、API 调用 |
| `mcp-search` | 网络搜索 | 信息获取 |
| `mcp-codeassistant` | 代码分析 | 代码审查、重构 |
| `mcp-database` | 数据库查询 | 数据分析、报表 |
| `mcp-slack` | Slack 集成 | 团队协作通知 |

安装一个 MCP 服务器非常简单：

```bash
# 以文件系统工具为例
npx @modelcontextprotocol/server-filesystem ./projects
```

## 结语

MCP 协议的本质，是把 AI Agent 的工具调用从"手工作坊"时代推进到"工业化标准"时代。它让工具可以被发现、被复用、被组合，让多 Agent 协作从"点对点定制"变成"插拔式集成"。

随着 MCP 生态的持续扩张，未来的 Agent 系统将会像乐高积木一样——每个工具是一个标准件，不同厂商开发的 Agent 可以自由组合，快速构建出复杂的企业级 AI 应用。这才是 MCP 真正有价值的地方：**不是某一种具体能力，而是一套可以让整个 AI 生态协同工作的协议语言**。

> 本文代码基于 LangGraph + Python 实现，适用于有一定 Agent 开发基础的读者。如需进一步学习，建议阅读 [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/) 和 [MCP 协议规范](https://modelcontextprotocol.io)。