export type Panjeong = 'O' | 'X' | '빈칸';
export type Hwaksin = '확실' | '추정' | '불명';

export type UnitType = '빈칸형' | '단답형' | '문장형' | '요소형' | '논술형';
/**
 * 유형이 없으면 빈칸 위치대로 옮기는 단위로 본다. '요소형'만 쓴 순서와 상관없이 요소별 단위에 나눈다.
 * '논술형'은 한 편의 글에서 찾을 요소 하나: 종류 '인용'은 정답 문장을 거의 그대로 썼는지, '용어'는 정답(허용) 용어를 썼는지.
 * 배점이 없으면 1점(배점을 두기 전 정답표와 같게). 맞으면(정성은 응답하면) 배점만큼 더한다
 */
export interface QtyUnit { id: string; 문항: number; 설명: string; 정답: string; 허용?: string[]; 핵심?: string[]; 유형?: UnitType; 종류?: '인용' | '용어'; 배점?: number }
export interface QualUnit { id: string; 문항: number; 설명: string; 배점?: number }

/** 세트별 채점 규칙. 없으면 DEFAULT_RULES(key.ts) */
export interface GradingRules { 맞춤법: '인정' | '불인정'; 넓은말: '인정' | '불인정'; 핵심어: '모두' | '하나라도' }
/** 선생님이 검토에서 확정한 판정. 같은 단위에 같은(정규화한) 답을 쓴 장에 그대로 적용된다 */
export interface Case { 단위: string; 답: string; 판정: 'O' | 'X'; 일시: string; 출처: string }

/** 그림에서 가릴 영역. 쪽 크기에 대한 비율(0~1) */
export interface MaskRect { x: number; y: number; w: number; h: number }

export interface AnswerKey {
  세트: string;
  글: string;
  학기: string;
  대상: { 학년: number; 반: number[]; 인원?: Record<string, number> };
  확인?: { 완료: boolean; 일시?: string };
  정량: QtyUnit[];
  정성: QualUnit[];
  채점규칙?: Partial<GradingRules>;
  사례?: Case[];
  /** 있으면 전사 때 이 영역을 가린 사본을 보낸다 */
  이름가림?: MaskRect;
  /** 문항별 검토의 그림 보기에서 칠할 학생 정보 영역. 없으면 DEFAULT_IDENTITY_MASK(key.ts) */
  신원가림?: MaskRect;
  /**
   * 문항별 검토에서 손글씨를 잘라 보일 단위별 답 칸(단위 id → 쪽 비율 영역). 한 세트는 같은 양식이라 한 장에서 잡은 자리를 모든 장에 쓴다.
   * 단위 안이 아니라 여기 두는 까닭: 문항 설정 저장은 단위를 새로 조립하고, 확인 표시를 지우는 기준은 정량·정성만 본다
   */
  답영역?: Record<string, MaskRect>;
}

export interface TranscribeInfo { 엔진: 'cli' | 'api' | 'codex' | 'gemini' | 'openai' | '사람'; 모델: string; effort: string; 규칙: string; 일시: string }

export interface Transcript {
  page: number;
  학년: number | null; 반: number | null; 번호: number | null; 이름: string | null;
  식별확신: Hwaksin;
  정량: Record<string, { 답: string; 판정: Panjeong }>;
  정성: Record<string, { 응답: boolean; 답: string }>;
  비고: string[];
  확인완료?: boolean;
  /** 문항별 검토에서 확인한 단위 id. 모든 단위를 확인하면 확인완료도 켠다 */
  확인단위?: string[];
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

/** 채점 실행에서 올린 파일의 기록. 같은 파일을 다시 올리면 지문(SHA-256)으로 알아본다 */
export interface UploadRecord { 이름: string; 크기: number; 지문: string; 장수: number; 시작: number; 끝: number; 일시: string }
