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
│   │   └── health.ts        # /health 处理器
│   ├── services/
│   │   ├── openai.service.ts# OpenAI 兼容 API 调用
│   │   └── session.service.ts# KV session 管理
│   ├── prompts/
│   │   └── system.ts        # 系统提示词
│   ├── types/
│   │   └── index.ts         # 类型定义
│   └── utils/
│       └── sse.ts           # SSE 工具
├── test-chat.sh             # 测试脚本
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
```

### 3. 本地开发

```bash
npm run dev
```

Worker 将在 `http://localhost:8787` 运行。

### 4. 测试

```bash
# 发送测试消息
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'

# 检查健康状态
curl http://localhost:8787/health
```

### 5. 部署

```bash
npm run deploy
```

## API 文档

### POST /api/chat

发送消息并接收 SSE 流式响应。

**请求：**
```json
{
  "message": "用户消息",
  "sessionId": "可选的会话ID"
}
```

**响应：** SSE 流

```
data: {"choices":[{"delta":{"content":"你好"}}]}
data: {"choices":[{"delta":{"content":"！"}}]}
...
data: [DONE]
```

**响应头：**
- `X-Session-Id`: 会话 ID（新会话时返回）

### GET /health

健康检查。

**响应：**
```json
{
  "status": "ok"
}
```

### OPTIONS /api/chat

CORS 预检请求（自动处理）。

## 前端对接

### SSE 解析示例

```javascript
const response = await fetch('http://your-worker.workers.dev/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '你好' })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          // 累积显示内容
          console.log(content);
        }
      } catch {}
    }
  }
}
```

### 注意事项

1. **SSE 格式**：后端直接代理 OpenAI 兼容的 SSE 响应
2. **跨域**：已配置 CORS，支持跨域请求
3. **Session**：首次请求会返回 `X-Session-Id`，后续请求带上可实现会话连续性

## 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `OPENAI_API_KEY` | API Key | `sk-xxx...` |
| `OPENAI_BASE_URL` | API 基础地址 | `https://openrouter.ai/api/v1` |
| `MODEL_NAME` | 模型名称 | `anthropic/claude-3-haiku` |

## KV Session

对话历史存储在 Cloudflare KV：

- 新会话：首次请求时自动创建
- Session ID：通过 `X-Session-Id` 响应头返回
- 持久化：刷新页面后带原 Session ID 可继续对话

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
