# Versioning and releases

Payeebook uses [Semantic Versioning](https://semver.org/). `package.json` is the
single source of truth; `src-tauri/Cargo.toml`, `Cargo.lock` and the desktop
bundle follow it (`tauri.conf.json` reads the version from `package.json`).

Every build also carries:

|                  | Where it comes from                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| **Version**      | `package.json` (e.g. `1.2.0`)                                                     |
| **Build number** | the GitHub Actions run number (`BUILD_NUMBER`); local builds use the commit count |
| **Commit**       | the short SHA the build was made from                                             |
| **Channel**      | `local`, `ci`, `web` (GitHub Pages) or `release`                                  |

They are shown under **Settings → About**, in the sidebar footer, and in the
footer of every generated PDF, so a printed report can always be traced back to
the exact code that produced it.

## Cutting a release

1. Make sure `main` is green.
2. Move the notes under `## [Unreleased]` in `CHANGELOG.md` into a new
   `## [x.y.z] - YYYY-MM-DD` section and update the compare links at the bottom.
3. Bump the version. This edits `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, commits, and tags `vx.y.z`:

   ```bash
   npm version minor -m "Release %s"
   ```

4. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

The **Release** workflow then:

1. checks the tag matches `package.json`, `Cargo.toml` and `CHANGELOG.md`;
2. runs lint, type checks, unit tests and template validation;
3. builds the web app and zips it together with the template library;
4. creates a draft GitHub Release with the changelog section as notes;
5. builds the desktop installers on Windows, macOS (universal) and Linux and
   attaches them;
6. adds `SHA256SUMS.txt` and publishes the release.

The **Deploy web app** workflow republishes GitHub Pages for each published
release and every push to `main`.

A release can also be started from **Actions → Release → Run workflow** with a
version number; the workflow creates the tag itself.

## Pre-releases

Versions with a suffix (`1.3.0-beta.1`) are published as GitHub pre-releases
and are not marked as latest.
