# EnderRealm Assistant Agent

基于 Cloudflare Workers 的 AI 智能助手后端，采用 ReAct 架构，支持工具调用和 SSE 流式响应。

## 架构概览

本项目实现了一个 **ReAct (Reasoning + Acting) 智能体**，AI 可以自主决定是否调用工具、调用哪个工具、以及何时给出最终答案。

```
用户消息 → AgentRunner (ReAct 循环)
              ├─ <reasoning>思考</reasoning> → SSE: reasoning 事件（逐块流式推送，打字机效果）
              ├─ 调用工具 → SSE: tool_call 事件
              ├─ 工具结果 → SSE: tool_result 事件
              ├─ <reasoning>分析结果</reasoning> → SSE: reasoning 事件
              └─ <final_answer>最终答案</final_answer> → SSE: final_answer {done:true} 完成信号
```

### 可用工具

| 工具名 | 说明 |
|--------|------|
| `mc-wiki-search` | 搜索中文 Minecraft Wiki，返回相关页面列表 |
| `mc-wiki-get-page` | 获取中文 Minecraft Wiki 的具体页面内容 |
| `er-docs-search` | 搜索 EnderRealm 服务器文档，支持多关键词搜索 |
| `er-docs-get-doc` | 获取 EnderRealm 服务器文档的完整内容 |
| `mc-server-status` | 查询 Minecraft 服务器状态（支持 Java 版、基岩版、双版本） |

工具注册采用统一注册表模式，添加新工具只需实现 `Tool` 接口并在 `src/tools/index.ts` 中注册。

## 项目结构

```
enderrealm-assistant-agent/
├── src/
│   ├── index.ts                # Worker 入口
│   ├── config/
│   │   └── env.ts             # 环境变量配置
│   ├── routes/
│   │   ├── router.ts          # 路由
│   │   ├── chat.ts            # /api/chat 处理器 (ReAct Agent)
│   │   ├── health.ts          # /health 处理器
│   │   └── session.ts         # /api/session/* 处理器
│   ├── services/
│   │   ├── agent-runner.ts    # ReAct 循环引擎
│   │   ├── openai.service.ts  # OpenAI 兼容 API (支持 tools)
│   │   └── session.service.ts # KV session 管理
│   ├── prompts/
│   │   └── system.ts          # 系统提示词 (变量化)
│   ├── tools/
│   │   ├── index.ts           # 工具统一导出与注册
│   │   ├── registry.ts        # 工具注册表
│   │   ├── mc-wiki-search.ts  # MC Wiki 搜索工具
│   │   ├── mc-wiki-get-page.ts# MC Wiki 页面获取工具
│   │   ├── er-docs-search.ts  # EnderRealm 文档搜索工具
│   │   ├── er-docs-get-doc.ts # EnderRealm 文档获取工具
│   │   └── mc-server-status.ts# MC 服务器状态查询工具
│   ├── types/
│   │   └── index.ts           # 类型定义
│   └── utils/
│       └── sse-emitter.ts     # SSE 事件发射器
├── test-chat.py               # Python 测试脚本 (适配 ReAct SSE)
├── wrangler.toml              # Cloudflare 配置
└── tsconfig.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.dev.vars` 文件：

```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.provider.com/v1
MODEL_NAME=your-model-name
SESSION_TTL_DAYS=7
MAX_ITERATIONS=25
```

### 3. 本地开发

```bash
npm run dev
```

Worker 将在 `http://localhost:8787` 运行。

### 4. 测试

```bash
# 创建会话
curl -X POST http://localhost:8787/api/session/create

# 发送消息（带上创建返回的 token）
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: <your token>" \
  -d '{"sessionId":"<session_id>","message":"钻石有什么用？"}'

# 查看会话信息
curl http://localhost:8787/api/session/<session_id> \
  -H "X-Session-Token: <your token>"

# 健康检查
curl http://localhost:8787/health
```

### 5. 部署

```bash
npm run deploy
```

## API 文档

### SSE 事件协议

聊天接口返回 SSE 流，所有 AI 输出文本均**逐块流式推送**（打字机效果）。

| 事件 | 数据格式 | 说明 |
|------|---------|------|
| `reasoning` | `{ content: string }` | AI 推理/思考文本（逐块流式推送，打字机效果） |
| `tool_call` | `{ id: string, name: string, arguments: object }` | AI 决定调用某个工具 |
| `tool_result` | `{ id: string, name: string, result: string }` | 工具执行结果 |
| `final_answer` | `{ content: string }` 或 `{ content: "", done: true }` | 最终回答（逐块流式推送，`done=true` 表示回答完毕） |
| `error` | `{ error: string }` | 错误信息 |

> **流式机制说明**：`reasoning` 和 `final_answer` 都是逐块流式推送的。
> 
> **标签机制**：LLM 输出中使用 `<reasoning>...</reasoning>` 和 `<final_answer>...</final_answer>` 标签来明确标识输出类型。
> 标签会被服务端过滤，客户端只看到干净的内容。
> 
> - 无工具调用：AI 直接输出 `<final_answer>答案内容</final_answer>`，客户端只收到 `final_answer` 事件
> - 有工具调用：AI 先输出 `<reasoning>思考过程</reasoning>`，调用工具，最后输出 `<final_answer>最终答案</final_answer>`
> - 思考过程和最终答案**不会重复**，各司其职

### 示例：非工具调用（普通对话）

用户问"你好" → AI 直接回答（不调用工具），只推送 `final_answer`：

```
event: final_answer
data: {"content":"Hello"}

event: final_answer
data: {"content":" there! 👋"}

event: final_answer
data: {"content":" How can I help you?"}

event: final_answer
data: {"content":"","done":true}
```

### 示例：工具调用（MC 相关问题）

用户问"钻石有什么用？" → AI 搜索 Wiki → 获取页面 → 回答：

```
event: reasoning
data: {"content":"用户问的是 MC 中钻石的用途。我需要使用工具来查询。\n让我先搜索 \"钻石\" 相关的页面。"}

event: reasoning
data: {"content":"\n决定使用工具: mc-wiki-search\n"}

event: tool_call
data: {"id":"call_1","name":"mc-wiki-search","arguments":{"query":"钻石 用途","limit":5}}

event: tool_result
data: {"id":"call_1","name":"mc-wiki-search","result":"搜索'钻石 用途'的结果..."}

event: reasoning
data: {"content":"找到了相关页面，让我获取详细信息。"}

event: reasoning
data: {"content":"\n决定使用工具: mc-wiki-get-page\n"}

event: tool_call
data: {"id":"call_2","name":"mc-wiki-get-page","arguments":{"title":"钻石"}}

event: tool_result
data: {"id":"call_2","name":"mc-wiki-get-page","result":"页面: 钻石 (pageid: 10487)..."}

event: reasoning
data: {"content":"根据工具返回的信息，我来整理答案。"}

event: final_answer
data: {"content":"根据 Minecraft Wiki，钻石有以下用途：\n1. 合成高级工具与武器\n2. 合成盔甲\n3. 附魔台的必要材料\n..."}

event: final_answer
data: {"content":"","done":true}
```

### 概述

所有 API 默认支持 CORS，包含以下响应头：
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, X-Session-Token
```

**认证方式**：除创建和导入会话外，所有 session 相关操作都需要在请求头中携带 `X-Session-Token`。

---

### 1. 创建会话
**POST** `/api/session/create`

创建新会话，返回 sessionId 和 token（token 只在此刻返回，请妥善保存）。

**响应 (201):**
```json
{
  "id": "session_1234567890_abc123",
  "token": "token_19ddea907d5_5876a6b8d477388e78a174b3eac8"
}
```

---

### 2. 发送消息
**POST** `/api/chat`

发送消息并接收 SSE 流式响应（ReAct Agent 模式）。

**请求头：**
```
Content-Type: application/json
X-Session-Token: <session token>
```

**请求体：**
```json
{
  "sessionId": "session_1234567890_abc123",
  "message": "钻石有什么用？"
}
```

**响应：** SSE 流（事件类型见上方协议说明）

**响应头：**
- `X-Session-Id`: 会话 ID

---

### 3. 获取会话信息
**GET** `/api/session/:id`

获取会话基本信息（不含消息内容）。

**请求头：**
```
X-Session-Token: <session token>
```

**响应 (200):**
```json
{
  "id": "session_1234567890_abc123",
  "messageCount": 5,
  "createdAt": 1715000000000,
  "updatedAt": 1715000100000
}
```

---

### 4. 获取消息上下文
**GET** `/api/session/:id/messages`

获取会话的完整消息历史（包含工具交互记录）。

**请求头：**
```
X-Session-Token: <session token>
```

**响应 (200):**
```json
{
  "id": "session_1234567890_abc123",
  "messages": [
    { "role": "system", "content": "系统提示词..." },
    { "role": "user", "content": "钻石有什么用？" },
    { "role": "assistant", "content": null, "tool_calls": [{"id":"call_1","name":"mc-wiki-search","arguments":{"query":"钻石"}}] },
    { "role": "tool", "content": "搜索结果...", "tool_call_id": "call_1", "name": "mc-wiki-search" },
    { "role": "assistant", "content": "根据MC Wiki..." }
  ]
}
```

---

### 5. 导出会话
**GET** `/api/session/export/:id`

导出会话为 JSON 文件下载。

**请求头：**
```
X-Session-Token: <session token>
```

**响应 (200)：**
```json
{
  "messages": [...],
  "exportedAt": 1715000000000
}
```

响应头包含 `Content-Disposition: attachment; filename="session-<id>.json"`

---

### 6. 导入会话
**POST** `/api/session/import`

导入会话 JSON，生成新的会话（不保留原 ID）。

**请求体：**
```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

**响应 (201):**
```json
{
  "id": "session_newid",
  "token": "token_newtoken",
  "messageCount": 3
}
```

---

### 7. 健康检查
**GET** `/health`

**响应 (200):**
```json
{
  "status": "ok"
}
```

---

### 错误响应

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误（缺少必要字段、JSON 解析失败） |
| 401 | 缺少或无效的 X-Session-Token |
| 404 | Session 不存在 |
| 500 | 服务器内部错误 |

错误响应格式：
```json
{
  "error": "错误描述"
}
```

---

## 前端对接示例

### SSE 解析示例（ReAct Agent 模式）

```javascript
const response = await fetch('http://localhost:8787/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Token': sessionToken
  },
  body: JSON.stringify({
    sessionId: sessionId,
    message: '钻石有什么用？'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let currentEvent = '';
let reasoningText = '';   // 累积推理过程文本
let finalAnswerText = ''; // 累积最终回答文本

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const data = line.slice(6);
      try {
        const json = JSON.parse(data);

        switch (currentEvent) {
          case 'reasoning':
            // AI 推理过程 — 逐块流式推送（打字机效果）
            if (json.content) {
              reasoningText += json.content;
              // 显示为思考过程（可折叠）
              process.stdout.write(json.content);
            }
            break;
          case 'tool_call':
            // AI 决定调用工具
            console.log(`[调用工具] ${json.name}`, json.arguments);
            break;
          case 'tool_result':
            // 工具执行结果
            console.log(`[工具结果] ${json.name}:`, json.result.substring(0, 100));
            break;
          case 'final_answer':
            // 最终回答 — 也是逐块流式推送
            if (json.content) {
              finalAnswerText += json.content;
              // 逐步展示最终回答
              process.stdout.write(json.content);
            }
            if (json.done) {
              // 流结束
              console.log('\n[完成]', finalAnswerText);
            }
            break;
          case 'error':
            console.error('[错误]', json.error);
            break;
        }
      } catch {}
    }
  }
}
```

---

### Python 测试脚本

项目根目录提供了 `test-chat.py` 脚本，支持交互模式和单命令模式：

```bash
# 交互模式（推荐）
python test-chat.py

# 单命令模式
python test-chat.py create              # 创建会话
python test-chat.py chat 钻石有什么用    # 发送消息
python test-chat.py info                # 查看会话信息
python test-chat.py messages            # 查看消息列表
python test-chat.py export              # 导出会话
python test-chat.py import xxx.json     # 导入会话
```

交互模式下所有 AI 文本输出逐块流式显示（打字机效果）：
- 💭 蓝色 → 推理过程（逐块流式推送）
- 🔧 黄色 → 工具调用
- 📋 绿色 → 工具结果
- 🤖 最终回答（逐块流式推送，与推理过程分开显示）

---

## 添加新工具

1. 在 `src/tools/` 下创建新工具文件，实现 `Tool` 接口：

```typescript
import type { Tool, Env } from '../types';

export class MyNewTool implements Tool {
  definition = {
    name: 'my-new-tool',
    description: '工具描述',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '查询参数' }
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, env: Env): Promise<string> {
    // 实现工具逻辑
    return '工具结果';
  }
}
```

2. 在 `src/tools/index.ts` 中注册：

```typescript
import { MyNewTool } from './my-new-tool';

export function createDefaultRegistry(env: Env): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new McWikiSearchTool());
  registry.register(new McWikiGetPageTool());
  registry.register(new ErDocsSearchTool());
  registry.register(new ErDocsGetDocTool());
  registry.register(new McServerStatusTool());
  registry.register(new MyNewTool());  // 新增
  return registry;
}
```

3. 系统提示词会自动包含新工具的描述，无需手动修改。

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OPENAI_API_KEY` | API Key | - |
| `OPENAI_BASE_URL` | API 基础地址 | - |
| `MODEL_NAME` | 模型名称 | `deepseek-ai/deepseek-v4-flash` |
| `SESSION_TTL_DAYS` | Session 有效期（天） | `7` |
| `MAX_ITERATIONS` | ReAct 循环最大迭代次数 | `25` |

## KV Session

对话历史存储在 Cloudflare KV：

- **创建会话**：调用 `POST /api/session/create` 获取 sessionId 和 token
- **认证**：所有 session 操作需携带 `X-Session-Token` 请求头
- **安全**：token 只在创建时返回一次，请妥善保存
- **导出/导入**：支持完整会话迁移
- **过期机制**：默认 7 天无活动自动删除，每次对话后会刷新过期时间

**注意**：
- 含工具调用的会话消息体积较大（包含搜索结果和页面内容），KV 单值限制 25MB
- 工具结果已做 8000 字符截断，防止单次会话过大
- session/token 机制用于防止暴力撞库，不代表加密传输。请使用 HTTPS

**自动清理**：
- 每天凌晨 4 点（服务器时间）自动清理过期 session
- 访问过期 session 时会被懒删除（返回 404）
- 活跃 session 在每次对话完成后自动续期

## 提示词

系统提示词位于 `src/prompts/system.ts`，采用变量化设计：

- 工具描述通过 `getSystemPrompt(toolsDescription)` 动态注入
- 非MC/服务器相关问题直接回答，不调用工具
- MC相关问题必须通过工具搜索获取信息后才回答
- 自动包含可用工具列表和使用指南

## ReAct 循环机制

Agent 采用标准 ReAct 模式运行，通过标签机制实现思考过程和最终答案的分离：

### 标签机制

LLM 输出中使用以下标签来标识输出类型（标签会被过滤，客户端只看到干净的内容）：

- `<reasoning>...</reasoning>` - 思考/推理过程
- `<final_answer>...</final_answer>` - 最终答案

### 执行流程

1. **Reasoning（推理）**：AI 在 `<reasoning>` 标签中输出思考过程，逐块流式推送为 `reasoning` 事件
2. **Acting（行动）**：如果需要，调用相应工具（`tool_call` 事件）
3. **Observation（观察）**：接收工具返回的结果（`tool_result` 事件）
4. **循环**：根据观察结果决定是否继续调用工具或给出最终答案
5. **Final Answer（最终回答）**：AI 在 `<final_answer>` 标签中输出最终答案，逐块流式推送为 `final_answer` 事件，`done=true` 标记流结束

### 流式解析

OpenAIService 中的 `StreamTagParser` 负责：
- 实时解析 LLM 输出中的标签
- 根据标签类型切换推送事件（`reasoning` 或 `final_answer`）
- 过滤标签本身，客户端只看到干净的内容
- 支持标签被分割在多个 chunk 中的情况

### 优势

- **不重复**：思考过程和最终答案各司其职，不会重复推送
- **实时性**：边思考边推送，不需要缓存
- **自然性**：标签机制符合 LLM 的自然输出模式

最大循环次数：25 次（可通过 MAX_ITERATIONS 环境变量配置）

## 部署到 Cloudflare

1. 创建 KV Namespace：
   ```bash
   wrangler kv:namespace create "SESSIONS"
   ```

2. 将返回的 `id` 填入 `wrangler.toml`：
   ```toml
   [[kv_namespaces]]
   binding = "SESSIONS"
   id = "your-actual-namespace-id"
   ```

3. 部署：
   ```bash
   npm run deploy
   ```