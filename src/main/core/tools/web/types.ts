export type SearchProviderKind = 'api' | 'html';

export type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

export type SearchDiagnosticCategory = 'network' | 'http' | 'parse' | 'empty' | 'config';

export type SearchDiagnostic = {
  source: string;
  provider: string;
  providerKind: SearchProviderKind;
  url: string;
  reason: string;
  category: SearchDiagnosticCategory;
  retryable: boolean;
};

export type SearchQueryInput = {
  query: string;
  maxResults: number;
  languageHint: string;
  timeoutMs: number;
};

export type SearchProviderSuccess = {
  ok: true;
  providerId: string;
  providerLabel: string;
  providerKind: SearchProviderKind;
  results: SearchResultItem[];
  searchUrl: string;
};

export type SearchProviderFailure = {
  ok: false;
  providerId: string;
  providerLabel: string;
  providerKind: SearchProviderKind;
  searchUrl: string;
  reason: string;
  category: SearchDiagnosticCategory;
  retryable: boolean;
};

export type SearchProviderResult = SearchProviderSuccess | SearchProviderFailure;

export interface SearchProvider {
  id: string;
  label: string;
  kind: SearchProviderKind;
  permissionUrls: string[];
  search: (input: SearchQueryInput) => Promise<SearchProviderResult>;
}

export type SearchRouterSuccess = {
  ok: true;
  results: SearchResultItem[];
  source: string;
  provider: string;
  providerKind: SearchProviderKind;
  searchUrl: string;
  diagnostics: SearchDiagnostic[];
};

export type SearchRouterFailure = {
  ok: false;
  reason: string;
  diagnostics: SearchDiagnostic[];
};

export type SearchRouterResult = SearchRouterSuccess | SearchRouterFailure;
