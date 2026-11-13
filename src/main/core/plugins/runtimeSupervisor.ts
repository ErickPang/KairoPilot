import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { terminateProcessTree } from '../tools/processTree';

/** Process ownership is independent of the MCP protocol and its cancellation notifications. */
export class LocalMcpTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = new ReadBuffer({ maxBufferSize: 1024 * 1024 });
  private closing?: Promise<void>;
  private closed = false;
  private notifyClosed() { if (!this.closed) { this.closed = true; this.onclose?.(); } }
  constructor(private command: string, private args: string[], private cwd: string, private env: Record<string, string>) {}
  async start() {
    if (this.child) throw new Error('MCP process already started.');
    const child = spawn(this.command, this.args, { cwd: this.cwd, env: this.env as NodeJS.ProcessEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stderr.resume(); // Never forward untrusted stderr or credentials to the application log.
    child.on('error', error => this.onerror?.(error));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', error => this.onerror?.(error));
    child.once('exit', () => { void this.close().catch(error => this.onerror?.(error)); });
    child.stdout.on('data', (data: Buffer) => {
      try { this.buffer.append(data); for (;;) { const message = this.buffer.readMessage(); if (!message) break; this.onmessage?.(message); } }
      catch { this.onerror?.(new Error('Invalid MCP stdout message.')); void this.close().catch(() => {}); }
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  }
  async send(message: JSONRPCMessage) {
    if (!this.child || this.closing) throw new Error('MCP process is not connected.');
    const text = serializeMessage(message);
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('MCP request exceeds 1 MiB.');
    await new Promise<void>((resolve, reject) => this.child!.stdin.write(text, error => error ? reject(error) : resolve()));
  }
  close() {
    if (!this.closing) this.closing = (async () => {
      try { if (this.child) await terminateProcessTree(this.child); }
      finally {
        this.child?.stdin.destroy(); this.child?.stdout.destroy(); this.child?.stderr.destroy();
        this.buffer.clear(); this.notifyClosed();
      }
    })();
    return this.closing;
  }
}

export function localMcpEnvironment() {
  // Deliberately exclude HOME, shell startup variables, NODE_OPTIONS, and parent credentials.
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG']) if (process.env[name]) env[name] = process.env[name]!;
  return env;
}
