# OmniMod

Publish one archive to every host that already has a key.

`npm run dev` rehearses the send. It does not call Nexus, CurseForge, Modrinth, GitHub, or Thunderstore. The installed extension does.

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

Open the address the dev server prints. That page is the rehearsal.

```bash
npm test
npm run build:chrome
```

Load `dist/chrome` the same way as the release zip. That build calls the real host APIs.
