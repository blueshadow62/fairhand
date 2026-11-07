import { nativeImage } from 'electron';
import { DataError, type MaskRect } from '../core/types.js';
import { maskBgra } from '../engine/privacy.js';

/** 새 패키지 없이 Electron 내장 그림 처리로 가린다 */
export function maskJpegNative(jpeg: Buffer, rect: MaskRect): Buffer {
  const img = nativeImage.createFromBuffer(jpeg);
  if (img.isEmpty()) throw new DataError('답안지 그림을 읽지 못해 이름 칸을 가릴 수 없습니다');
  const { width, height } = img.getSize();
  const pixels = Buffer.from(img.toBitmap());
  maskBgra(pixels, width, height, rect);
  return nativeImage.createFromBitmap(pixels, { width, height }).toJPEG(85);
}
