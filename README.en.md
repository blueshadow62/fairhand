# geulnun (글눈)

A desktop tool for teachers that transcribes scanned handwritten short-answer/essay answer sheets (PDF) question by question, compares them with an answer key, and writes the results to Excel.

- Transcription runs through the teacher's own locally installed Claude Code (their own subscription login). An Anthropic API key can be used instead.
- We recommend that answer sheets carry only grade, class and number. If a name is written on the sheet, it is sent to Anthropic's servers together with the image. The roster (names) is used only on the PC. See [PRIVACY.md](PRIVACY.md) (Korean).
- Under development (phase 4: screens). Installation instructions will come with the first release.

## How to use
1. **Settings**: choose the semester folder and an AI profile (Claude Code login or API key). A roster (xlsx/csv) is optional.
2. **Questions**: create a set and enter the answer key (optionally get an AI draft from the questions and passage). Mark it confirmed before grading.
3. **Run**: upload the answer-sheet PDF, fix rotation, split into pages, then start transcription. A result workbook is written to the set folder.
4. **Review**: compare each page image with its transcription, fix and save (the workbook is rebuilt). The semester cumulative record is built here too.

## Grading rules and precedents
- Each set has three grading rules (Questions screen): spelling variants with the same meaning, answers broader than the key, and sentence keywords (all / any).
- Verdicts changed in Review are recorded as precedents (can be turned off) and applied right away to other pages with the same answer for the same unit, and to pages transcribed later.
- After editing the answer key, existing pages can be re-judged: exact-text matching only (no model call), or by sending only the answer text to the model (no images).
- Every changed verdict is noted in the page's remarks; the student's answer text is never changed.

## Development
- Requires Node 22+
- `npm install` → `npm test` → `npm start` (builds first)
- During development keep settings and keys under the ignored `local/` folder: PowerShell `$env:GEULNUN_USER_DATA='local\userData'; npm start`
- Paths with spaces break when passed through `npm run`; after `npm run build`, call scripts directly, e.g. `node dist/scripts/transcribe-set.js "<set folder>" --engine cli`. To use another Claude Code account set `$env:CLAUDE_CONFIG_DIR` first.

## License
Apache-2.0. Third-party components are listed in [NOTICE](NOTICE). This program runs the Claude Code the user has installed; use of Claude is governed by the user's own agreement with Anthropic. This is an independent personal project, not affiliated with Anthropic.
