# <img src="public/favicon.svg" width="32" height="32" alt="OmniMod">  OmniMod

One archive. One publish. Every host that is ready.

## Contents

1. [Install](#install)
2. [Build the extension](#build-the-extension)
3. [Set up a host](#set-up-a-host)
4. [Nexus Mods](#nexus-mods)
5. [Modrinth](#modrinth)
6. [GitHub Releases](#github-releases)
7. [Thunderstore](#thunderstore)
8. [CurseForge](#curseforge)
9. [Later](#later)
10. [The package](#the-package)
11. [Deployments](#deployments)
12. [Where the keys are used](#where-the-keys-are-used)

## Install

1. Download `omnimod-chrome.zip` from the latest GitHub Release.
2. Unzip it. The folder must contain `manifest.json`.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Click Load unpacked and choose that folder.
6. Click the OmniMod icon. It opens a tab.

After a new release, click the refresh icon on the OmniMod card.

## Build the extension

```bash
npm install
npm run build
```

That writes `dist/chrome` and `omnimod-chrome.zip`.

`npm run dev` only rehearses the send. It does not call the hosts.

```bash
npm test
npm run lint
npm run check
```

`npm run check` runs lint and the coverage tests. When both pass it prints `lint and coverage passed on <branch>`. Put a screenshot of that line on a pull request. It does not print folders.

Pull requests run lint on its own, then the tests. A push to main still lints before the extension is published, even when the tests are skipped.

The source manifest stays on the last published version. A push to main looks for the next free patch and writes that version into the built extension. It does not jump from `0.1.x` to `1.x`. Leave the source version on the last release.

Nexus and Thunderstore hand back an upload address whose path changes for each file. Those addresses are on Amazon S3 or the Thunderstore CDN, so the extension is limited to `*.amazonaws.com` and `gcdn.thunderstore.io`. The other entries are the host APIs.

## Set up a host

1. Open Hosts.
2. Turn the host on.
3. Fill the fields for that host. The steps below say where each value comes from.
4. Open the mod and publish.

A blank optional field uses the default. A missing required field blocks that host.

Secrets stay on this computer. Turn on Encrypt keys if you want them locked to this browser.

## Nexus Mods

Open [your API page](https://www.nexusmods.com/users/myaccount?tab=api) and request a key. Paste it into API key.

The other two values are in the mod URL.

`https://www.nexusmods.com/skyrimspecialedition/mods/123456`

| Field | Enter |
| --- | --- |
| Game domain | `skyrimspecialedition` |
| Mod ID | `123456` |

Accepts zip, rar, and 7z.

## Modrinth

Create a token at [Modrinth tokens](https://modrinth.com/settings/pats). It must be allowed to create versions.

| Field | Where to get it |
| --- | --- |
| Project ID or slug | The last word of the project URL, or the id on the project settings page. |
| Game versions | The versions this file supports. Separate them with commas. |
| Loaders | `fabric`, `forge`, `neoforge`, `quilt`, and so on. |

Accepts jar.

## GitHub Releases

Create a token at [GitHub tokens](https://github.com/settings/tokens). It must be allowed to write the repository.

| Field | Enter |
| --- | --- |
| Repository | `owner/name` from the repository URL. |

## Thunderstore

1. Sign in at [thunderstore.io](https://thunderstore.io/).
2. Open Settings, then Teams, then your team. Teams live at [thunderstore.io/teams](https://thunderstore.io/teams/).
3. Open Service Accounts.
4. Add a service account and copy the token. It is shown once and starts with `tss_`.

| Field | Enter |
| --- | --- |
| Team namespace | The team name. |
| Community | The word in the community URL, such as `riskofrain2`. |
| Categories | Optional. Names from that community, separated by commas. |

The zip needs `icon.png`, `README.md`, and `manifest.json` at the root. The host icon is optional. It must be a PNG no larger than 256×256.

Accepts zip.

## CurseForge

No token. Stay logged into CurseForge in this Chrome profile.

The project id is the number in the author URL.

`https://authors.curseforge.com/#/projects/1744552/files`

Game versions are the only versions that stay selected. Type the name, such as `26.2`, or the version id.

These can stay blank. The defaults are used.

| Field | Default |
| --- | --- |
| Release type | Release |
| Release options | Publish automatically once approved |
| Changelog format | WYSIWYG |

Text writes the same editor as plain text. Markdown switches to the markdown editor.

Relations and display name are optional.

Accepts zip.

## Later

Steam Workshop stores an App ID and a Workshop item ID. It does not upload yet.

The App ID is the number in the store URL. The Workshop item ID is the number in the workshop file URL.

These hosts have no fields yet.

Basedmods, AyakaMods, AFK Mods, Modding Haven, LaxMods, Mod DB.

## The package

Drop the archive on the mod, set the version and the changelog, then publish.

Auto-zip packs files that are not already a zip. A host that accepts zip receives that zip. A host that accepts the original file receives the original file.

Auto-zip can build a zip. It cannot build a jar. When one ready host accepts only a jar and another accepts only a zip, the form accepts a jar and refuses a zip.

Export and Import, on the Mods page, save and restore mods, host setup, and deployments.

## Deployments

Each publish is listed under Deployments. Open a row to see the hosts. Select the failed hosts and run them again.

If the package is no longer loaded, a dialog asks for the file. That dialog uses the same rules as the form. Cancel leaves the row unchanged.

## Where the keys are used

The field names are declared in `src/lib/omnimod/catalog.ts`.

The Hosts page draws the form from that list. The values are saved on the mod.

`src/lib/omnimod/publish.ts` checks the required fields and writes the CurseForge form.

`src/lib/omnimod/live.ts` sends the host requests with the same keys.

Lint rejects a field name in those two files that is not in the catalog.

Secret keys are not copied into a failure report.
