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

## Running it

```bash
npm install          # first time only
npm run fetch        # episodes, videos, weather
npm run build        # build + search index
npm run build:full   # fetch + the above
npm run serve        # http://localhost:8080
```

`npm run build:fast` builds without the search index — for quick iteration.

Opening the files by double-click does **not** work: browsers block `fetch`
on `file://`, which kills search, transcripts and uninterrupted audio while
navigating. Always go through `npm run serve`.

### Why `build` no longer fetches

Cloudflare runs `npm run build` on every deployment, and the data is already
in the repo — the "Φρέσκο υλικό" workflow downloads and commits it.

While `fetch` was part of the build, every admin change re-downloaded
episodes and videos first: ~45 seconds extra, 15+ times a day, and it spent
calls against the YouTube **daily** quota that `fetch.yml` is careful to
protect. Use `build:full` for a manual full run.

Weather is the exception and stays inside `build`: `data/weather.json` is
deliberately not in git (half-hour-old weather is not weather), the API needs
no key and takes a second. When `fetch` left the build it took weather with
it and the temperature silently vanished from the header for a day — hence
the separate line. If the fetch fails the build carries on.

## Scripts

| File | What it does |
|---|---|
| `build.js` | writes every page; incremental, only what changed |
| `publish.js` | build + search index, only when needed |
| `feed.js` | reads the Buzzsprout RSS |
| `fetch-episodes.js` | writes `data/episodes.json` |
| `fetch-videos.js` | writes `data/videos.json` — needs `YOUTUBE_API_KEY` |
| `fetch-news.js` | writes `data/news.json` — accumulates, never truncates |
| `fetch-transcripts.js` | downloads missing transcripts only |
| `find-aliases.js` | reports duplicate people — never merges on its own |
| `check-fresh.js` | watchdog: are articles still arriving? |
| `check-images.js` | opens real pages in a browser, fails if any image is cropped |
| `serve.js` | local server, also serves the admin |

## Configuration

A `.env` file in the root:

```
YOUTUBE_API_KEY=...
```

Never committed. In CI the same values come from repository secrets.

## Where to change what

| To change | File |
|---|---|
| colours, fonts, sizes | `public/styles.css`, in `:root` |
| which episode goes big on the homepage | `data/curation.json` |
| categories and keywords | `build.js`, `CATEGORIES` |
| names that are the same person | `data/people-aliases.json` |
| menu | `build.js`, `MENU` |
| site address | `build.js`, `SITE_URL` |

## What is not in git

Anything generated or re-downloadable: the pages under `public/`, the
Pagefind index, `node_modules/`, `.env`, and the images journalists upload
(those live in Cloudflare R2).

What stays in git is the data that cannot be rebuilt: `data/news.json`
(accumulated article by article), `data/people-aliases.json` and
`data/curation.json` (written by hand), and the transcripts.
