'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

function cuaError(message, code, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

/** One owned Windows Cua Driver runtime, speaking newline-delimited stdio MCP. */
class CuaClient {
  constructor({ executable = path.join(__dirname, 'vendor', 'cua-driver', 'cua-driver.exe'), spawnImpl = spawn, timeoutMs = 30000 } = {}) {
    if (typeof executable !== 'string' || !executable) throw new TypeError('A Cua Driver executable is required.');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive.');
    this.executable = executable;
    this._spawn = spawnImpl;
    this._timeoutMs = timeoutMs;
    this._connection = null;
    this._connectPromise = null;
    this._serverVersion = null;
    this._nextConnectionId = 0;
  }

  get running() { return Boolean(this._connection?.ready && !this._connection.closed); }
  get version() { return this._serverVersion; }
  get connectionId() { return this._connection?.id ?? null; }

  async connect() {
    if (this.running) return this;
    if (this._connectPromise) return this._connectPromise;
    const attempt = this._open();
    this._connectPromise = attempt;
    try { return await attempt; }
    finally { if (this._connectPromise === attempt) this._connectPromise = null; }
  }

  async _open() {
    const connection = { id: ++this._nextConnectionId, child: null, ready: false, closed: false, pending: new Map(), nextId: 1, buffer: '', decoder: new StringDecoder('utf8'), stderr: '' };
    this._connection = connection;
    try {
      const child = this._spawn(this.executable, ['mcp'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      connection.child = child;
      if (!child.stdin || !child.stdout || !child.stderr) throw new Error('Driver process has no stdio pipes.');
      child.on('error', error => this._fail(connection, cuaError(`Could not start Cua Driver: ${error.message}`, 'CUA_START_FAILED')));
      child.on('exit', (code, signal) => this._fail(connection, cuaError(`Cua Driver exited (${signal || code || 0}).`, 'CUA_EXITED', connection.stderr)));
      child.stdout.on('data', chunk => this._receive(connection, chunk));
      child.stdout.on('error', error => this._fail(connection, cuaError(`Cua Driver output failed: ${error.message}`, 'CUA_IO_ERROR')));
      child.stdin.on('error', error => this._fail(connection, cuaError(`Cua Driver input failed: ${error.message}`, 'CUA_IO_ERROR')));
      child.stderr.on('data', chunk => {
        connection.stderr = (connection.stderr + chunk.toString()).slice(-MAX_STDERR_BYTES);
      });
      child.stderr.on('error', () => {});
      const result = await this._request(connection, 'initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pixie', version: '1.0.0' }
      });
      if (!result || result.protocolVersion !== '2025-06-18' || !result.capabilities?.tools) {
        throw cuaError('Cua Driver returned an unsupported MCP handshake.', 'CUA_PROTOCOL_ERROR');
      }
      this._write(connection, { jsonrpc: '2.0', method: 'notifications/initialized' });
      if (connection.closed) throw cuaError('Cua Driver stopped during initialization.', 'CUA_STOPPED');
      this._serverVersion = typeof result.serverInfo?.version === 'string' ? result.serverInfo.version : null;
      connection.ready = true;
      return this;
    } catch (error) {
      this._fail(connection, error.code ? error : cuaError(`Could not start Cua Driver: ${error.message}`, 'CUA_START_FAILED'));
      throw error;
    }
  }

  _write(connection, message) {
    if (connection.closed || !connection.child?.stdin?.writable) throw cuaError('Cua Driver is not connected.', 'CUA_STOPPED');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw cuaError('Cua Driver request is too large.', 'CUA_MESSAGE_TOO_LARGE');
    connection.child.stdin.write(line, error => {
      if (error) this._fail(connection, cuaError(`Cua Driver input failed: ${error.message}`, 'CUA_IO_ERROR'));
    });
  }

  _request(connection, method, params) {
    return new Promise((resolve, reject) => {
      if (!connection || connection.closed) return reject(cuaError('Cua Driver is not connected.', 'CUA_STOPPED'));
      const id = connection.nextId++;
      const timer = setTimeout(() => {
        // An action may already have reached the OS. Kill this runtime and never retry it here.
        this._fail(connection, cuaError(`Cua Driver timed out during ${method}; inspect the app before retrying.`, 'CUA_TIMEOUT'));
      }, this._timeoutMs);
      connection.pending.set(id, { resolve, reject, timer });
      try { this._write(connection, { jsonrpc: '2.0', id, method, params }); }
      catch (error) { this._fail(connection, error); }
    });
  }

  _receive(connection, chunk) {
    if (connection.closed) return;
    connection.buffer += connection.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let newline;
    while ((newline = connection.buffer.indexOf('\n')) !== -1) {
      const line = connection.buffer.slice(0, newline).trim();
      connection.buffer = connection.buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
        return this._fail(connection, cuaError('Cua Driver response exceeded the size limit.', 'CUA_MESSAGE_TOO_LARGE'));
      }
      let message;
      try { message = JSON.parse(line); }
      catch { return this._fail(connection, cuaError('Cua Driver sent invalid JSON.', 'CUA_PROTOCOL_ERROR')); }
      if (!message || message.jsonrpc !== '2.0' || Array.isArray(message)) {
        return this._fail(connection, cuaError('Cua Driver sent an invalid JSON-RPC message.', 'CUA_PROTOCOL_ERROR'));
      }
      if (typeof message.method === 'string') {
        // Notifications need no reply. This client exposes no server-initiated capabilities.
        if (message.id !== undefined) {
          try { this._write(connection, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method not supported' } }); }
          catch (error) { this._fail(connection, error); }
        }
        continue;
      }
      const pending = connection.pending.get(message.id);
      if (!pending) continue;
      connection.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(cuaError(message.error.message || 'Cua Driver rejected the request.', 'CUA_RPC_ERROR', message.error));
      else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
      else {
        const error = cuaError('Cua Driver response has no result or error.', 'CUA_PROTOCOL_ERROR');
        pending.reject(error);
        this._fail(connection, error);
        return;
      }
      if (connection.closed) return;
    }
    if (Buffer.byteLength(connection.buffer) > MAX_MESSAGE_BYTES) {
      this._fail(connection, cuaError('Cua Driver response exceeded the size limit.', 'CUA_MESSAGE_TOO_LARGE'));
    }
  }

  _fail(connection, error) {
    if (connection.closed) return;
    connection.closed = true;
    connection.ready = false;
    connection.buffer = '';
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    connection.pending.clear();
    if (this._connection === connection) this._connection = null;
    try { connection.child?.stdin?.end(); } catch {}
    // Own only this process; never stop another Cua daemon or user application.
    try { connection.child?.kill(); } catch {}
  }

  async listTools() {
    await this.connect();
    const connection = this._connection;
    const tools = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 64; page++) {
      const result = await this._request(connection, 'tools/list', cursor ? { cursor } : {});
      if (!result || !Array.isArray(result.tools)) throw cuaError('Cua Driver returned an invalid tool list.', 'CUA_PROTOCOL_ERROR');
      tools.push(...result.tools);
      if (!result.nextCursor) return tools;
      cursor = result.nextCursor;
      if (typeof cursor !== 'string' || seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw cuaError('Cua Driver tool pagination exceeded its limit.', 'CUA_PROTOCOL_ERROR');
  }

  async call(name, args = {}) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) throw new TypeError('Invalid Cua tool name.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool arguments must be an object.');
    await this.connect();
    return this._request(this._connection, 'tools/call', { name, arguments: args });
  }

  async stop() {
    const connection = this._connection;
    if (connection) this._fail(connection, cuaError('Computer use was stopped.', 'CUA_STOPPED'));
    // Await initialization's rejection so a subsequent connect cannot reuse its stale promise.
    if (this._connectPromise) await this._connectPromise.catch(() => {});
  }
}

module.exports = { CuaClient, MAX_MESSAGE_BYTES };
