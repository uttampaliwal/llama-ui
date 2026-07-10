/**
 * Shared streaming utilities — converts HTTP response streams into
 * AsyncGenerators so every engine speaks the same streaming language.
 */

/** OpenAI-compatible SSE:  data: {"choices":[{"delta":{"content":"..."}}]} */
export async function* openaiStreamToGenerator(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch { /* skip malformed lines */ }
      }
    }
  }
}

/** Ollama NDJSON:  {"message":{"content":"..."}} */
export async function* ollamaStreamToGenerator(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed);
        const content = json.message?.content;
        if (content) yield content;
      } catch { /* skip */ }
    }
  }
}

/** Wraps a single string as a generator (non-streaming engines / stubs). */
export async function* toGenerator(text: string): AsyncGenerator<string> {
  yield text;
}
