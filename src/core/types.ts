export type Panjeong = 'O' | 'X' | '빈칸';
export type Hwaksin = '확실' | '추정' | '불명';

export interface QtyUnit { id: string; 문항: number; 설명: string; 정답: string; 허용?: string[]; 핵심?: string[] }
export interface QualUnit { id: string; 문항: number; 설명: string }

export interface AnswerKey {
  세트: string;
  글: string;
  학기: string;
  대상: { 학년: number; 반: number[]; 인원?: Record<string, number> };
  확인?: { 완료: boolean; 일시?: string };
  정량: QtyUnit[];
  정성: QualUnit[];
}

export interface TranscribeInfo { 엔진: 'cli' | 'api' | '사람'; 모델: string; effort: string; 규칙: string; 일시: string }

export interface Transcript {
  page: number;
  학년: number | null; 반: number | null; 번호: number | null; 이름: string | null;
  식별확신: Hwaksin;
  정량: Record<string, { 답: string; 판정: Panjeong }>;
  정성: Record<string, { 응답: boolean; 답: string }>;
  비고: string[];
  확인완료?: boolean;
  전사정보?: TranscribeInfo;
}

export interface Student { 학년: number; 반: number; 번호: number; 이름: string | null }

export interface ScoreResult {
  판정: Record<string, Panjeong>;
  답: Record<string, string>;
  응답: Record<string, boolean>;
  비고: string[];
  정량: number; 정성: number; 합계: number;
}

/** 엑셀 한 행. 점수가 null이면 미제출·미확정. */
export interface Row {
  학년: number | null; 반: number | null; 번호: number | null; 이름: string | null;
  합계: number | null; 정량: number | null; 정성: number | null;
  비고: string;
  page: number | null;
  판정: Record<string, Panjeong>;
  답: Record<string, string>;
  응답: Record<string, boolean>;
}

/** 사용자에게 그대로 보여 줄 오류(한글, 어느 파일·장인지 포함) */
export class DataError extends Error {}

export const studentKey = (학년: number, 반: number, 번호: number): string => `${학년}-${반}-${번호}`;
export const pageTag = (page: number): string => `p${String(page).padStart(2, '0')}`;
