import { DEFAULT_EFFORT, DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, DEFAULT_OPENAI_MODEL, EFFORTS, GEMINI_MODELS, MODELS, OPENAI_MODELS, THEMES, type CliStatusView, type EffortLevel, type Language, type ModelId, type Profile, type Rotation, type SecretView, type Theme, type UpdateStatus } from '../../shared/ipc.js';
import { applyTheme, reloadTo, type Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t, type Key } from '../lib/i18n.js';
import { makeGuard, makeLeaveGuard } from '../lib/screen-utils.js';
import { advancedOpenAtStart, serialSaver } from '../lib/settings-form.js';

function updateText(s: UpdateStatus): string {
  if (s.kind === 'disabled') return s.reason === 'dev' ? t('settings.update.dev') : s.reason === 'manual' ? t('settings.update.manual') : t('settings.update.status.off');
  return t(`settings.update.status.${s.kind}` as Key, { version: 'version' in s ? s.version : '', percent: 'percent' in s ? s.percent : '' });
}

const DEFAULT_ID = 'cli-default';

export function cliStatusText(s: CliStatusView): string {
  if (!s.installed) return t('settings.cli.notInstalled');
  const v = t('settings.cli.installed', { version: s.version ?? t('settings.cli.unknownVersion') });
  if (s.tooOld) return t('settings.cli.tooOld', { v, min: s.minVersion ?? '' });
  if (s.loggedIn) return t('settings.cli.loggedIn', { v, sub: s.subscriptionType ? t('settings.cli.subscription', { type: s.subscriptionType }) : '' });
  return t('settings.cli.loginNeeded', { v });
}

/** 문서\글눈 아래 학기 폴더를 만들어 학기 폴더로 정하고 세트 목록을 다시 읽는다. 시작 화면의 '지금 상태'도 이것을 쓴다 */
export async function createDefaultSemester(store: Ctx['store']): Promise<string> {
  const p = await api.makeDefaultSemester();
  store.update({ settings: await api.getSettings(), current: null });
  await store.refreshSets();
  return p;
}

function secretText(v: SecretView): string {
  if (!v.저장됨) return t('settings.secret.none');
  if (v.열림 === false) return t('settings.secret.locked');
  return t('settings.secret.saved', { last4: v.끝4자 ?? '' });
}

/** 칸 바로 아래의 짧은 알림(검사에 걸려 저장하지 않은 까닭). 빈 글이면 숨긴다 */
function note(node: HTMLElement, text: string): void { node.textContent = text; node.classList.toggle('hidden', !text); }
/** 한글 조합을 마치는 Enter는 빼고 본다. 그 Enter로 저장하면 마지막 글자가 빠질 수 있다 */
const isEnter = (e: Event): boolean => (e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).isComposing;

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  // 프로필도 다른 설정처럼 바꾸면 바로 저장한다. 화면 안의 사본을 고친 뒤 목록을 통째로 보낸다
  let profiles: Profile[] = store.state.settings.프로필.map(p => ({ ...p }));
  let 사용중 = store.state.settings.사용중;
  // 단추 옆 글은 고른 프로필만 '사용 중', 나머지는 '사용하기'(전에는 모든 카드에 '사용 중'이 붙어 헷갈렸다).
  // 고르면 다시 그리지 않고 글과 카드 테두리만 바꾼다. 다시 그리면 CLI 상태 점검이 또 돈다
  const useMarks = new Map<string, { radio: HTMLInputElement; text: HTMLElement; card: HTMLElement }>();
  const markInUse = (): void => {
    for (const [id, m] of useMarks) { const on = id === 사용중; m.radio.checked = on; m.text.textContent = t(on ? 'settings.inUse' : 'settings.useThis'); m.card.classList.toggle('in-use', on); }
  };
  // 카드를 다시 그려도 사용자가 열거나 닫은 '고급'은 그대로 둔다(프로필 id별)
  const advancedOpen = new Map<string, boolean>();

  const guard = makeGuard(showError);
  // 카드가 쥔 프로필 객체를 그대로 쓰도록 저장한 뒤에도 사본은 바꾸지 않는다
  const saver = serialSaver(async () => { store.update({ settings: await api.saveSettings({ 프로필: profiles, 사용중 }) }); });
  let saveError: string | null = null; // 마지막 저장이 실패해 화면과 설정 파일이 다르다. 다음 변경이나 '다시 저장'이 사본을 다시 보낸다
  const failText = el('span');
  const failBand = el('div', { class: 'band error row hidden', role: 'alert' }, failText, el('button', { onclick: () => void commit() }, t('settings.saveAgain')));
  function setSaveError(message: string | null): void {
    saveError = message;
    failText.textContent = message === null ? '' : t('settings.profileSaveFailed', { error: message });
    failBand.classList.toggle('hidden', message === null);
  }
  async function commit(): Promise<boolean> {
    try { await saver.run(); setSaveError(null); return true; }
    catch (e) { const m = (e as Error).message; setSaveError(m); showError(t('settings.profileSaveFailed', { error: m })); return false; }
  }
  /** 메인은 저장된 프로필로 점검·로그인·연결 확인을 하므로 밀린 저장을 마친 뒤 부른다 */
  async function synced(): Promise<void> {
    await saver.idle();
    if (saveError !== null) await commit();
  }

  // API 키는 비밀이라 바로 저장하지 않고 '저장'(또는 Enter)을 눌렀을 때만 보관한다. 적어 둔 채 저장하지 않은 키나
  // 저장하지 못한 프로필 변경이 있으면 이 화면을 떠날 때 묻는다
  const keyDrafts = new Map<string, { input: HTMLInputElement; save(): Promise<void>; mark(): void }>();
  const leaveOk = makeLeaveGuard(api, {
    isDirty: () => saveError !== null || [...keyDrafts.values()].some(k => k.input.value !== ''),
    save: async () => {
      if (saveError !== null) await commit();
      for (const k of keyDrafts.values()) if (k.input.value) await k.save();
    },
    discard: () => {
      for (const k of keyDrafts.values()) { k.input.value = ''; k.mark(); }
      if (saveError === null) return;
      profiles = store.state.settings.프로필.map(p => ({ ...p })); 사용중 = store.state.settings.사용중; // 저장된 값으로 되돌린다
      setSaveError(null); renderProfiles();
    },
  });
  ctx.setLeaveGuard(leaveOk);

  const semesterBox = el('div');
  const rosterBox = el('div');
  const rotationBox = el('div');
  const profileBox = el('div');
  const versionText = el('span');
  const updateBox = el('div', { 'data-section': 'update' }); // 맨 위 '새 업데이트' 알림을 누르면 여기로 스크롤

  function renderUpdate(s: UpdateStatus): void {
    clear(updateBox);
    const busy = s.kind === 'checking' || s.kind === 'downloading';
    const manual = s.kind === 'disabled' && s.reason === 'manual'; // 서명 없는 맥 시험판: 새 버전은 릴리스 페이지에서 직접 받는다
    const dev = s.kind === 'disabled' && s.reason === 'dev';
    const auto = el('input', { type: 'checkbox', checked: store.state.settings.자동업데이트, disabled: dev,
      onchange: () => guard(async () => { store.update({ settings: await api.saveSettings({ 자동업데이트: auto.checked }) }); renderUpdate(await api.updateStatus()); }) });
    // 받아 두기는 자동 확인이 켜져 있을 때만 뜻이 있다(메인도 둘 다 켜졌을 때만 받는다)
    const autoInstall = el('input', { type: 'checkbox', checked: store.state.settings.자동설치, disabled: dev || !store.state.settings.자동업데이트,
      onchange: () => guard(async () => { store.update({ settings: await api.saveSettings({ 자동설치: autoInstall.checked }) }); renderUpdate(await api.updateStatus()); }) });
    const willInstallOnQuit = s.kind === 'downloaded' && store.state.settings.자동업데이트 && store.state.settings.자동설치;
    updateBox.append(el('h3', {}, t('settings.update.title')),
      el('div', { class: 'row' }, el('span', {}, updateText(s)),
        manual ? el('button', { onclick: () => guard(() => api.openExternal('releases')) }, t('settings.update.openReleases'))
          : s.kind === 'available' ? el('button', { class: 'primary', onclick: () => guard(() => api.downloadUpdate()) }, t('settings.update.download'))
          : s.kind === 'downloaded' ? el('button', { class: 'primary', onclick: () => guard(() => api.installUpdate()) }, t('settings.update.install'))
          : el('button', { disabled: busy || (s.kind === 'disabled' && s.reason !== 'off'), onclick: () => guard(() => api.checkUpdate()) }, t('settings.update.check'))),
      ...(s.kind === 'available' ? [el('div', { class: 'muted' }, t('settings.update.downloadNote'))] : []),
      ...(willInstallOnQuit ? [el('div', { class: 'muted' }, t('settings.update.installOnQuit'))] : []),
      ...(manual ? [] : [el('div', { class: 'row' }, el('label', {}, auto, t('settings.update.auto'))),
        el('div', { class: 'row sub' }, el('label', {}, autoInstall, t('settings.update.autoInstall'))),
        el('div', { class: 'muted' }, t('settings.update.note'))]));
  }

  let shownSemester: string | null = null;
  function renderBasics(): void {
    const s = store.state.settings;
    shownSemester = s.학기폴더;
    clear(semesterBox);
    semesterBox.append(el('div', { class: 'row' }, t('settings.semester'), s.학기폴더 ? el('span', { class: 'path' }, s.학기폴더) : el('span', { class: 'muted' }, t('settings.notChosen')),
      el('button', { onclick: () => guard(async () => {
        const p = await api.pickFolder(); if (!p) return;
        store.update({ settings: await api.saveSettings({ 학기폴더: p }), current: null });
        await store.refreshSets(); showInfo(t('settings.semesterChanged'));
      }) }, t('settings.choose'))),
      ...(s.학기폴더 ? [] : [el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => guard(async () => {
        showInfo(t('settings.defaultMade', { path: await createDefaultSemester(store) }));
      }) }, t('settings.makeDefault')))]),
      el('div', { class: 'muted' }, t('settings.semesterHelp')));
    clear(rosterBox);
    rosterBox.append(el('div', { class: 'row' }, t('settings.roster'), s.명단 ? el('span', { class: 'path' }, s.명단) : el('span', { class: 'muted' }, t('settings.none')),
      el('button', { onclick: () => guard(async () => { const p = await api.pickFile('roster'); if (!p) return; store.update({ settings: await api.saveSettings({ 명단: p }) }); renderBasics(); }) }, t('settings.choose')),
      el('button', { disabled: !s.명단, onclick: () => guard(async () => { store.update({ settings: await api.saveSettings({ 명단: null }) }); renderBasics(); }) }, t('settings.clear'))),
      el('div', { class: 'band warn' }, t('settings.rosterWarn')),
      el('div', { class: 'muted' }, t('settings.rosterHelp')));
    clear(rotationBox);
    const radios = ([0, 90, 180, 270] as Rotation[]).map(r => el('label', {}, el('input', { type: 'radio', name: 'rot', checked: s.기본회전 === r,
      onchange: () => guard(async () => { store.update({ settings: await api.saveSettings({ 기본회전: r }) }); }) }), `${r}°`));
    rotationBox.append(el('div', { class: 'row' }, t('settings.rotation'), ...radios));
    // 언어는 저장한 뒤 화면을 다시 그려야 모든 글이 바뀐다. reload 뒤 설정 탭으로 돌아온다.
    // 다시 불러오면 적어 두고 저장하지 않은 API 키가 사라지므로 떠날 때처럼 먼저 묻는다
    const langSel = el('select', { onchange: () => guard(async () => {
      if (!(await leaveOk())) { langSel.value = s.언어; return; }
      await api.saveSettings({ 언어: langSel.value as Language }); reloadTo('settings');
    }) },
      el('option', { value: 'ko', selected: s.언어 !== 'en' }, '한국어'), el('option', { value: 'en', selected: s.언어 === 'en' }, 'English'));
    rotationBox.append(el('div', { class: 'row' }, t('settings.language'), langSel, el('span', { class: 'muted' }, t('settings.languageHelp'))));
    // 화면 색은 CSS 변수만 바뀌므로 다시 불러오지 않고 고르는 즉시 칠한 뒤 저장한다
    const themeSel = el('select', { onchange: () => guard(async () => {
      const v = themeSel.value as Theme;
      applyTheme(v);
      store.update({ settings: await api.saveSettings({ 화면색: v }) });
    }) }, ...THEMES.map(v => el('option', { value: v, selected: s.화면색 === v }, t(`settings.theme.${v}` as Key))));
    rotationBox.append(el('div', { class: 'row' }, t('settings.theme'), themeSel, el('span', { class: 'muted' }, t('settings.themeHelp'))));
  }

  function profileCard(p: Profile): HTMLElement {
    const status = el('div', { class: 'muted' }, t('settings.checking'));
    const card = el('div', { class: 'card' });
    cards.set(p.id, card);
    // 이름은 Enter를 누르거나 칸을 벗어날 때 저장한다. 빈 이름은 메인이 목록 전체의 저장을 거절하므로 보내지 않고 되돌린다
    const nameNote = el('div', { class: 'field-note hidden', role: 'alert' });
    const commitName = (): void => {
      const v = nameInput.value.trim();
      if (!v) { nameInput.value = p.이름; note(nameNote, t('settings.nameEmpty')); return; }
      nameInput.value = v; note(nameNote, '');
      if (v === p.이름) return;
      p.이름 = v; void commit();
    };
    const nameInput = el('input', { value: p.이름, 'aria-label': t('settings.profileName'), onchange: commitName, oninput: () => note(nameNote, ''), onkeydown: (e: Event) => { if (isEnter(e)) commitName(); } });
    const radio = el('input', { type: 'radio', name: 'using', checked: 사용중 === p.id, onchange: () => { 사용중 = p.id; markInUse(); void commit(); } });
    const useText = el('span');
    useMarks.set(p.id, { radio, text: useText, card });
    card.append(el('div', { class: 'row' },
      el('label', {}, radio, useText),
      nameInput, el('span', { class: 'muted' }, t(`settings.kind.${p.종류}`)),
      p.id === DEFAULT_ID ? null : el('button', { class: 'danger', onclick: () => {
        if (!confirm(t('settings.deleteProfileConfirm', { name: p.이름 }))) return;
        profiles = profiles.filter(x => x.id !== p.id); if (사용중 === p.id) 사용중 = DEFAULT_ID;
        dropCard(p.id); markInUse(); void commit();
      } }, t('common.delete'))), nameNote, status);
    // 모델·노력: 프로필마다 고른다(전사·초안·재판정에 같이 쓰임). Codex 모델은 정해진 목록이 없어 이름을 직접 적는다
    const codex = p.종류 === 'codex', gemini = p.종류 === 'gemini', openai = p.종류 === 'openai';
    const modelNote = el('div', { class: 'field-note hidden', role: 'alert' });
    let modelCtl: HTMLElement;
    if (gemini) {
      const gemSel = el('select', { onchange: () => { p.모델 = gemSel.value; void commit(); } },
        ...GEMINI_MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_GEMINI_MODEL) === m }, t(m === GEMINI_MODELS[0] ? 'settings.gemini.model.argon' : 'settings.gemini.model.flash'))));
      modelCtl = gemSel;
    } else if (openai) {
      const oaSel = el('select', { onchange: () => { p.모델 = oaSel.value; void commit(); } },
        ...OPENAI_MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_OPENAI_MODEL) === m }, t(m === OPENAI_MODELS[0] ? 'settings.openai.model.astra' : 'settings.openai.model.sol'))));
      modelCtl = oaSel;
    } else if (codex) {
      // 메인은 명령줄에 안전한 글자가 아닌 모델 이름을 버리고 저장한다(main/settings.ts parseProfile). 버려졌으면 칸을 저장된 값으로 되돌리고 알린다
      const commitModel = async (): Promise<void> => {
        const v = modelInput.value.trim();
        modelInput.value = v;
        if (v === (p.모델 ?? '')) return;
        if (v) p.모델 = v; else delete p.모델;
        note(modelNote, '');
        if (!(await commit())) return;
        const kept = store.state.settings.프로필.find(x => x.id === p.id)?.모델;
        if (kept === p.모델) return;
        if (kept) p.모델 = kept; else delete p.모델;
        modelInput.value = kept ?? ''; note(modelNote, t('settings.codex.modelRejected'));
      };
      const modelInput = el('input', { value: p.모델 ?? '', placeholder: t('settings.codex.modelPlaceholder'), onchange: () => void commitModel(), oninput: () => note(modelNote, ''), onkeydown: (e: Event) => { if (isEnter(e)) void commitModel(); } });
      modelInput.size = 22;
      modelCtl = modelInput;
    } else {
      const modelSel = el('select', { onchange: () => { p.모델 = modelSel.value as ModelId; void commit(); } },
        ...MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_MODEL) === m }, m === 'claude-opus-5-5' ? t('settings.model.opus') : t('settings.model.sonnet'))));
      modelCtl = modelSel;
    }
    const effortSel = el('select', { onchange: () => { p.노력 = effortSel.value as EffortLevel; void commit(); } },
      ...EFFORTS.map(e => el('option', { value: e, selected: (p.노력 ?? DEFAULT_EFFORT) === e }, t(`settings.effort.${e}` as Parameters<typeof t>[0]))));
    card.append(el('div', { class: 'row' }, t('settings.model'), modelCtl, t('settings.effort'), effortSel), modelNote, el('div', { class: 'muted' }, t(codex ? 'settings.codex.modelHelp' : gemini ? 'settings.gemini.modelHelp' : openai ? 'settings.openai.modelHelp' : 'settings.modelHelp')));

    if (p.종류 === 'cli' || codex) {
      const autoFound = el('span', { class: 'muted' }, t('settings.autoFind'));
      const check = () => guard(async () => {
        status.textContent = t('settings.checking');
        await synced(); // 메인은 저장된 프로필로 점검한다
        if (!store.state.settings.프로필.some(x => x.id === p.id)) { status.textContent = t('settings.unsavedProfile'); return; }
        try {
          const s = await api.cliStatus(p.id);
          status.textContent = cliStatusText(s);
          if (!p.cliPath) autoFound.textContent = s.command ? t('settings.autoFound', { path: s.command }) : t('settings.autoFind');
        } catch (e) { status.textContent = (e as Error).message; }
      });
      // 경로는 카드를 다시 그리지 않고 그 자리에서 바꾼다(누른 단추에 초점이 남게). 바꾸면 저장하고 그 경로로 다시 점검한다
      const filePath = el('span', { class: 'path' }), dirPath = el('span', { class: 'path' }), defaultDir = el('span', { class: 'muted' }, t('settings.defaultDir'));
      const toAuto = el('button', { onclick: () => { delete p.cliPath; pathChanged(); } }, t('settings.toAutoFind'));
      const toDefault = el('button', { onclick: () => { delete p.configDir; pathChanged(); } }, t('settings.toDefaultDir'));
      const showPaths = (): void => {
        filePath.textContent = p.cliPath ?? ''; filePath.classList.toggle('hidden', !p.cliPath); autoFound.classList.toggle('hidden', !!p.cliPath); toAuto.disabled = !p.cliPath;
        dirPath.textContent = p.configDir ?? ''; dirPath.classList.toggle('hidden', !p.configDir); defaultDir.classList.toggle('hidden', !!p.configDir); toDefault.disabled = !p.configDir;
      };
      const pathChanged = (): void => { autoFound.textContent = t('settings.autoFind'); showPaths(); void commit(); void check(); };
      showPaths();
      // 실행 파일·설정 폴더는 처음 쓰는 사람에게 필요 없어 '고급'으로 접는다. 직접 고른 경로가 있으면 무엇을 쓰는지 보이게 펼친 채로
      const advanced = el('details', { class: 'advanced', open: advancedOpen.get(p.id) ?? advancedOpenAtStart(p), ontoggle: () => advancedOpen.set(p.id, advanced.open) },
        el('summary', {}, t('settings.advanced'), el('span', { class: 'muted' }, t('settings.advancedHint'))),
        el('div', { class: 'row' }, t(codex ? 'settings.codex.file' : 'settings.cliFile'), filePath, autoFound,
          el('button', { onclick: () => guard(async () => { const f = await api.pickFile('exe'); if (!f) return; p.cliPath = f; pathChanged(); }) }, t('settings.pickCliFile')), toAuto),
        el('div', { class: 'row' }, t('settings.configDir'), dirPath, defaultDir,
          el('button', { onclick: () => guard(async () => { const f = await api.pickFolder(); if (!f) return; p.configDir = f; pathChanged(); }) }, t('settings.pickConfigDir')), toDefault),
        el('div', { class: 'muted' }, t(codex ? 'settings.codex.configDirHelp' : 'settings.configDirHelp')));
      card.append(
        el('div', { class: 'band info' }, t(codex ? 'settings.codex.howto' : 'settings.cli.howto')),
        ...(codex ? [el('div', { class: 'band warn' }, t('settings.codex.privacy'))] : []),
        el('div', { class: 'row' },
          el('button', { onclick: () => guard(async () => {
            await synced();
            const r = await api.cliLogin(p.id);
            if (r.ok) showInfo(t('settings.loginOpened')); else showError(r.message ?? t('settings.loginFailed'));
          }) }, t('settings.openLogin')),
          el('button', { onclick: check }, t('settings.checkAgain')),
          el('button', { onclick: () => guard(() => api.openExternal(codex ? 'codexInstall' : 'install')) }, t('settings.installGuide'))),
        advanced);
      void check();
    } else {
      const showSecret = () => guard(async () => { status.textContent = secretText(await api.secretView(p.id)); });
      // 적어 두고 아직 '저장'하지 않은 키는 칸 옆에 표시한다(떠날 때 묻는 기준과 같다)
      const unsaved = el('span', { class: 'unsaved hidden' }, t('settings.keyUnsaved'));
      const mark = (): void => { unsaved.classList.toggle('hidden', keyInput.value === ''); };
      const saveKey = () => guard(async () => {
        const v = keyInput.value; keyInput.value = ''; mark(); // 값은 화면 상태에 남기지 않는다
        await synced();
        status.textContent = secretText(await api.secretSet(p.id, v)); showInfo(t('settings.keySaved'));
      });
      const keyInput = el('input', { type: 'password', autocomplete: 'off', placeholder: gemini ? 'AIza…' : openai ? 'sk-…' : 'sk-ant-…',
        oninput: mark, onkeydown: (e: Event) => { if (isEnter(e) && keyInput.value) void saveKey(); } });
      keyInput.size = 40;
      keyDrafts.set(p.id, { input: keyInput, save: saveKey, mark });
      card.append(...(gemini ? [el('div', { class: 'band warn' }, t('settings.gemini.privacy'))] : openai ? [el('div', { class: 'band info' }, t('settings.openai.privacy'))] : []),
        el('div', { class: 'row' }, keyInput, unsaved,
          el('button', { onclick: () => void saveKey() }, t('common.save')),
          el('button', { onclick: () => guard(async () => { await synced(); status.textContent = t('settings.testing'); const r = await api.secretTest(p.id); status.textContent = r.message; if (!r.ok) showError(r.message); }) }, t('settings.test')),
          el('button', { class: 'danger', onclick: () => guard(async () => { if (!confirm(t('settings.clearKeyConfirm'))) return; await api.secretClear(p.id); await showSecret(); }) }, t('settings.clearKey')),
          ...(gemini || openai ? [el('button', { onclick: () => guard(() => api.openExternal(gemini ? 'geminiKey' : 'openaiKey')) }, t('settings.getKey'))] : [])),
        el('div', { class: 'muted' }, t(gemini ? 'settings.gemini.keyHelp' : openai ? 'settings.openai.keyHelp' : 'settings.keyHelp')));
      void showSecret();
    }
    return card;
  }

  // 카드는 하나씩 넣고 뺀다. 목록을 통째로 다시 그리면 다른 카드에 적어 둔 API 키가 지워지고 CLI 점검도 다시 돈다
  const profileList = el('div');
  const cards = new Map<string, HTMLElement>();
  function renderProfiles(): void {
    clear(profileList); cards.clear(); useMarks.clear(); keyDrafts.clear();
    for (const p of profiles) profileList.append(profileCard(p));
    markInUse();
  }
  function dropCard(id: string): void {
    cards.get(id)?.remove();
    cards.delete(id); useMarks.delete(id); keyDrafts.delete(id); advancedOpen.delete(id);
  }
  const newName = el('input', { placeholder: t('settings.newProfileName') });
  const newKind = el('select', {}, el('option', { value: 'cli' }, t('settings.kind.cli')), el('option', { value: 'codex' }, t('settings.kind.codex')), el('option', { value: 'gemini' }, t('settings.kind.gemini')), el('option', { value: 'openai' }, t('settings.kind.openai')), el('option', { value: 'api' }, t('settings.kind.api')));
  profileBox.append(profileList,
    el('div', { class: 'row' }, newName, newKind, el('button', { onclick: () => {
      const 이름 = newName.value.trim(); if (!이름) { showError(t('settings.newProfileNameMissing')); return; }
      const 종류 = newKind.value as Profile['종류'];
      const p: Profile = { id: `${종류}-${Date.now().toString(36)}`, 이름, 종류 };
      profiles.push(p); newName.value = '';
      void commit(); // 새 카드의 CLI 점검은 이 저장이 끝나기를 기다린다
      profileList.append(profileCard(p)); markInUse();
    } }, t('settings.addProfile'))),
    el('div', { class: 'band info' }, t('settings.cliNotice')));

  root.append(el('h2', {}, t('settings.title')),
    el('section', {}, semesterBox, rosterBox, rotationBox),
    el('section', {}, el('h2', {}, t('settings.profiles')), el('div', { class: 'band info' }, t('settings.aiNotice')),
      el('div', { class: 'muted' }, t('settings.autoSaveNote')), failBand, profileBox),
    el('section', {}, el('h2', {}, t('settings.about')),
      el('div', { class: 'row' }, t('settings.version'), versionText,
        el('button', { onclick: () => guard(() => api.openExternal('guide')) }, t('settings.guide')),
        el('button', { onclick: () => guard(() => api.openExternal('privacy')) }, t('settings.privacy'))),
      updateBox));
  renderBasics();
  // 학기 폴더는 시작 화면의 '기본 폴더 만들기'로도 바뀐다. 이미 그려 둔 이 화면이 '고르지 않음'으로 남지 않게
  store.subscribe(s => { if (s.settings.학기폴더 !== shownSemester) renderBasics(); });
  renderProfiles();
  api.version().then(v => { versionText.textContent = v; }, () => undefined);
  api.updateStatus().then(renderUpdate, () => undefined);
  api.onUpdate(renderUpdate);
}
