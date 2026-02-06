# Cursor handoff: Speed improvements & related content

**Copy the prompt below and paste it into Cursor when you want the frontend (or another agent) to use the new backend behavior.**

---

## Handoff prompt (copy from here)

```
Backend has merged speed improvements (PR #178). Use them as follows.

**1. Faster “related tweets + videos” in one request**

When the UI needs both related tweets and related videos for a topic (e.g. topic discovery or “find related content”):

- **Use the new endpoint:** `POST /api/v1/enhanced-blog-generation/related-content`
- **Auth:** Same as other enhanced-blog-generation routes (Bearer JWT).
- **Body:** `{ topic, businessInfo, maxTweets?, maxVideos? }`  
  - `topic`: object with at least `title`; can include `subheader`, `trend`, `seoBenefit`.
  - `businessInfo`: `{ businessType, targetAudience }`.
  - `maxTweets`: optional, default 3.
  - `maxVideos`: optional, default 5.
- **Response:** `200 { success: true, tweets, videos, searchTermsUsed: { tweets: string[], videos: string[] } }`.
- **Why:** The backend runs tweet and video pipelines in parallel (query extraction in parallel, then both searches in parallel). One call is ~max(tweet time, video time) instead of tweet + video time.

**Tasks for you:**
- Find any flow that currently requests “related tweets” and “related videos” separately (e.g. two stream POSTs or two fetch calls).
- Replace with a single `POST .../related-content` when both are needed, then use `tweets` and `videos` from the response.
- Keep using the existing stream endpoints (`/api/v1/tweets/search-for-topic-stream`, `/api/v1/youtube-videos/search-for-topic-stream`) when the user only asks for tweets or only videos.

**2. No changes required for**
- Topic ideas stream (already faster: DALL·E images in parallel).
- Blog analysis (backend now runs CTA, linking, and content analysis in parallel; API unchanged).
- Existing stream contracts (event types and payloads unchanged).
```

---

## Reference

- **PR:** https://github.com/Automate-My-Blog/automate-my-blog-backend/pull/178  
- **Backend speed doc:** `docs/SPEED_IMPROVEMENTS.md`  
- **Stream handoffs:** `docs/tweets-search-stream-frontend-handoff.md`, `docs/youtube-videos-search-stream-frontend-handoff.md` (still valid; use them when only one of tweets or videos is needed).
