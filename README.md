# NexLive

A mobile-first, dark-themed Live TV web app. Static HTML/CSS/JS — no build step, deploys straight to GitHub Pages, Vercel, Netlify, or Cloudflare Pages.

## Project structure

```
NexLive/
├── index.html            # Main viewer app (splash, home, search, player)
├── admin.html            # Admin dashboard
├── assets/
│   ├── css/
│   │   ├── styles.css    # Shared design tokens + all viewer styles
│   │   └── admin.css     # Admin-only styles (login gate, tables, modal)
│   ├── js/
│   │   ├── store.js      # Data layer: playlist parsing, normalization,
│   │   │                 #   persistence — shared by index.html and admin.html
│   │   ├── app.js        # Viewer UI + custom video player logic
│   │   └── admin.js      # Admin UI logic (auth gate, CRUD, reordering)
│   ├── logo/, icons/, images/   # Drop your own brand assets here
└── README.md
```

Only three JS files exist on purpose: `store.js` holds every piece of data logic exactly once so `app.js` (viewer) and `admin.js` (admin) never duplicate it or touch `localStorage` directly.

## Running locally

Any static file server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `index.html` for the viewer and `admin.html` for the admin panel.

## Deploying

Push this folder to a GitHub repo and import it into Vercel/Netlify/Cloudflare Pages as a **static site** — no build command or output directory needed (leave them blank/default). It also works unmodified on GitHub Pages.

## Channel data

- The initial catalog comes from the public [iptv-org playlist](https://iptv-org.github.io/iptv/index.m3u), fetched and parsed client-side, then cached in `localStorage` for 6 hours.
- `store.js` normalizes every entry into:

```js
{
  id, name, streamUrl, logo, country, countryCode,
  category, language, description, featured, enabled, custom
}
```

- Only publicly accessible streams from that playlist are used. NexLive does **not** attempt to bypass DRM, authentication, paywalls, or geo-restrictions of any provider, and you should not modify it to do so.

## Admin panel

- Prototype key: `Rashni22153` (set in `assets/js/admin.js` as `ADMIN_KEY`).
- **This is not real security.** It's a plain string shipped in client-side JavaScript — anyone who opens dev tools can read it. It exists only to gate the demo UI, not to protect data.
- Admin edits (add/edit/delete/enable/disable/feature/reorder sections) are written to **this browser's `localStorage`**. That means:
  - Changes made in one browser/device are invisible to visitors using a different browser/device.
  - Clearing site data erases every admin change.
- This is acceptable for a personal demo or prototype, but **not** for a real multi-user deployment.

### Moving to a real backend

Everything in `store.js` is written so only its exported functions (`addChannel`, `updateChannel`, `deleteChannel`, `setEnabled`, `setFeatured`, `saveHomepageSections`, `saveFeaturedOrder`, `getAllChannels`, ...) need to change — `app.js` and `admin.js` never touch `localStorage` directly. To go to production:

1. Stand up a small API (any stack) backed by a real database, with server-side authentication for admin routes (replace the hardcoded key with real login + sessions/JWT).
2. Replace the `LocalStore.get/set` calls inside `store.js`'s exported functions with `fetch()` calls to that API.
3. Nothing in `app.js` or `admin.js` needs to change, because they only ever call `NexLiveStore.*`.

## Player

- Custom-built player (no third-party player UI) using [hls.js](https://github.com/video-dev/hls.js) for `.m3u8` streams in browsers without native HLS, and the `<video>` element's native HLS support on Safari/iOS.
- Features: play/pause, volume/mute, fullscreen, Picture-in-Picture (where supported by the browser/device), a persistent "NexLive" watermark that never blocks controls, and Next/Previous channel controls.
- If a stream fails, the player shows a short error state and automatically advances to the next channel in the current queue, up to a small retry limit — so one dead stream can't create an infinite retry loop or freeze the app.

## Notes on scope

This is an educational/demo project. It intentionally does not implement DRM circumvention, auth/paywall/geo-block bypass, or any other access-control circumvention — only normal playback of publicly accessible streams, with graceful handling of normal network/stream failures.
