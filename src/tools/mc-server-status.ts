import type { Tool, Env } from '../types';

const MCSTATUS_API_BASE = 'https://api.mcstatus.io/v2/status';
const MAX_CONTENT_LENGTH = 8000;

interface McStatusResponse {
  online: boolean;
  host: string;
  port: number;
  ip_address: string | null;
  eula_blocked: boolean;
  retrieved_at: number;
  expires_at: number;
  version?: {
    name_raw?: string;
    name_clean?: string;
    name_html?: string;
    name?: string;
    protocol: number | null;
  };
  players?: {
    online: number | null;
    max: number | null;
    list?: Array<{
      uuid: string;
      name_raw: string;
      name_clean: string;
      name_html: string;
    }>;
  };
  motd?: {
    raw: string;
    clean: string;
    html: string;
  };
  icon?: string | null;
  mods?: Array<{ name: string; version: string }>;
  software?: string | null;
  plugins?: Array<{ name: string; version: string | null }>;
  srv_record?: { host: string; port: number } | null;
  gamemode?: string | null;
  server_id?: string | null;
  edition?: string | null;
}

export class McServerStatusTool implements Tool {
  definition = {
    name: 'mc-server-status',
    description: `查询 Minecraft 服务器状态信息，支持 Java 版、基岩版、以及同时查询双版本（cross-play）。

适用场景：
- 用户询问某个 Minecraft 服务器是否在线
- 用户询问服务器的在线人数、版本、MOTD
- 用户询问服务器使用了什么插件/模组
- 用户询问 EnderRealm 或其他服务器的状态

参数说明：
- address（必填）：服务器地址，格式为 "host" 或 "host:port"
  - 示例：mc.hypixel.net、play.example.com:25565
  - Java 版默认端口 25565，基岩版默认端口 19132
- edition（必填）：查询的版本类型
  - "java"：仅查询 Java 版
  - "bedrock"：仅查询基岩版
  - "cross-play"：同时查询 Java 版和基岩版（适用于使用 Geyser 等互通插件的服务器）

返回内容：
- 服务器在线状态
- 版本信息（版本名、协议号）
- 玩家信息（在线人数、最大人数、玩家列表）
- MOTD（服务器描述）
- 服务器软件/插件/模组（如有）
- 游戏模式（基岩版）
- SRV 记录、IP 地址、端口等元数据

注意事项：
- 使用 mcstatus.io 公共 API，有 5 请求/秒 的速率限制
- 结果可能有缓存（约 60 秒），短时间内查询同一服务器会返回相同结果
- cross-play 模式会并行查询两个版本，返回时会明确分区显示 Java 版和基岩版信息`,
    parameters: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: '服务器地址，格式为 "host" 或 "host:port"，如 mc.hypixel.net 或 play.example.com:25565',
        },
        edition: {
          type: 'string',
          enum: ['java', 'bedrock', 'cross-play'],
          description: '查询的版本类型：java（仅Java版）、bedrock（仅基岩版）、cross-play（同时查询双版本）',
        },
      },
      required: ['address', 'edition'],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const address = String(args.address ?? '').trim();
    const edition = String(args.edition ?? '').trim().toLowerCase();

    if (!address) {
      return '错误：服务器地址不能为空';
    }

    if (!['java', 'bedrock', 'cross-play'].includes(edition)) {
      return '错误：edition 参数必须是 java、bedrock 或 cross-play';
    }

    try {
      if (edition === 'cross-play') {
        return await this.queryCrossPlay(address);
      } else {
        return await this.querySingle(address, edition as 'java' | 'bedrock');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：查询服务器状态时发生异常 - ${message}`;
    }
  }

  private async querySingle(address: string, edition: 'java' | 'bedrock'): Promise<string> {
    const data = await this.fetchStatus(address, edition);
    return this.formatSingleResult(data, edition);
  }

  private async queryCrossPlay(address: string): Promise<string> {
    const [javaData, bedrockData] = await Promise.allSettled([
      this.fetchStatus(address, 'java'),
      this.fetchStatus(address, 'bedrock'),
    ]);

    const javaResult = javaData.status === 'fulfilled' ? javaData.value : null;
    const bedrockResult = bedrockData.status === 'fulfilled' ? bedrockData.value : null;
    const javaError = javaData.status === 'rejected' ? javaData.reason : null;
    const bedrockError = bedrockData.status === 'rejected' ? bedrockData.reason : null;

    let output = '';

    output += '【Java 版】\n';
    if (javaResult) {
      output += this.formatStatusFields(javaResult, 'java');
    } else {
      const errMsg = javaError instanceof Error ? javaError.message : '未知错误';
      output += `查询失败：${errMsg}`;
    }

    output += '\n\n---\n\n';

    output += '【基岩版】\n';
    if (bedrockResult) {
      output += this.formatStatusFields(bedrockResult, 'bedrock');
    } else {
      const errMsg = bedrockError instanceof Error ? bedrockError.message : '未知错误';
      output += `查询失败：${errMsg}`;
    }

    // 添加查询时间
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    output += `\n\n---\n\n【查询时间】${now}`;

    return this.truncateIfNeeded(output);
  }

  private async fetchStatus(address: string, edition: 'java' | 'bedrock'): Promise<McStatusResponse> {
    const url = `${MCSTATUS_API_BASE}/${edition}/${encodeURIComponent(address)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP 状态码 ${response.status}`);
    }

    const data = (await response.json()) as McStatusResponse;
    return data;
  }

  private formatSingleResult(data: McStatusResponse, edition: 'java' | 'bedrock'): string {
    const output = this.formatStatusFields(data, edition);
    return this.truncateIfNeeded(output);
  }

  private formatStatusFields(data: McStatusResponse, edition: 'java' | 'bedrock'): string {
    const lines: string[] = [];

    // 基本信息
    lines.push(`状态：${data.online ? '在线' : '离线或不存在'}`);
    lines.push(`地址：${data.host}:${data.port}`);

    if (data.ip_address) {
      lines.push(`IP 地址：${data.ip_address}`);
    }

    lines.push(`EULA 封禁：${data.eula_blocked ? '是' : '否'}`);

    if (!data.online) {
      lines.push('\n服务器当前离线或不存在，无法获取详细信息。');
      return lines.join('\n');
    }

    // 版本信息
    if (data.version) {
      if (edition === 'java') {
        const versionName = data.version.name_clean || data.version.name_raw || '未知';
        lines.push(`版本：${versionName}（协议 ${data.version.protocol ?? '未知'}）`);
      } else {
        const versionName = data.version.name || '未知';
        lines.push(`版本：${versionName}（协议 ${data.version.protocol ?? '未知'}）`);
      }
    }

    // 玩家信息
    if (data.players) {
      const online = data.players.online ?? '未知';
      const max = data.players.max ?? '未知';
      lines.push(`玩家：${online} / ${max}`);

      // 玩家列表（如果有）
      if (data.players.list && data.players.list.length > 0) {
        const playerNames = data.players.list.map(p => p.name_clean).join(', ');
        lines.push(`在线玩家：${playerNames}`);
      }
    }

    // MOTD
    if (data.motd) {
      lines.push(`MOTD：${data.motd.clean}`);
    }

    // Java 版特有字段
    if (edition === 'java') {
      if (data.software) {
        lines.push(`服务器软件：${data.software}`);
      }

      if (data.plugins && data.plugins.length > 0) {
        const pluginList = data.plugins
          .map(p => p.version ? `${p.name} ${p.version}` : p.name)
          .join(', ');
        lines.push(`插件：${pluginList}`);
      } else {
        lines.push('插件：无（或服务器未启用 Query）');
      }

      if (data.mods && data.mods.length > 0) {
        const modList = data.mods
          .map(m => m.version ? `${m.name} ${m.version}` : m.name)
          .join(', ');
        lines.push(`模组：${modList}`);
      } else {
        lines.push('模组：无');
      }
    }

    // 基岩版特有字段
    if (edition === 'bedrock') {
      if (data.gamemode) {
        lines.push(`游戏模式：${data.gamemode}`);
      }

      if (data.edition) {
        lines.push(`版本类型：${data.edition}`);
      }

      if (data.server_id) {
        lines.push(`服务器 ID：${data.server_id}`);
      }
    }

    // SRV 记录
    if (data.srv_record) {
      lines.push(`SRV 记录：${data.srv_record.host}:${data.srv_record.port}`);
    } else {
      lines.push('SRV 记录：无');
    }

    // 缓存信息
    if (data.retrieved_at) {
      const retrievedTime = new Date(data.retrieved_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      lines.push(`查询时间：${retrievedTime}`);
    }

    if (data.expires_at) {
      const expiresTime = new Date(data.expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      lines.push(`缓存过期：${expiresTime}`);
    }

    return lines.join('\n');
  }

  private truncateIfNeeded(text: string): string {
    if (text.length > MAX_CONTENT_LENGTH) {
      return text.substring(0, MAX_CONTENT_LENGTH) + '\n\n...(内容过长，已截断)';
    }
    return text;
  }
}
