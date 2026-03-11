/**
 * Unit tests for WordPress publish service.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishToWordPress } from '../../services/wordpress-publish.js';

describe('wordpress-publish', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when credentials are missing site_url', async () => {
    await expect(
      publishToWordPress(
        { application_password: 'pass', username: 'user' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/site_url|application_password/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when credentials are missing application_password', async () => {
    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'user' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/site_url|application_password/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when username is missing', async () => {
    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', application_password: 'pass' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/username|Reconnect/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when username is empty string', async () => {
    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', application_password: 'pass', username: '   ' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/username|Reconnect/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('calls WordPress API and returns url and id on 201', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 42,
        link: 'https://wp.example.com/2025/03/my-post/'
      })
    });

    const result = await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'user', application_password: 'pass' },
      { title: 'My Post', content: '<p>Body</p>' }
    );

    expect(result).toEqual({ url: 'https://wp.example.com/2025/03/my-post/', id: 42 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://wp.example.com/wp-json/wp/v2/posts');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toMatch(/^Basic /);
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('My Post');
    expect(body.content).toBe('<p>Body</p>');
    expect(body.status).toBe('publish');
  });

  it('throws on 401 with clear message', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/credentials|username|password/);
  });

  it('throws on 404 with REST API message', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/REST API|not found/);
  });
});
