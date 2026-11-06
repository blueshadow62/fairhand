/** exceljs는 읽는 데 1초 넘게 걸려(기동 시간의 절반) 엑셀을 처음 만들거나 읽을 때 불러온다 */
export const loadExcel = () => import('exceljs').then(m => m.default);
