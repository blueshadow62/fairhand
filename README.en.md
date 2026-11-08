<p align="right"><a href="README.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-README-0969da?style=for-the-badge"></a></p>

# geulnun (글눈)

A desktop tool for teachers that transcribes scanned handwritten short-answer/essay answer sheets (PDF) question by question, compares them with an answer key, and writes the results to Excel.

- Transcription runs through the teacher's own locally installed Claude Code or Codex (their own subscription login), or an API key (Anthropic, OpenAI or Gemini). Accuracy depends on the AI tool; the developer recommends Claude.
- We recommend that answer sheets carry only grade, class and number. If a name is written on the sheet, it is sent with the image to the AI provider's servers (Anthropic for Claude, OpenAI for Codex and the OpenAI API, Google for Gemini). The roster (names) is used only on the PC. See [PRIVACY.md](PRIVACY.md) (Korean).

## Install
### Windows
1. Download `fairhand-setup-x.y.z.exe` from [Releases](https://github.com/blueshadow62/fairhand/releases).
2. Run it. Because it is not code-signed, Windows shows an 'Unknown publisher' / 'Windows protected your PC' warning. Press **More info → Run anyway**. No administrator rights are needed (per-user install).
3. On first start, open **설정** (Settings) and press the button to create the default folder (Documents), or choose a semester folder, and set an AI profile.
4. To transcribe with Claude Code, install it and log in ([setup guide](https://code.claude.com/docs/en/setup)). The Settings screen walks you through the login.

### Mac (beta)
The developer has not used this beta on a real Mac; it has only been launched and screen-checked on CI servers. Please report problems (see [Reporting problems](#reporting-problems)).
1. From [Releases](https://github.com/blueshadow62/fairhand/releases), download the file for your chip: `fairhand-x.y.z-mac-arm64.dmg` for Apple silicon (M1 and later), `fairhand-x.y.z-mac-x64.dmg` for Intel. Apple menu > About This Mac shows the chip.
2. Open the dmg and drag **Fairhand** into Applications. On the Mac the app is named Fairhand; inside it is the same 글눈.
3. It is not signed by Apple, so the first launch shows a 'cannot be verified' dialog. Press **Done**, then **Open Anyway** at the bottom of System Settings > Privacy & Security, and open it again. If you see 'is damaged and can't be opened', run `xattr -dr com.apple.quarantine /Applications/Fairhand.app` in Terminal and open it again.
4. There is no automatic update. Download new versions with 'Open releases page' in Settings and replace the app the same way.
5. Install the Mac versions of Claude Code or Codex. 'Open login' in Settings starts the login in a Terminal window.

## Updates
- The app checks GitHub for a new version 10 seconds after start and every 4 hours, and downloads it. A 'Restart to apply' button then appears in Settings; the update installs only when you press it.
- To turn this off, uncheck 'Check for new versions automatically' under Settings → About. When off, the app does not contact GitHub.
- The installer and updates are not code-signed. They are downloaded from GitHub Releases over HTTPS, and electron-updater checks each file against the SHA-512 listed in the release. An update installs only when the user presses the button.

## Sample set
When the start screen has no sets, a 'Try the sample set' button adds a short invented story ('봄비 오는 날') with **three fake answer sheets in printed type** and ready-made transcriptions, so you can try Review and Excel without AI. It says nothing about handwriting accuracy.

## How to use
The app starts in Korean. To switch to English, open **설정** (the last tab) and pick **English** in the **언어** box; the screens reload in English.

1. **Settings**: choose the semester folder and an AI profile (Claude Code login or API key). A roster (xlsx/csv) is optional.
2. **Questions**: create a set and enter the answer key (optionally get an AI draft from the questions and passage). Mark it confirmed before grading.
3. **Run**: upload the answer-sheet PDF, fix rotation, split into pages, then start transcription. A result workbook is written to the set folder.
4. **Review**: compare each page image with its transcription, fix and save (the workbook is rebuilt). The semester cumulative record is built here too.

## Grading rules and precedents
- Each set has three grading rules (Questions screen): spelling variants with the same meaning, answers broader than the key, and sentence keywords (all / any).
- Verdicts changed in Review are recorded as precedents (can be turned off) and applied right away to other pages with the same answer for the same unit, and to pages transcribed later.
- After editing the answer key, existing pages can be re-judged: exact-text matching only (no model call), or by sending only the answer text to the model (no images).
- Every changed verdict is noted in the page's remarks; the student's answer text is never changed.

## Known limitations
- Scanned PDFs compressed with JBIG2 or JPEG2000 may fail to split into pages (ordinary JPEG scans are fine).

## Reporting problems
- Open an [issue](https://github.com/blueshadow62/fairhand/issues) with the steps and the screen name.
- **Never attach answer sheets, rosters or files with student information.** Mask student details in any image.
- Logs are in `%APPDATA%\글눈\logs\<date>.log`. Paste only the lines needed and remove student information.
- Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Development
- Requires Node 24+ (same major as the Node bundled in Electron 45; CI uses 24)
- `npm install` → `npm test` → `npm start` (builds first)
- Installer: `npm run dist` → `release/fairhand-setup-<version>.exe` (`npm run pack` for a quick `release/win-unpacked/Fairhand.exe`). Pushing a `v*` tag makes GitHub Actions build the installer and create a draft release.
- Mac (must be built on a Mac): `npm run dist:mac` → Apple silicon and Intel dmg. A Mac app packaged with the Korean product name crashes at launch (helper app naming, found 2026-11), so Mac builds override the product name with `Fairhand`. Without an Apple certificate it is only ad-hoc signed.
- Smoke test: `npm run pack`, then `npm run smoke` launches the app and saves a screenshot of every tab in `smoke-out/`. The GitHub Actions smoke workflow does the same on Windows, Mac and Linux and keeps the results as artifacts.
- During development keep settings and keys under the ignored `local/` folder: PowerShell `$env:GEULNUN_USER_DATA='local\userData'; npm start`
- Paths with spaces break when passed through `npm run`; after `npm run build`, call scripts directly, e.g. `node dist/scripts/transcribe-set.js "<set folder>" --engine cli`. To use another Claude Code account set `$env:CLAUDE_CONFIG_DIR` first.

## License
Apache-2.0. Third-party components are listed in [NOTICE](NOTICE). This program runs the Claude Code the user has installed; use of Claude is governed by the user's own agreement with Anthropic. This is an independent personal project, not affiliated with Anthropic.
