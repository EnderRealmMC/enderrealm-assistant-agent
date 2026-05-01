export interface SSEEmitter {
  emit(event: string, data: unknown): void;
  close(): void;
}

export interface SSEStreamResult {
  stream: ReadableStream<Uint8Array>;
  emitter: SSEEmitter;
}

const encoder = new TextEncoder();

/**
 * 创建一个多事件类型的 SSE 流。
 * 返回可读流和发射器，AgentRunner 通过发射器推送不同事件。
 */
export function createSSEEmitter(): SSEStreamResult {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const emitter: SSEEmitter = {
    emit(event: string, data: unknown) {
      const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(line));
    },
    close() {
      controller.close();
    },
  };

  return { stream, emitter };
}