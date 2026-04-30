# EnderRealm Assistant Agent

基于 Cloudflare Workers 的 AI 助手后端，提供 SSE 流式响应。

## 项目结构

```
enderrealm-assistant-agent/
├── src/
│   ├── index.ts              # Worker 入口
│   ├── config/
│   │   └── env.ts           # 环境变量配置
│   ├── routes/
│   │   ├── router.ts        # 路由
│   │   ├── chat.ts          # /api/chat 处理器
│   │   ├── health.ts        # /health 处理器
│   │   └── session.ts       # /api/session/* 处理器
│   ├── services/
│   │   ├── openai.service.ts# OpenAI 兼容 API 调用
│   │   └── session.service.ts# KV session 管理
│   ├── prompts/
│   │   └── system.ts        # 系统提示词
│   ├── types/
│   │   └── index.ts         # 类型定义
│   └── utils/
│       └── sse.ts           # SSE 工具
├── test-chat.py             # Python 测试脚本
├── wrangler.toml            # Cloudflare 配置
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
  -d '{"sessionId":"<session_id>","message":"你好"}'

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

发送消息并接收 SSE 流式响应。

**请求头：**
```
Content-Type: application/json
X-Session-Token: <session token>
```

**请求体：**
```json
{
  "sessionId": "session_1234567890_abc123",
  "message": "用户消息"
}
```

**响应：** SSE 流
```
event: message
data: {"content":"AI 回复内容...","done":false}

event: message
data: {"content":"","done":true}
```

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

获取会话的完整消息历史。

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
    { "role": "user", "content": "用户消息" },
    { "role": "assistant", "content": "AI 回复" }
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
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
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

### SSE 解析示例

```javascript
const response = await fetch('http://localhost:8787/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Token': sessionToken
  },
  body: JSON.stringify({
    sessionId: sessionId,
    message: '你好'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('event: message')) {
      continue;
    }
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        if (json.content) {
          console.log(json.content);  // 累积显示内容
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
python test-chat.py create       # 创建会话
python test-chat.py chat 你好    # 发送消息
python test-chat.py info         # 查看会话信息
python test-chat.py messages     # 查看消息列表
python test-chat.py export       # 导出会话
python test-chat.py import xxx.json  # 导入会话
```

**注意**：交互模式下，第一条消息发送后需等待 AI 完全回复才能发送第二条（因为采用非流式 API 调用）。

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OPENAI_API_KEY` | API Key | - |
| `OPENAI_BASE_URL` | API 基础地址 | - |
| `MODEL_NAME` | 模型名称 | `deepseek-ai/deepseek-v4-flash` |
| `SESSION_TTL_DAYS` | Session 有效期（天） | `7` |

## KV Session

对话历史存储在 Cloudflare KV：

- **创建会话**：调用 `POST /api/session/create` 获取 sessionId 和 token
- **认证**：所有 session 操作需携带 `X-Session-Token` 请求头
- **安全**：token 只在创建时返回一次，请妥善保存
- **导出/导入**：支持完整会话迁移
- **过期机制**：默认 7 天无活动自动删除，每次对话后会刷新过期时间

**自动清理**：
- 每天凌晨 4 点（服务器时间）自动清理过期 session
- 访问过期 session 时会被懒删除（返回 404）
- 活跃 session 在每次对话完成后自动续期

**注意**：session/token 机制用于防止暴力撞库，不代表加密传输。请使用 HTTPS。

## 提示词

系统提示词位于 `src/prompts/system.ts`。可以自定义 AI 的行为规则。

当前默认规则：
- 默认"不懂"，不确认的问题一律拒绝回答
- 服务器相关问题需有文档支持
- 委婉拒绝不确定的问题

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
