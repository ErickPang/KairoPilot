import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function isPathInsideRoot(filePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolvePathForContainment(targetPath: string) {
  const absolutePath = path.resolve(targetPath);
  const missingSegments: string[] = [];
  let currentPath = absolutePath;

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    missingSegments.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  try {
    if (fs.existsSync(currentPath)) {
      const resolvedExistingPath = fs.realpathSync(currentPath);
      return missingSegments.length > 0
        ? path.join(resolvedExistingPath, ...missingSegments)
        : resolvedExistingPath;
    }
  } catch {
    return absolutePath;
  }

  return absolutePath;
}

export function resolveKairopilotFilePath(requestUrl: string, allowedProtocolRoots: string[]) {
  const rawPath = requestUrl.slice('kairopilot://'.length);
  const decodedPath = decodeURIComponent(rawPath);
  const normalizedPath = resolvePathForContainment(decodedPath);

  try {
    const stats = fs.statSync(normalizedPath);
    if (!stats.isFile()) {
      return null;
    }

    const realFilePath = fs.realpathSync(normalizedPath);
    const normalizedRoots = allowedProtocolRoots.map((root) => resolvePathForContainment(root));

    if (!normalizedRoots.some((root) => isPathInsideRoot(realFilePath, root))) {
      return null;
    }

    return realFilePath;
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
