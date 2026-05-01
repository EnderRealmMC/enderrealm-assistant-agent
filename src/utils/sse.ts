interface StreamingProxyResult {
  stream: ReadableStream;
  onComplete: Promise<string>;
}

export function createStreamingProxy(
  upstreamStream: ReadableStream,
  eventName: string = 'message'
): StreamingProxyResult {
  let accumulatedContent = '';
  let resolveComplete: (value: string) => void;
  let rejectComplete: (reason: Error) => void;

  const onCompletePromise = new Promise<string>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });

  const decoder = new TextDecoder();
  let buffer = '';
  const encoder = new TextEncoder();

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processSSELine(line, controller);
      }
    },
    flush(controller) {
      const remaining = buffer;
      const lines = remaining.split('\n');
      for (const line of lines) {
        processSSELine(line, controller);
      }

      const doneLine = `event: ${eventName}\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`;
      controller.enqueue(encoder.encode(doneLine));
      resolveComplete(accumulatedContent);
    },
  });

  function processSSELine(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!line.startsWith('data: ')) return;
    
    const data = line.slice(6);
    if (data === '[DONE]') return;

    try {
      const parsed = JSON.parse(data);
      const choice = parsed.choices?.[0];
      
      if (choice?.finish_reason) return;
      
      const content = choice?.delta?.content;
      if (content) {
        accumulatedContent += content;
        const sseLine = `event: ${eventName}\ndata: ${JSON.stringify({ content, done: false })}\n\n`;
        controller.enqueue(encoder.encode(sseLine));
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return {
    stream: upstreamStream.pipeThrough(transformStream),
    onComplete: onCompletePromise,
  };
}

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
