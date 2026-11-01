import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchWebpageTool, HttpRequestTool, WebSearchTool, __webToolTestUtils } from './web';

describe('web tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('在 DuckDuckGo 不可达时回退到 Bing', async () => {
    const timeoutError = new TypeError('fetch failed') as TypeError & {
      cause?: { code: string };
    };
    timeoutError.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <ol id="b_results">
            <li class="b_algo">
              <h2><a href="https://example.com/a">Result A</a></h2>
              <div class="b_caption"><p>Snippet A</p></div>
            </li>
          </ol>
        `
      } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await WebSearchTool.execute({
      query: 'test',
      __allowedSearchProviders: ['duckduckgo', 'bing']
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        source: 'bing',
        provider: 'Bing',
        results: [
          {
            title: 'Result A',
            url: 'https://example.com/a',
            snippet: 'Snippet A'
          }
        ]
      }
    });
  });

  it('仅在允许的搜索源内执行回退', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://example.com/b">Result B</a></h2>
            <div class="b_caption"><p>Snippet B</p></div>
          </li>
        </ol>
      `
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await WebSearchTool.execute({
      query: 'test',
      __allowedSearchProviders: ['bing']
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://cn.bing.com/search?q=');
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        source: 'bing'
      }
    });
  });

  it('同一 provider 的首个查询地址无结果时继续尝试备用地址', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>no results</body></html>'
      } satisfies Partial<Response>)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <ol id="b_results">
            <li class="b_algo">
              <h2><a href="https://example.com/fallback">Fallback Result</a></h2>
              <div class="b_caption"><p>Fallback Snippet</p></div>
            </li>
          </ol>
        `
      } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await WebSearchTool.execute({
      query: 'test',
      __allowedSearchProviders: ['bing']
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        source: 'bing',
        provider: 'Bing',
        results: [
          {
            title: 'Fallback Result',
            url: 'https://example.com/fallback',
            snippet: 'Fallback Snippet'
          }
        ]
      }
    });
  });

  it('能解析 Bing HTML 结果', () => {
    const results = __webToolTestUtils.parseBingHtmlResults(`
      <ol id="b_results">
        <li class="b_algo">
          <h2 class=""><a href="https://example.com/c">Result C</a></h2>
          <div class="b_caption"><p>Snippet C</p></div>
        </li>
      </ol>
    `, 5);

    expect(results).toEqual([
      {
        title: 'Result C',
        url: 'https://example.com/c',
        snippet: 'Snippet C'
      }
    ]);
  });

  it('中文查询时优先使用可用的百度查询地址', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="result">
          <h3><a href="https://example.com/d">Result D</a></h3>
          <div class="c-abstract">Snippet D</div>
        </div>
      `
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await WebSearchTool.execute({
      query: 'openai',
      lr: 'lang_zh',
      __allowedSearchProviders: ['baidu']
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('http://www.baidu.com/s?wd=');
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        source: 'baidu',
        provider: 'Baidu',
        results: [
          {
            title: 'Result D',
            url: 'https://example.com/d',
            snippet: 'Snippet D'
          }
        ]
      }
    });
  });

  it('Bing 无可解析结果且其他 provider 也失败时，web_search 返回失败而不是空成功', async () => {
    const timeoutError = new TypeError('fetch failed');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>no results</body></html>'
      } satisfies Partial<Response>)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>no results</body></html>'
      } satisfies Partial<Response>)
      .mockRejectedValueOnce(timeoutError);

    vi.stubGlobal('fetch', fetchMock);

    const result = await WebSearchTool.execute({
      query: 'test',
      __allowedSearchProviders: ['bing', 'duckduckgo']
    });

    expect(result).toMatchObject({
      __toolResult: true,
      ok: false
    });
  });

  it('能通过 http_request 解析 JSON 响应', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json'
      }),
      text: async () => JSON.stringify({ ok: true, source: 'api' })
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await HttpRequestTool.execute({
      url: 'https://example.com/api',
      method: 'GET'
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        url: 'https://example.com/api',
        method: 'GET',
        status: 200,
        data: {
          ok: true,
          source: 'api'
        }
      }
    });
  });

  it('能通过 http_request 发送 JSON 请求体', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({
        'content-type': 'application/json'
      }),
      text: async () => JSON.stringify({ created: true })
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await HttpRequestTool.execute({
      url: 'https://example.com/items',
      method: 'POST',
      json: {
        name: 'demo'
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'demo' })
    });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json'
    });
    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        status: 201,
        data: {
          created: true
        }
      }
    });
  });

  it('能通过 http_request 返回裁剪后的文本响应', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'text/plain'
      }),
      text: async () => 'abcdefghijklmnopqrstuvwxyz'
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await HttpRequestTool.execute({
      url: 'https://example.com/text',
      maxLength: 12
    });

    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        contentType: 'text/plain',
        length: 26
      }
    });
    expect((result as { data?: { text?: string } }).data?.text).toContain('[Content truncated]');
  });

  it('对 HEAD 请求返回响应头元数据', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers({
        'content-type': 'text/plain',
        'x-test': 'yes'
      })
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await HttpRequestTool.execute({
      url: 'https://example.com/health',
      method: 'HEAD'
    });

    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        method: 'HEAD',
        status: 204,
        headers: {
          'x-test': 'yes'
        }
      }
    });
  });

  it('fetch_webpage 仍然返回抽取后的正文文本', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><head><title>Hello</title><meta name="description" content="Greeting page" /></head><body><main><h1>Hello</h1><p>world</p></main></body></html>'
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await FetchWebpageTool.execute({
      url: 'https://example.com/page'
    });

    expect(result).toMatchObject({
      __toolResult: true,
      ok: true,
      data: {
        url: 'https://example.com/page',
        content: 'Hello Greeting page Hello world'
      }
    });
  });

  it('fetch_webpage 遇到验证页时返回失败', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><head><title>百度安全验证</title></head><body>百度安全验证</body></html>'
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const result = await FetchWebpageTool.execute({
      url: 'https://example.com/page'
    });

    expect(result).toMatchObject({
      __toolResult: true,
      ok: false
    });
  });
});
