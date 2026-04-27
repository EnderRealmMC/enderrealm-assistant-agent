export function createSSEStream(
  stream: ReadableStream,
  eventName: string = 'message'
): ReadableStream {
  let controller: ReadableStreamDefaultController;

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(c) {
      controller = c;
    },
    async pull() {
      const { done, value } = await reader.read();

      if (done) {
        controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`);
        controller.close();
        return;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`);
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;

            if (content) {
              controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify({ content, done: false })}\n\n`);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    },
  });
}

export function createSSEInit(eventName: string = 'message'): ReadableStream {
  let controller: ReadableStreamDefaultController;

  return new ReadableStream({
    start(c) {
      controller = c;
    },
    send(content: string, done: boolean = false) {
      controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify({ content, done })}\n\n`);
      if (done) {
        controller.close();
      }
    },
    error(err: Error) {
      controller.error(err);
    },
  });
}
