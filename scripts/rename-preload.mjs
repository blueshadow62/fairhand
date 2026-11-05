// sandbox preload는 CommonJS여야 하고 저장소는 "type": "module"이라 .js는 ESM으로 읽힌다: 확장자를 .cjs로
import { renameSync } from 'node:fs';
renameSync('dist-preload/src/preload/index.js', 'dist-preload/preload.cjs');
