import http from 'node:http';
import { PermissionGuard } from '../src/main/core/security/permissions';
import { createPermissionGuardedTool } from '../src/main/core/agent/toolPipeline';
import { FetchWebpageTool } from '../src/main/core/tools/web';
import { createDefaultAgentPermissions, createDefaultPolicyConfig } from '../src/shared/contracts';

export async function verifyWebBoundaries(assert: (ok: unknown, label: string) => void) {
  let blockedRequests = 0;
  let allowRedirect = false;
  const server = http.createServer((request, response) => {
    if (request.url === '/allowed/start') {
      response.writeHead(302, {Location: allowRedirect ? '/allowed/page' : '/blocked'});
      response.end();
    } else {
      if (request.url === '/blocked') blockedRequests += 1;
      response.end('<main>Synthetic readable page for guarded redirect verification.</main>');
    }
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  try {
    const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const guard = new PermissionGuard({...createDefaultAgentPermissions(),executionProfile:'approved_execution',policy:{...createDefaultPolicyConfig('approved_execution'),approvalMode:'never'},network:{enabled:true,allowedDomains:[`${base}/allowed/`]}});
    const tool = createPermissionGuardedTool(FetchWebpageTool, guard);
    const denied = await tool.execute({url:`${base}/allowed/start`}) as {ok:boolean};
    assert(!denied.ok && blockedRequests === 0, 'Web: guarded fetch never contacts a disallowed redirect target');
    allowRedirect = true;
    const permitted = await tool.execute({url:`${base}/allowed/start`}) as {ok:boolean};
    assert(permitted.ok, 'Web: allowed relative redirects preserve normal webpage reading');
    allowRedirect = false;
    const approved = await tool.executeApproved({url:`${base}/allowed/start`}) as {ok:boolean};
    assert(!approved.ok && blockedRequests === 0, 'Web: approval cannot bypass redirect target permissions');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
