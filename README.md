# Newshub Multimedia

The multimedia site of [newshub.gr](https://www.newshub.gr) — podcasts, video
and news from Crete. Live at **[newshubmedia.gr](https://newshubmedia.gr)**.

Static HTML. No framework, no database, no server at runtime.

## What it does

Node scripts read three public sources and write finished HTML:

| Source | What it gives | How |
|---|---|---|
| Buzzsprout RSS | 1,094 episodes, 452 transcripts | public feed |
| YouTube | 3,823 videos in 15 playlists | YouTube Data API |
| newshub.gr | news articles | `sitemap_google_news.xml` |

None of the sources is written to. The site only reads.

Output: ~6,400 pages, search that runs in the browser
([Pagefind](https://pagefind.app)), nothing third-party on the page.

GitHub Actions fetch, commit and deploy on a schedule. A watchdog
(`check-fresh.js`) opens an issue if no new article has arrived for hours,
because the publisher's sitemap is a rolling three-day window — anything
missed there is gone.

Journalists run the homepage, the articles and the ads from an admin built
into the same repo. It writes JSON back through the GitHub API, which trips
the build — no CMS, no database.
