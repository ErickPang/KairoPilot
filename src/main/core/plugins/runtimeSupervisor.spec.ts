import { expect, it, vi } from 'vitest';
import os from 'node:os';
import { LocalMcpTransport, localMcpEnvironment } from './runtimeSupervisor';

it('reports a closed stdin as a transport error without crashing the host and closes exactly once', async () => {
  const transport = new LocalMcpTransport(process.execPath, ['-e', `require('node:fs').closeSync(0);process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'fixture/ready'})+'\\n');setInterval(()=>{},1000);`], os.tmpdir(), localMcpEnvironment());
  const message = vi.fn(), error = vi.fn(), close = vi.fn();
  transport.onmessage = message; transport.onerror = error; transport.onclose = close;
  try {
    await transport.start(); await vi.waitFor(() => expect(message).toHaveBeenCalled());
    await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' })).rejects.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    await transport.close(); await transport.close(); expect(close).toHaveBeenCalledTimes(1);
  } finally { await transport.close(); }
});
