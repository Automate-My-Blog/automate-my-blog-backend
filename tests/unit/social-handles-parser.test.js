/**
 * Unit tests for social handle parsing (webscraper _parseSocialHandle and _buildSocialHandlesObject).
 */
import { describe, it, expect } from 'vitest';
import webScraper from '../../services/webscraper.js';

const baseUrl = 'https://example.com';

function parse(href) {
  return webScraper._parseSocialHandle(href, baseUrl);
}

function build(pairs) {
  return webScraper._buildSocialHandlesObject(pairs);
}

describe('social-handles parser', () => {
  describe('_parseSocialHandle', () => {
    it('returns null for non-URL or empty', () => {
      expect(parse('')).toBeNull();
      expect(parse(null)).toBeNull();
      expect(parse('#section')).toBeNull();
      expect(parse('/about')).toBeNull();
    });

    it('returns null for non-social URLs', () => {
      expect(parse('https://example.com')).toBeNull();
      expect(parse('https://google.com/search?q=test')).toBeNull();
      expect(parse('https://amazon.com/dp/123')).toBeNull();
    });

    it('parses Twitter/X', () => {
      expect(parse('https://twitter.com/samjhill')).toEqual({ platform: 'twitter', handle: '@samjhill' });
      expect(parse('https://x.com/samjhill')).toEqual({ platform: 'twitter', handle: '@samjhill' });
      expect(parse('https://twitter.com/@already')).toEqual({ platform: 'twitter', handle: '@already' });
      expect(parse('https://twitter.com/intent/tweet')).toBeNull();
    });

    it('parses LinkedIn company and profile', () => {
      expect(parse('https://www.linkedin.com/company/acme')).toEqual({ platform: 'linkedin', handle: 'company/acme' });
      expect(parse('https://linkedin.com/in/sam-hill-a9283442/')).toEqual({ platform: 'linkedin', handle: 'in/sam-hill-a9283442' });
    });

    it('parses Facebook', () => {
      expect(parse('https://facebook.com/myPage')).toEqual({ platform: 'facebook', handle: 'myPage' });
      expect(parse('https://fb.com/myPage')).toEqual({ platform: 'facebook', handle: 'myPage' });
    });

    it('parses Instagram', () => {
      expect(parse('https://instagram.com/username')).toEqual({ platform: 'instagram', handle: 'username' });
    });

    it('parses YouTube', () => {
      expect(parse('https://youtube.com/@handle')).toEqual({ platform: 'youtube', handle: '@handle' });
      expect(parse('https://youtube.com/c/ChannelName')).toEqual({ platform: 'youtube', handle: 'c/ChannelName' });
      expect(parse('https://youtube.com/channel/UCxxxx')).toEqual({ platform: 'youtube', handle: 'channel/UCxxxx' });
    });

    it('parses TikTok', () => {
      expect(parse('https://tiktok.com/@user')).toEqual({ platform: 'tiktok', handle: '@user' });
    });

    it('parses GitHub', () => {
      expect(parse('https://github.com/samjhill')).toEqual({ platform: 'github', handle: 'samjhill' });
      expect(parse('https://github.com/org/repo')).toEqual({ platform: 'github', handle: 'org' });
      expect(parse('https://github.com/login')).toBeNull();
    });

    it('parses Reddit', () => {
      expect(parse('https://reddit.com/user/someuser')).toEqual({ platform: 'reddit', handle: 'someuser' });
      expect(parse('https://reddit.com/u/someuser')).toEqual({ platform: 'reddit', handle: 'someuser' });
    });

    it('parses Pinterest', () => {
      expect(parse('https://pinterest.com/username')).toEqual({ platform: 'pinterest', handle: 'username' });
    });

    it('parses Medium', () => {
      expect(parse('https://medium.com/@writer')).toEqual({ platform: 'medium', handle: '@writer' });
      expect(parse('https://medium.com/publication')).toEqual({ platform: 'medium', handle: 'publication' });
    });

    it('parses Substack', () => {
      expect(parse('https://substack.com/@author')).toEqual({ platform: 'substack', handle: '@author' });
      expect(parse('https://blogname.substack.com')).toEqual({ platform: 'substack', handle: 'blogname' });
    });

    it('parses Threads', () => {
      expect(parse('https://threads.net/@user')).toEqual({ platform: 'threads', handle: '@user' });
    });

    it('parses Bluesky', () => {
      expect(parse('https://bsky.app/profile/handle.bsky.social')).toEqual({ platform: 'bluesky', handle: 'handle.bsky.social' });
    });

    it('parses Tumblr', () => {
      expect(parse('https://blogname.tumblr.com')).toEqual({ platform: 'tumblr', handle: 'blogname' });
      expect(parse('https://tumblr.com/blog/blogname')).toEqual({ platform: 'tumblr', handle: 'blogname' });
    });

    it('parses Vimeo', () => {
      expect(parse('https://vimeo.com/username')).toEqual({ platform: 'vimeo', handle: 'username' });
    });

    it('parses Dribbble', () => {
      expect(parse('https://dribbble.com/designer')).toEqual({ platform: 'dribbble', handle: 'designer' });
    });

    it('parses Behance', () => {
      expect(parse('https://behance.net/artist')).toEqual({ platform: 'behance', handle: 'artist' });
    });

    it('parses SoundCloud', () => {
      expect(parse('https://soundcloud.com/artist')).toEqual({ platform: 'soundcloud', handle: 'artist' });
    });

    it('parses Twitch', () => {
      expect(parse('https://twitch.tv/streamer')).toEqual({ platform: 'twitch', handle: 'streamer' });
    });

    it('parses Telegram', () => {
      expect(parse('https://t.me/username')).toEqual({ platform: 'telegram', handle: 'username' });
    });

    it('parses Patreon', () => {
      expect(parse('https://patreon.com/creator')).toEqual({ platform: 'patreon', handle: 'creator' });
    });

    it('parses Linktree', () => {
      expect(parse('https://linktr.ee/username')).toEqual({ platform: 'linktree', handle: 'username' });
    });

    it('parses Snapchat', () => {
      expect(parse('https://snapchat.com/add/username')).toEqual({ platform: 'snapchat', handle: 'username' });
    });

    it('parses Ko-fi', () => {
      expect(parse('https://ko-fi.com/creator')).toEqual({ platform: 'kofi', handle: 'creator' });
    });

    it('parses Buy Me a Coffee', () => {
      expect(parse('https://buymeacoffee.com/creator')).toEqual({ platform: 'buymeacoffee', handle: 'creator' });
    });

    it('parses Discord user URL', () => {
      expect(parse('https://discord.com/users/123456789')).toEqual({ platform: 'discord', handle: '123456789' });
    });

    it('parses Mastodon', () => {
      expect(parse('https://mastodon.social/@user')).toEqual({ platform: 'mastodon', handle: 'mastodon.social/@user' });
      expect(parse('https://mas.to/@user')).toEqual({ platform: 'mastodon', handle: 'mas.to/@user' });
    });

    it('handles relative href with baseUrl', () => {
      expect(parse('/twitter.com/skip')).toBeNull();
      expect(parse('https://github.com/rel')).toEqual({ platform: 'github', handle: 'rel' });
    });
  });

  describe('_buildSocialHandlesObject', () => {
    it('builds object by platform and dedupes', () => {
      const pairs = [
        { platform: 'twitter', handle: '@a' },
        { platform: 'github', handle: 'b' },
        { platform: 'twitter', handle: '@a' },
      ];
      expect(build(pairs)).toEqual({ twitter: ['@a'], github: ['b'] });
    });

    it('allows multiple handles per platform', () => {
      const pairs = [
        { platform: 'linkedin', handle: 'company/a' },
        { platform: 'linkedin', handle: 'in/b' },
      ];
      expect(build(pairs)).toEqual({ linkedin: ['company/a', 'in/b'] });
    });

    it('returns empty object for empty input', () => {
      expect(build([])).toEqual({});
    });
  });
});
