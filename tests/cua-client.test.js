'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CuaClient, MAX_MESSAGE_BYTES } = require('../cua-client');

function fakeDriver(onRequest = () => {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.requests = [];
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); return true; };
  child.reply = (id, result) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  child.reject = (id, error) => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error }) + '\n');
  let buffer = '';
  child.stdin.on('data', chunk => {
    buffer += chunk.toString();
    let position;
    while ((position = buffer.indexOf('\n')) !== -1) {
      const request = JSON.parse(buffer.slice(0, position));
      buffer = buffer.slice(position + 1);
      child.requests.push(request);
      if (request.method === 'initialize') {
        queueMicrotask(() => child.reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cua-driver', version: '0.41.0' } }));
      } else onRequest(request, child);
    }
  });
  return child;
}

test('one lazy MCP handshake serves concurrent calls and preserves raw tool results', async () => {
  let spawns = 0;
  const result = { content: [{ type: 'text', text: 'مرحبا' }], structuredContent: { apps: [] }, isError: false };
  const child = fakeDriver((request, process) => {
    if (request.method === 'tools/list') process.reply(request.id, { tools: [{ name: 'list_apps', inputSchema: { type: 'object' } }] });
    if (request.method === 'tools/call') process.reply(request.id, result);
  });
  const client = new CuaClient({ executable: 'C:\\test driver\\cua-driver.exe', spawnImpl: (exe, args, options) => {
    spawns++;
    assert.equal(exe, 'C:\\test driver\\cua-driver.exe');
    assert.deepEqual(args, ['mcp']);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    return child;
  } });
  assert.equal(client.running, false);
  const [tools, response] = await Promise.all([client.listTools(), client.call('list_apps', { session: 'pixie' })]);
  assert.equal(spawns, 1);
  assert.equal(child.requests.filter(x => x.method === 'initialize').length, 1);
  assert.equal(child.requests[1].method, 'notifications/initialized');
  assert.deepEqual(tools.map(x => x.name), ['list_apps']);
  assert.deepEqual(response, result);
  assert.equal(client.running, true);
  assert.equal(client.version, '0.41.0');
  await client.stop();
  assert.equal(client.running, false);
  assert.equal(child.killed, true);
});

test('reads all tools pages and rejects a repeated cursor', async () => {
  const child = fakeDriver((request, process) => {
    if (request.method === 'tools/list') process.reply(request.id, { tools: [{ name: 'list_apps' }], nextCursor: 'loop' });
  });
  const client = new CuaClient({ spawnImpl: () => child });
  await assert.rejects(client.listTools(), { code: 'CUA_PROTOCOL_ERROR' });
  await client.stop();
});

test('JSON-RPC errors reject one request; MCP isError remains a raw result', async () => {
  const child = fakeDriver((request, process) => {
    if (request.method === 'tools/call' && request.params.name === 'bad') process.reject(request.id, { code: -32602, message: 'bad arguments' });
    else if (request.method === 'tools/call') process.reply(request.id, { isError: true, content: [{ type: 'text', text: 'background_unavailable' }] });
  });
  const client = new CuaClient({ spawnImpl: () => child });
  await assert.rejects(client.call('bad'), { code: 'CUA_RPC_ERROR', message: 'bad arguments' });
  assert.equal((await client.call('click')).isError, true);
  assert.equal(client.running, true);
  await client.stop();
});

test('asynchronous process startup error rejects initialization', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const client = new CuaClient({ spawnImpl: () => { queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child; } });
  await assert.rejects(client.connect(), { code: 'CUA_START_FAILED' });
  assert.equal(client.running, false);
});

test('timeout kills only the owned process and never retries a mutation', async () => {
  let spawns = 0;
  const child = fakeDriver();
  const client = new CuaClient({ spawnImpl: () => { spawns++; return child; }, timeoutMs: 20 });
  await assert.rejects(client.call('click', { element_token: 's1:1' }), { code: 'CUA_TIMEOUT' });
  assert.equal(spawns, 1);
  assert.equal(child.requests.filter(x => x.method === 'tools/call').length, 1);
  assert.equal(child.killed, true);
  assert.equal(client.running, false);
});

test('stop rejects pending calls and permits an explicit new connection', async () => {
  const children = [];
  const client = new CuaClient({ spawnImpl: () => { const child = fakeDriver(); children.push(child); return child; } });
  await client.connect();
  const pending = client.call('click');
  const rejected = assert.rejects(pending, { code: 'CUA_STOPPED' });
  await new Promise(resolve => setImmediate(resolve));
  await client.stop();
  await rejected;
  await client.connect();
  assert.equal(children.length, 2);
  assert.equal(client.running, true);
  await client.stop();
});

test('process exit rejects all pending calls', async () => {
  const child = fakeDriver();
  const client = new CuaClient({ spawnImpl: () => child });
  await client.connect();
  const result = assert.rejects(client.call('click'), { code: 'CUA_EXITED' });
  await new Promise(resolve => setImmediate(resolve));
  child.emit('exit', 42, null);
  await result;
  assert.equal(client.running, false);
});

test('malformed and oversized responses shut down the transport', async t => {
  for (const [data, code] of [['not json\n', 'CUA_PROTOCOL_ERROR'], ['x'.repeat(MAX_MESSAGE_BYTES + 1), 'CUA_MESSAGE_TOO_LARGE']]) {
    await t.test(code, async () => {
      const child = fakeDriver();
      const client = new CuaClient({ spawnImpl: () => child });
      await client.connect();
      const result = assert.rejects(client.call('list_apps'), { code });
      await new Promise(resolve => setImmediate(resolve));
      child.stdout.write(data);
      await result;
      assert.equal(child.killed, true);
    });
  }
});

test('invalid input is rejected without spawning a driver', async () => {
  const client = new CuaClient({ spawnImpl: () => { throw new Error('must not spawn'); } });
  await assert.rejects(client.call('bad name'), TypeError);
  await assert.rejects(client.call('click', []), TypeError);
});

test('chunked UTF-8 and multiple response frames are decoded without corruption', async () => {
  const child = fakeDriver((request, process) => {
    if (request.method !== 'tools/call') return;
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'مرحبا 🌟' }] } }) + '\n');
    for (let index = 0; index < bytes.length; index++) process.stdout.write(bytes.subarray(index, index + 1));
  });
  const client = new CuaClient({ spawnImpl: () => child });
  assert.equal((await client.call('list_apps')).content[0].text, 'مرحبا 🌟');
  await client.stop();
});

test('stop during initialization rejects promptly instead of waiting for timeout', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const client = new CuaClient({ spawnImpl: () => child, timeoutMs: 10000 });
  const rejected = assert.rejects(client.connect(), { code: 'CUA_STOPPED' });
  await client.stop();
  await rejected;
  assert.equal(client.running, false);
});
