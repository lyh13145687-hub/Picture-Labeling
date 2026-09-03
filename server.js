#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = process.env.MODEL_ROUTER_UPSTREAM || '';
const DEFAULT_MODEL = process.env.MODEL_ROUTER_MODEL || 'standard';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function buildUpstreamBody(parsed) {
  if (Array.isArray(parsed.messages)) {
    return {
      model: parsed.model || DEFAULT_MODEL,
      messages: parsed.messages,
      temperature: parsed.temperature ?? 0.2,
      ...(parsed.max_tokens ? { max_tokens: parsed.max_tokens } : {}),
    };
  }

  const contextJson = JSON.stringify(parsed.context ?? {});
  const userContent = parsed.prompt
    ? `${parsed.prompt}\n\n以下是附带的验收 JSON 数据：\n${contextJson}`
    : contextJson;

  return {
    model: parsed.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: parsed.system || 'You are a helpful assistant.' },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    ...(parsed.max_tokens ? { max_tokens: parsed.max_tokens } : {}),
  };
}

async function handleAgentReport(req, res) {
  let parsed;
  try {
    const raw = await readBody(req);
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: '请求体必须是合法 JSON' });
  }

  if (!UPSTREAM) {
    return sendJson(res, 503, {
      error: '未配置上游 LLM。请设置环境变量 MODEL_ROUTER_UPSTREAM，或在页面 API 里填写可直连的 OpenAI 兼容地址。',
    });
  }

  const upstreamBody = buildUpstreamBody(parsed);
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    return sendJson(res, 502, {
      error: '无法连接上游 LLM',
      detail: String(error?.message || error),
      upstream: UPSTREAM,
    });
  }

  const text = await upstream.text();
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
  });
  res.end(text);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safePath === '/' ? 'index.html' : safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      proxy: '/api/agent/report',
      upstream: UPSTREAM,
      model: DEFAULT_MODEL,
    });
  }

  if (req.method === 'POST' && req.url === '/api/agent/report') {
    return handleAgentReport(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`pic-labeling 运行于 http://localhost:${PORT}`);
  console.log(
    UPSTREAM
      ? `LLM 同域代理: POST /api/agent/report -> ${UPSTREAM}`
      : 'LLM 同域代理未配置（设置 MODEL_ROUTER_UPSTREAM 后可用 /api/agent/report）',
  );
});
