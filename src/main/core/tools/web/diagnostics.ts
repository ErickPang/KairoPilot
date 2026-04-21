import type { SearchDiagnostic, SearchDiagnosticCategory, SearchProvider, SearchProviderFailure } from './types';

export function classifyNetworkError(error: unknown, targetUrl: string) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerCaseMessage = errorMessage.toLowerCase();

  if (lowerCaseMessage.includes('timed out') || lowerCaseMessage.includes('timeout')) {
    return `Request to ${targetUrl} timed out. The remote site may be slow or unreachable.`;
  }
  if (lowerCaseMessage.includes('fetch failed')) {
    return `Request to ${targetUrl} failed before receiving a response. Check local network, DNS, proxy, or remote site availability.`;
  }
  if (lowerCaseMessage.includes('certificate') || lowerCaseMessage.includes('tls')) {
    return `TLS handshake failed while requesting ${targetUrl}. Check system certificates, HTTPS interception, or the remote certificate.`;
  }

  return `Request to ${targetUrl} failed: ${errorMessage}`;
}

export function classifyNetworkErrorCategory(error: unknown): SearchDiagnosticCategory {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerCaseMessage = errorMessage.toLowerCase();

  if (lowerCaseMessage.includes('timed out') || lowerCaseMessage.includes('timeout')) {
    return 'network';
  }
  if (lowerCaseMessage.includes('fetch failed') || lowerCaseMessage.includes('dns')) {
    return 'network';
  }
  if (lowerCaseMessage.includes('http ')) {
    return 'http';
  }
  if (lowerCaseMessage.includes('certificate') || lowerCaseMessage.includes('tls')) {
    return 'network';
  }

  return 'network';
}

export function toSearchDiagnostic(provider: SearchProvider, failure: SearchProviderFailure): SearchDiagnostic {
  return {
    source: provider.id,
    provider: provider.label,
    providerKind: provider.kind,
    url: failure.searchUrl,
    reason: failure.reason,
    category: failure.category,
    retryable: failure.retryable
  };
}
