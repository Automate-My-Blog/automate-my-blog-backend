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
    const jsonBody = { id: 42, link: 'https://wp.example.com/2025/03/my-post/' };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => JSON.stringify(jsonBody),
      json: async () => jsonBody
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

  it('converts markdown content to HTML before sending to WordPress', async () => {
    const jsonBody = { id: 1, link: 'https://wp.example.com/?p=1' };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => JSON.stringify(jsonBody),
      json: async () => jsonBody
    });

    await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
      { title: 'Test', content: '# Hello\n\nThis is **bold** and a [link](https://example.com).' }
    );

    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.content).toContain('<h1>');
    expect(body.content).toContain('Hello');
    expect(body.content).toContain('<strong>bold</strong>');
    expect(body.content).toContain('<a href="https://example.com"');
  });

  it('replaces image and chart placeholders with img tags for WordPress', async () => {
    const postResponse = { id: 1, link: 'https://wp.example.com/?p=1' };
    const imageMediaResponse = { id: 10, source_url: 'https://wp.example.com/wp-content/uploads/2026/03/image.png' };
    const chartMediaResponse = { id: 11, source_url: 'https://wp.example.com/wp-content/uploads/2026/03/chart.png' };
    const tinyPng = new ArrayBuffer(8);
    globalThis.fetch.mockImplementation((url, opts) => {
      const u = typeof url === 'string' ? url : url?.url || '';
      if (u.includes('via.placeholder.com')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(tinyPng) });
      }
      if (u.includes('/wp/v2/media') && opts?.method === 'POST' && !u.match(/\/media\/\d+$/)) {
        const isChart = opts?.headers?.['Content-Disposition']?.includes('chart');
        const data = isChart ? chartMediaResponse : imageMediaResponse;
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(data),
          json: async () => data
        });
      }
      if (u.match(/\/wp\/v2\/media\/\d+$/) && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
      }
      if (u.includes('/wp/v2/posts')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          text: async () => JSON.stringify(postResponse),
          json: async () => postResponse
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${u}`));
    });

    await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
      {
        title: 'Post',
        content: 'Intro.\n\n![IMAGE:hero_image:Sunset over mountains]\n\n![CHART:bar|Sales 2024|Q1,Q2,Q3|10,20,30]'
      }
    );

    const postCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/wp/v2/posts'));
    expect(postCalls.length).toBe(1);
    const [, postOpts] = postCalls[0];
    const body = JSON.parse(postOpts.body);
    expect(body.content).toContain('<img');
    expect(body.content).toContain('Sunset over mountains');
    expect(body.content).toContain('Sales 2024');
    expect(body.content).toContain('https://wp.example.com/wp-content/uploads/');
    expect(body.content).not.toContain('![IMAGE:');
    expect(body.content).not.toContain('![CHART:');
    expect(body.content).toContain('<!-- wp:html -->');
    expect(body.content).toContain('wp-block-image');
    expect(body.content).not.toMatch(/<figure[^>]*\sstyle=/);
    expect(body.content).not.toMatch(/<img[^>]*\sstyle=/);
    expect(body.featured_media).toBe(10);
  });

  it('replaces tweet placeholders with oEmbed or fallback HTML for WordPress', async () => {
    const jsonBody = { id: 1, link: 'https://wp.example.com/?p=1' };
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ html: '<blockquote class="twitter-tweet">Embedded tweet</blockquote>' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(jsonBody),
        json: async () => jsonBody
      });

    await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
      {
        title: 'Post',
        content: 'Text.\n\n![TWEET:https://x.com/user/status/123]\n\nMore.'
      }
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const [, wpOpts] = globalThis.fetch.mock.calls[1];
    const body = JSON.parse(wpOpts.body);
    expect(body.content).toContain('Embedded tweet');
    expect(body.content).not.toContain('![TWEET:');
  });

  it('strips index-based and literal placeholders so they do not appear on WordPress', async () => {
    const jsonBody = { id: 1, link: 'https://wp.example.com/?p=1' };
    const mediaResponse = { id: 5, source_url: 'https://wp.example.com/wp-content/uploads/2026/03/image.png' };
    const tinyPng = new ArrayBuffer(8);
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(tinyPng) })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(mediaResponse),
        json: async () => mediaResponse
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(jsonBody),
        json: async () => jsonBody
      });

    await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
      {
        title: 'Post',
        content: 'Intro.\n\n[Image: An immersive fantasy landscape.]\n\nMiddle.\n\n[TWEET:1]\n\n[VIDEO:3]\n\nEnd.'
      }
    );

    const postCall = globalThis.fetch.mock.calls.find(([url]) => String(url).includes('/wp/v2/posts'));
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.content).not.toContain('[TWEET:1]');
    expect(body.content).not.toContain('[VIDEO:3]');
    expect(body.content).not.toContain('[Image:');
    expect(body.content).toContain('Intro.');
    expect(body.content).toContain('Middle.');
    expect(body.content).toContain('End.');
  });

  it('throws on 401 with clear message', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' });

    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/credentials|username|password/);
  });

  it('throws on 404 with REST API message (after retry with index.php)', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });

    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/REST API|not found/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://wp.example.com/wp-json/wp/v2/posts');
    expect(globalThis.fetch.mock.calls[1][0]).toBe('https://wp.example.com/index.php?rest_route=/wp/v2/posts');
  });

  it('throws when WordPress returns HTML instead of JSON (200)', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<!DOCTYPE html><html><body>Not JSON</body></html>'
    });

    await expect(
      publishToWordPress(
        { site_url: 'https://wp.example.com', username: 'u', application_password: 'p' },
        { title: 'T', content: 'C' }
      )
    ).rejects.toThrow(/HTML page instead of JSON|not valid JSON/);
  });

  it('uses index.php?rest_route= URL when useIndexPhpRestRoute is true', async () => {
    const jsonBody = { id: 1, link: 'https://wp.example.com/?p=1' };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => JSON.stringify(jsonBody),
      json: async () => jsonBody
    });

    await publishToWordPress(
      { site_url: 'https://wp.example.com', username: 'u', application_password: 'p', useIndexPhpRestRoute: true },
      { title: 'T', content: 'C' }
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://wp.example.com/index.php?rest_route=/wp/v2/posts');
  });
});
