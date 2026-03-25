import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function isPathInsideRoot(filePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function resolveKairopilotFilePath(requestUrl: string, allowedProtocolRoots: string[]) {
  const rawPath = requestUrl.slice('kairopilot://'.length);
  const decodedPath = decodeURIComponent(rawPath);
  const normalizedPath = path.resolve(decodedPath);

  if (!allowedProtocolRoots.some((root) => isPathInsideRoot(normalizedPath, root))) {
    return null;
  }

  try {
    const stats = fs.statSync(normalizedPath);
    if (!stats.isFile()) {
      return null;
    }
    return normalizedPath;
  } catch {
    return null;
  }
}

export function registerKairopilotProtocol(allowedProtocolRoots: string[]) {
  protocol.handle('kairopilot', (request) => {
    const resolvedPath = resolveKairopilotFilePath(request.url, allowedProtocolRoots);
    if (!resolvedPath) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(resolvedPath).toString());
  });
}
