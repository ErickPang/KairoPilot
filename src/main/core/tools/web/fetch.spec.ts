import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl, withWebRequestPolicy } from './fetch';

const allowExample = (url: string) => new URL(url).hostname === 'example.com';
const redirect = (location: string, status = 302) => new Response(null, {status, headers: {location}});

afterEach(() => vi.unstubAllGlobals());

describe('web request boundaries', () => {
  it('blocks a redirect before contacting a disallowed target', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('https://blocked.test/private'));
    vi.stubGlobal('fetch', fetch);
    await expect(withWebRequestPolicy(allowExample, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000}))).rejects.toThrow('Permission Denied');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  });

  it('rechecks URL prefixes on same-origin redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('/private'));
    vi.stubGlobal('fetch', fetch);
    await expect(withWebRequestPolicy(url => url.startsWith('https://example.com/public/'), undefined, () => requestUrl('https://example.com/public/start', {timeoutMs:1000}))).rejects.toThrow('Permission Denied');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('follows relative redirects within the allowed boundary', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('/next')).mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    const result = await withWebRequestPolicy(allowExample, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000}));
    expect(await result.text()).toBe('ok');
    expect(fetch.mock.calls[1][0]).toBe('https://example.com/next');
  });

  it('blocks HTTPS downgrades even if both URLs are allowed', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('http://example.com/next'));
    vi.stubGlobal('fetch', fetch);
    await expect(withWebRequestPolicy(allowExample, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000}))).rejects.toThrow('HTTPS downgrade');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('strips credentials before an allowed cross-origin GET', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('https://other.test/next')).mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    await withWebRequestPolicy(() => true, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000,headers:{Authorization:'synthetic',Cookie:'synthetic','Proxy-Authorization':'synthetic','PRIVATE-TOKEN':'synthetic','X-Api-Key':'synthetic'}}));
    const headers = fetch.mock.calls[1][1].headers;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('Cookie');
    expect(headers).not.toHaveProperty('Proxy-Authorization');
    expect(headers).not.toHaveProperty('PRIVATE-TOKEN');
    expect(headers).not.toHaveProperty('X-Api-Key');
  });

  it('does not forward a write body to another origin', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('https://other.test/next', 307));
    vi.stubGlobal('fetch', fetch);
    await expect(withWebRequestPolicy(() => true, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000,method:'POST',body:'synthetic private data'}))).rejects.toThrow('write request');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the method and body for an allowed same-origin 307', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('/next',307)).mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    await withWebRequestPolicy(allowExample, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000,method:'POST',body:'synthetic'}));
    expect(fetch.mock.calls[1][1]).toMatchObject({method:'POST',body:'synthetic'});
  });

  it('limits redirect loops', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(redirect('/again')));
    vi.stubGlobal('fetch', fetch);
    await expect(withWebRequestPolicy(allowExample, undefined, () => requestUrl('https://example.com/start', {timeoutMs:1000}))).rejects.toThrow('redirect limit');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('never follows redirects without an explicit policy', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect('/next'));
    vi.stubGlobal('fetch', fetch);
    await expect(requestUrl('https://example.com/start', {timeoutMs:1000})).rejects.toThrow('network policy');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation to a pending request', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('Synthetic request cancelled')), {once:true});
    }));
    vi.stubGlobal('fetch', fetch);
    const result = withWebRequestPolicy(allowExample, controller.signal, () => requestUrl('https://example.com/start', {timeoutMs:1000}));
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('keeps concurrent request policies isolated', async () => {
    const fetch = vi.fn().mockImplementation(async (url:string) => {await Promise.resolve();return url.endsWith('/start')?redirect('/next'):new Response('ok');});
    vi.stubGlobal('fetch', fetch);
    const result=await Promise.allSettled([
      withWebRequestPolicy(url=>url.startsWith('https://one.test/'),undefined,()=>requestUrl('https://one.test/start',{timeoutMs:1000})),
      withWebRequestPolicy(url=>url==='https://two.test/start',undefined,()=>requestUrl('https://two.test/start',{timeoutMs:1000}))
    ]);
    expect(result.map(item=>item.status)).toEqual(['fulfilled','rejected']);
    expect(fetch.mock.calls.some(([url])=>url==='https://two.test/next')).toBe(false);
  });
});
