// Mock server OpenAI-compatible để kiểm thử agent không cần API thật.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8799);

// Gửi một SSE event.
function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Trả về chunk delta chuẩn OpenAI.
function delta(res, content) {
  send(res, { choices: [{ delta: { content } }] });
}

// Gửi chunk cuối chứa thống kê token (giống include_usage).
function finishWithUsage(res, prompt, completion) {
  send(res, {
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const payload = JSON.parse(body);
    const messages = payload.messages;
    const last = messages[messages.length - 1];
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    if (last.role === 'tool') {
      delta(res, `Tool trả về: ${String(last.content).slice(0, 80)}`);
      send(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      finishWithUsage(res, 120, 25);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const userText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (userText.includes('chạy lệnh')) {
      send(res, {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"command":"echo hello-from-tool"}' } },
              ],
            },
          },
        ],
      });
      send(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      finishWithUsage(res, 95, 18);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    for (const word of ['Xin ', 'chào ', 'từ ', 'mock ', 'server.']) {
      delta(res, word);
    }
    send(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    finishWithUsage(res, 42, 7);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(PORT, () => console.log(`mock server: http://localhost:${PORT}`));
