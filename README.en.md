# geulnun (글눈)

A desktop tool for teachers that transcribes scanned handwritten short-answer/essay answer sheets (PDF) question by question, compares them with an answer key, and writes the results to Excel.

- Transcription runs through the teacher's own locally installed Claude Code (their own subscription login). An Anthropic API key can be used instead.
- Student names never leave the PC. We recommend writing only grade, class and number on answer sheets. See [PRIVACY.md](PRIVACY.md) (Korean).
- Under development (phase 0–1). Installation instructions will come with the first release.

## Development
- Requires Node 22+
- `npm install` → `npm test` → `npm start`

## License
Apache-2.0. Third-party components are listed in [NOTICE](NOTICE). This program runs the Claude Code the user has installed; use of Claude is governed by the user's own agreement with Anthropic. This is an independent personal project, not affiliated with Anthropic.
