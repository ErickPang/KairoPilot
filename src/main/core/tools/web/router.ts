import { toSearchDiagnostic } from './diagnostics';
import type { SearchDiagnostic, SearchProvider, SearchProviderKind, SearchRouterResult } from './types';
import type { WebSearchProviderId } from '../../../../shared/contracts';

function hasChineseLanguageHint(languageHint: string) {
  return /(?:^|[_-])zh(?:$|[_-])/i.test(languageHint);
}

function containsCjkCharacters(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

export function prioritizeSearchProviders(
  providers: SearchProvider[],
  query: string,
  languageHint: string,
  preferredProviderIds: WebSearchProviderId[] = []
) {
  const fallbackPreference = hasChineseLanguageHint(languageHint) || containsCjkCharacters(query)
    ? ['baidu', 'bing', 'duckduckgo']
    : ['bing', 'duckduckgo', 'baidu'];
  const normalizedPreference = [...preferredProviderIds, ...fallbackPreference]
    .filter((id, index, values) => values.indexOf(id) === index);
  const rank = new Map(normalizedPreference.map((id, index) => [id, index]));

  return providers
    .slice()
    .sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

export function resolveAllowedSearchProviders(providers: SearchProvider[], allowedProviderIds: unknown) {
  const normalizedIds = Array.isArray(allowedProviderIds)
    ? allowedProviderIds
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    : [];

  if (normalizedIds.length === 0) {
    return providers;
  }

  const allowedIdSet = new Set(normalizedIds);
  return providers.filter((provider) => allowedIdSet.has(provider.id));
}

type SearchRouterInput = {
  query: string;
  maxResults: number;
  languageHint: string;
  timeoutMs: number;
  providers: SearchProvider[];
  allowedProviderIds?: unknown;
  preferredProviderIds?: WebSearchProviderId[];
};

export async function runSearchRouter(input: SearchRouterInput): Promise<SearchRouterResult> {
  const eligibleProviders = prioritizeSearchProviders(
    resolveAllowedSearchProviders(input.providers, input.allowedProviderIds),
    input.query,
    input.languageHint,
    input.preferredProviderIds
  );
  const diagnostics: SearchDiagnostic[] = [];
  let lastSuccessfulAttempt: { source: string; provider: string; providerKind: SearchProviderKind; searchUrl: string } | null = null;

  for (const provider of eligibleProviders) {
    const result = await provider.search({
      query: input.query,
      maxResults: input.maxResults,
      languageHint: input.languageHint,
      timeoutMs: input.timeoutMs
    });

    if (result.ok) {
      lastSuccessfulAttempt = {
        source: result.providerId,
        provider: result.providerLabel,
        providerKind: result.providerKind,
        searchUrl: result.searchUrl
      };

      if (result.results.length > 0) {
        return {
          ok: true,
          results: result.results,
          source: result.providerId,
          provider: result.providerLabel,
          providerKind: result.providerKind,
          searchUrl: result.searchUrl,
          diagnostics
        };
      }

      diagnostics.push({
        source: provider.id,
        provider: provider.label,
        providerKind: provider.kind,
        url: result.searchUrl,
        reason: `${provider.label} returned a page but no parsable results were found.`,
        category: 'empty' as const,
        retryable: true
      });
      continue;
    }

    diagnostics.push(toSearchDiagnostic(provider, result));
  }

  if (lastSuccessfulAttempt) {
    return {
      ok: true,
      results: [],
      source: lastSuccessfulAttempt.source,
      provider: lastSuccessfulAttempt.provider,
      providerKind: lastSuccessfulAttempt.providerKind,
      searchUrl: lastSuccessfulAttempt.searchUrl,
      diagnostics
    };
  }

  return {
    ok: false,
    reason: diagnostics[0]?.reason || 'No reachable search provider responded.',
    diagnostics
  };
}
