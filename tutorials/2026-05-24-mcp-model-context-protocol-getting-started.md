---
title: "MCP协议入门：让AI连接真实世界的桥梁"
category: "mcp"
categoryName: "MCP协议"
date: "2026-05-24"
tags: ["MCP", "AI工具集成", "大模型", "开发者教程"]
description: "全面解析Model Context Protocol（MCP）协议的核心原理、架构组件，并通过实战代码教你快速搭建自己的MCP工具服务。"
---

# MCP协议入门：让AI连接真实世界的桥梁

大语言模型很强大，但它们有一个致命的缺陷：知识有截止日期，无法实时获取最新信息，更无法替你执行实际操作。如何让AI模型真正"动起来"——查询数据库、调用API、操作文件、甚至控制硬件设备？

这正是MCP（Model Context Protocol）要解决的问题。

## 一、什么是MCP？

MCP由Anthropic于2024年11月提出，是一种开放标准协议，旨在为大型语言模型（LLM）提供与外部世界交互的标准化方式。

打个比方：如果把AI模型比作一台功能强大的电脑，MCP就像是这台电脑的USB接口——有了它，你不再需要为每个设备单独购买专用的扩展卡，只需要插上标准线缆，就能连接鼠标、键盘、打印机、摄像头等各种外设。

在MCP出现之前，开发者想让AI调用外部工具，需要为每个模型、每个工具编写定制化的集成代码。一个项目如果接入了OpenAI的GPT、Anthropic的Claude、本地的Llama三个模型，又要调用搜索、邮件、日历、数据库四个工具，理论上需要编写 `3 × 4 = 12` 套不同的集成代码。

MCP彻底改变了这个局面——只需实现一次MCP Server，就可以被任何支持MCP的AI模型调用。

## 二、MCP的核心架构

MCP采用客户端-服务器架构，包含三个核心组件：

### 1. MCP Host（主机）

用户直接交互的AI应用程序，如AI辅助IDE、对话式AI助手等。MCP Host是用户使用AI的入口点，负责协调整个MCP通信流程。

### 2. MCP Client（客户端）

嵌入在MCP Host内部，负责将LLM的请求转换为MCP协议格式，并将MCP服务器的响应转换回LLM可理解的格式。Client还会自动发现可用的MCP服务器。

### 3. MCP Server（服务器）

提供标准化接口，让LLM可以调用各种外部工具和数据源。MCP Server是对外开放的"功能模块"，负责实际执行工具逻辑。

```
┌─────────────────────────────────────────────────────────┐
│                      MCP Host                            │
│  ┌──────────┐    ┌──────────────────────────────────┐   │
│  │    LLM   │◄───│        MCP Client                 │   │
│  └──────────┘    └──────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        │ MCP协议 (JSON-RPC)
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  Server  │  │  Server  │  │  Server  │
    │ (搜索)   │  │ (邮件)   │  │ (文件)   │
    └──────────┘  └──────────┘  └──────────┘
```

## 三、MCP的工作原理

MCP定义了几种核心能力，帮助LLM与外部世界交互：

### 1. Tools（工具）

LLM可以调用的外部函数。每个Tool都有清晰的输入输出定义，LLM根据用户需求决定调用哪个工具。

### 2. Resources（资源）

可供LLM读取的外部数据源，如数据库表、文件系统、API响应等。Resource是只读的，用于为LLM提供背景信息。

### 3. Prompts（提示模板）

预定义的提示词模板，可以携带特定参数快速执行常见任务。

### 4. Sampling（采样）

允许MCP Server向LLM发送请求，实现双向通信能力。

## 四、快速实战：用Python实现一个MCP Server

下面我们来实现一个天气查询的MCP Server：

### 第一步：安装依赖

```bash
pip install mcp
```

### 第二步：定义工具

```python
# weather_server.py
from mcp.server import Server
from mcp.types import Tool, TextContent
from pydantic import AnyUrl
import httpx
import json

# 创建服务器实例
server = Server("weather-server")

# 定义工具列表
@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="get_weather",
            description="获取指定城市的天气信息",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，例如：北京、上海、杭州"
                    },
                    "country": {
                        "type": "string",
                        "description": "国家代码，例如：CN、US"
                    }
                },
                "required": ["city"]
            }
        )
    ]

# 处理工具调用
@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "get_weather":
        city = arguments.get("city")
        country = arguments.get("country", "CN")
        
        # 这里调用实际的天气API（以心知天气为例）
        api_key = "your_api_key"
        url = f"https://api.seniverse.com/v3/weather/now.json?key={api_key}&location={city}&language=zh-Hans"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            data = response.json()
            
        weather_data = data.get("results", [{}])[0].get("now", {})
        
        result_text = f"""📍 {city} 天气实况

🌡️ 温度：{weather_data.get('temperature', 'N/A')}°C
💨 天气：{weather_data.get('text', 'N/A')}
🌬️ 风速：{weather_data.get('wind_speed', 'N/A')} km/h
💧 湿度：{weather_data.get('humidity', 'N/A')}%

最后更新：{data.get('results', [{}])[0].get('last_update', 'N/A')}
"""
        return [TextContent(type="text", text=result_text)]
    
    raise ValueError(f"Unknown tool: {name}")

# 启动服务器
if __name__ == "__main__":
    import mcp.server.stdio
    
    async def main():
        async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options()
            )
    
    import asyncio
    asyncio.run(main())
```

### 第三步：运行服务器

```bash
python weather_server.py
```

服务器会以stdio模式运行，等待MCP Client的请求。

### 第四步：在客户端使用

以下是一个使用Claude Desktop作为MCP Host的示例配置：

```json
// ~/.config/claude-desktop/claude_desktop_config.json
{
  "mcpServers": {
    "weather": {
      "command": "python",
      "args": ["/path/to/weather_server.py"]
    }
  }
}
```

重启Claude Desktop后，你可以这样对话：

> **用户**：北京今天天气怎么样？
> 
> **AI**：我来帮你查询北京的天气...

AI会自动调用`get_weather`工具，返回天气信息。

## 五、MCP与Function Calling的区别

很多人会问：MCP和Function Calling有什么区别？它们不是都能让AI调用外部工具吗？

实际上，两者解决的是不同层次的问题：

| 对比维度 | Function Calling | MCP |
|---------|----------------|-----|
| 适用范围 | 单个模型厂商的API | 跨模型、跨平台的标准 |
| 标准化程度 | 厂商私有协议 | 开放标准 |
| 生态连接 | 需为每个工具-模型组合单独开发 | 一次实现，处处可用 |
| 复杂度 | 低（单次调用） | 高（需要搭建服务器） |
| 适用场景 | 快速集成单一工具 | 构建多工具、多模型的复杂系统 |

简单来说：Function Calling是**战术级**的工具，用于快速完成单一功能；MCP是**战略级**的架构，用于构建完整的AI工具生态。

## 六、MCP的应用场景

MCP的用武之地非常广泛：

**1. 数据库助手**

让AI直接查询数据库，用自然语言提问，获得结构化的数据结果。

**2. 文件处理系统**

让AI读取、编辑、搜索本地文件，实现智能文件管理。

**3. API集成网关**

将各种第三方API（Slack、GitHub、Notion等）封装为MCP Server，让AI能够操控这些服务。

**4. 代码执行环境**

让AI直接运行代码、访问Git仓库、执行shell命令，实现真正的编程辅助。

**5. 物联网控制**

连接智能家居、工业设备，用自然语言控制物理世界。

## 七、常见MCP Server推荐

社区已经涌现了大量优质的MCP Server：

- **Filesystem MCP Server** - 文件系统操作
- **GitHub MCP Server** - GitHub API集成
- **Slack MCP Server** - Slack消息收发
- **PostgreSQL MCP Server** - 数据库查询
- **Brave Search MCP Server** - 网络搜索

完整的MCP Servers列表可以在 [MCP GitHub仓库](https://github.com/modelcontextprotocol/servers) 找到。

## 八、注意事项与最佳实践

1. **安全第一**：MCP可以让AI执行危险操作（如删除文件、发送邮件），务必设置权限控制
2. **错误处理**：工具调用可能失败，做好完善的异常捕获和用户反馈
3. **性能优化**：避免让AI陷入"工具调用循环"，设置最大调用次数限制
4. **Schema设计**：工具的输入输出Schema要清晰明了，帮助LLM准确理解工具用途

## 结语

MCP代表了一种重要的趋势：AI正在从"被动应答的问答机器"向"主动行动的智能代理"进化。

通过MCP，开发者可以专注于业务逻辑本身，而不必为每个模型重新实现工具集成。这种标准化、开放化的架构，正是AI应用走向成熟的重要标志。

如果你正在构建AI应用，不妨考虑引入MCP——它可能正是你连接AI与真实世界的那座桥梁。