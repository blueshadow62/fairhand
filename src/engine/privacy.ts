import { DataError, type AnswerKey, type MaskRect } from '../core/types.js';

export type JpegMasker = (jpeg: Buffer, rect: MaskRect) => Buffer | Promise<Buffer>;

/** BGRA 그림의 영역을 흰색으로 채운다. 경계는 바깥쪽으로 올려 이름이 한 줄이라도 새지 않게 한다 */
export function maskBgra(pixels: Buffer, width: number, height: number, r: MaskRect): void {
  const x0 = Math.max(0, Math.floor(r.x * width)), x1 = Math.min(width, Math.ceil((r.x + r.w) * width));
  const y0 = Math.max(0, Math.floor(r.y * height)), y1 = Math.min(height, Math.ceil((r.y + r.h) * height));
  for (let y = y0; y < y1; y++) pixels.fill(255, (y * width + x0) * 4, (y * width + x1) * 4);
}

/** 모델로 나가는 답안지 그림은 모두 여기를 지난다. 가리기로 한 세트를 가릴 수 없으면 원본을 보내는 대신 멈춘다 */
export async function imageToSend(jpeg: Buffer, key: AnswerKey, masker?: JpegMasker): Promise<Buffer> {
  if (!key.이름가림) return jpeg;
  if (!masker) throw new DataError('이 세트는 이름 칸을 가리고 보내도록 설정되어 있는데, 지금 실행 방식에서는 그림을 가릴 수 없습니다. 글눈 프로그램에서 전사해 주세요');
  return masker(jpeg, key.이름가림);
}
