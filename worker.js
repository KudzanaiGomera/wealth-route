const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(body, status = 200, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function assistantPrompt(question, snapshot) {
  return `You are the Wealth Assistant inside WealthRoute, a personal finance app.
Use only the supplied JSON snapshot. Do not invent figures or assume data that is absent.
This is general educational information, not personalised financial advice. Never promise investment returns.
Give a concise, concrete answer with practical next steps when the data supports them.

Financial snapshot:
${JSON.stringify(snapshot)}

Question: ${question}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ status: 'WealthRoute API is running.' }, 200, '*');
    }

    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: 'Origin is not allowed.' }, 403, 'null');
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin } });

    if (url.pathname === '/rates' && request.method === 'GET') {
      const from = (url.searchParams.get('from') || '').toUpperCase();
      const to = (url.searchParams.get('to') || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
        return json({ error: 'Use valid three-letter currency codes.' }, 400, origin);
      }
      const response = await fetch(`https://api.frankfurter.app/latest?amount=1&from=${from}&to=${to}`);
      if (!response.ok) return json({ error: 'Rate provider is unavailable.' }, 502, origin);
      return json(await response.json(), 200, origin);
    }

    if (url.pathname === '/assistant' && request.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'Worker has no Gemini API key configured.' }, 500, origin);
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'Request body must be JSON.' }, 400, origin);
      }
      const question = typeof payload.question === 'string' ? payload.question.trim() : '';
      if (!question || question.length > 1_000 || !payload.snapshot || typeof payload.snapshot !== 'object') {
        return json({ error: 'Provide a question up to 1,000 characters and a financial snapshot.' }, 400, origin);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: assistantPrompt(question, payload.snapshot) }] }],
            generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
          }),
        },
      );
      if (!response.ok) {
        console.error('Gemini error', response.status, await response.text());
        return json({ error: 'Assistant provider is unavailable.' }, 502, origin);
      }
      const result = await response.json();
      const answer = result.candidates?.[0]?.content?.parts
        ?.filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (!answer) return json({ error: 'Assistant provider returned no text.' }, 502, origin);
      return json({ answer }, 200, origin);
    }

    return json({ error: 'Not found.' }, 404, origin);
  },
};