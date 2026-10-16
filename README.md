# OmniMod

Publish one archive to every host that already has a key.

`npm run dev` rehearses the send. It does not call the hosts. Real uploads happen in the Chrome extension. Build that with one command:

```bash
npm run extension
```

That writes `dist/chrome` and `omnimod-chrome.zip`. Open `chrome://extensions`, turn on Developer mode, and choose Load unpacked on `dist/chrome`. Click the OmniMod icon. It opens a tab and sends to the hosts.

## Install in Chrome

1. Download `omnimod-chrome.zip` from the latest GitHub Release.
2. Unzip it. The folder must contain `manifest.json`.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and choose that folder.
6. Click the OmniMod icon. It opens a tab.

After a new release, click the refresh icon on the OmniMod card.

## Run it locally

```bash
npm install
npm run dev
```

Open the address the dev server prints. That page only rehearses.

```bash
npm test
npm run lint
npm run extension
```

## Host keys

Every host field lives in `src/lib/omnimod/catalog.ts` on that platform's `fields` list. The Hosts page reads the same list to draw the form. A value is saved on the mod under that host id. Publish planning checks the required keys before it contacts a host. `src/lib/omnimod/live.ts` reads the same keys when it builds an API request or fills the CurseForge page. `src/lib/omnimod/publish.ts` reads them when it plans the send and when it writes the CurseForge form. A key used in those two files must be declared in the catalog. Lint rejects a field name that is not in the catalog.

Nexus uses an API key, a game domain, and a mod id. The API key is secret. Modrinth uses a token, a project id or slug, game versions, and loaders. GitHub Releases uses a token and a repository written as owner/name. Thunderstore uses a token, a team namespace, a community, and optional categories. CurseForge uses a project id and game versions. It also stores release type, when to publish, changelog format, relations, and display name. Release type, publish timing, and changelog format fall back to the catalog default when the field is blank. The changelog format is WYSIWYG, text, or markdown. WYSIWYG writes the visual editor. Text writes plain text in that same editor. Markdown switches the form to the markdown editor and writes there. CurseForge accepts a zip only. A jar is packed into a zip first when that option is on. Steam Workshop is later and only stores an app id and a workshop item id. The other later hosts do not have keys yet.

Secret keys are not copied into a failure report.
