import { DEFAULT_EFFORT, DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, DEFAULT_OPENAI_MODEL, EFFORTS, GEMINI_MODELS, MODELS, OPENAI_MODELS, THEMES, type CliStatusView, type EffortLevel, type Language, type ModelId, type Profile, type Rotation, type SecretView, type Theme, type UpdateStatus } from '../../shared/ipc.js';
import { applyTheme, reloadTo, type Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';
import { t, type Key } from '../lib/i18n.js';
import { makeGuard } from '../lib/screen-utils.js';

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

function secretText(v: SecretView): string {
  if (!v.저장됨) return t('settings.secret.none');
  if (v.열림 === false) return t('settings.secret.locked');
  return t('settings.secret.saved', { last4: v.끝4자 ?? '' });
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  // 프로필 편집은 화면 안의 사본에서 하고 '프로필 저장'으로 한 번에 보낸다
  let profiles: Profile[] = store.state.settings.프로필.map(p => ({ ...p }));
  let 사용중 = store.state.settings.사용중;
  let dirty = false;
  // 단추 옆 글은 고른 프로필만 '사용 중', 나머지는 '사용하기'(전에는 모든 카드에 '사용 중'이 붙어 헷갈렸다).
  // 고르면 다시 그리지 않고 글과 카드 테두리만 바꾼다. 다시 그리면 CLI 상태 점검이 또 돈다
  const useMarks = new Map<string, { text: HTMLElement; card: HTMLElement }>();
  const markInUse = (): void => {
    for (const [id, m] of useMarks) { const on = id === 사용중; m.text.textContent = t(on ? 'settings.inUse' : 'settings.useThis'); m.card.classList.toggle('in-use', on); }
  };

  const guard = makeGuard(showError);
  const persist = async () => {
    const s = await api.saveSettings({ 프로필: profiles, 사용중 });
    store.update({ settings: s });
    dirty = false; // 카드가 쥔 프로필 객체를 그대로 쓰도록 사본을 바꾸지 않는다
  };

  const semesterBox = el('div');
  const rosterBox = el('div');
  const rotationBox = el('div');
  const profileBox = el('div');
  const saveProfilesBtn = el('button', { class: 'primary', onclick: () => guard(async () => { await persist(); showInfo(t('settings.profilesSaved')); renderProfiles(); }) }, t('settings.saveProfiles'));
  const versionText = el('span');
  const updateBox = el('div');

  function renderUpdate(s: UpdateStatus): void {
    clear(updateBox);
    const busy = s.kind === 'checking' || s.kind === 'downloading';
    const manual = s.kind === 'disabled' && s.reason === 'manual'; // 서명 없는 맥 시험판: 새 버전은 릴리스 페이지에서 직접 받는다
    const auto = el('input', { type: 'checkbox', checked: store.state.settings.자동업데이트, disabled: s.kind === 'disabled' && s.reason === 'dev',
      onchange: () => guard(async () => { store.update({ settings: await api.saveSettings({ 자동업데이트: auto.checked }) }); renderUpdate(await api.updateStatus()); }) });
    updateBox.append(el('h3', {}, t('settings.update.title')),
      el('div', { class: 'row' }, el('span', {}, updateText(s)),
        manual ? el('button', { onclick: () => guard(() => api.openExternal('releases')) }, t('settings.update.openReleases'))
          : s.kind === 'available' ? el('button', { class: 'primary', onclick: () => guard(() => api.downloadUpdate()) }, t('settings.update.download'))
          : s.kind === 'downloaded' ? el('button', { class: 'primary', onclick: () => guard(() => api.installUpdate()) }, t('settings.update.install'))
          : el('button', { disabled: busy || s.kind === 'disabled', onclick: () => guard(() => api.checkUpdate()) }, t('settings.update.check'))),
      ...(s.kind === 'available' ? [el('div', { class: 'muted' }, t('settings.update.downloadNote'))] : []),
      ...(manual ? [] : [el('div', { class: 'row' }, el('label', {}, auto, t('settings.update.auto'))), el('div', { class: 'muted' }, t('settings.update.note'))]));
  }

  function renderBasics(): void {
    const s = store.state.settings;
    clear(semesterBox);
    semesterBox.append(el('div', { class: 'row' }, t('settings.semester'), s.학기폴더 ? el('span', { class: 'path' }, s.학기폴더) : el('span', { class: 'muted' }, t('settings.notChosen')),
      el('button', { onclick: () => guard(async () => {
        const p = await api.pickFolder(); if (!p) return;
        store.update({ settings: await api.saveSettings({ 학기폴더: p }), current: null });
        await store.refreshSets(); renderBasics(); showInfo(t('settings.semesterChanged'));
      }) }, t('settings.choose'))),
      ...(s.학기폴더 ? [] : [el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => guard(async () => {
        const p = await api.makeDefaultSemester();
        store.update({ settings: await api.getSettings(), current: null });
        await store.refreshSets(); renderBasics(); showInfo(t('settings.defaultMade', { path: p }));
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
    // 언어는 저장한 뒤 화면을 다시 그려야 모든 글이 바뀐다. reload 뒤 설정 탭으로 돌아온다
    const langSel = el('select', { onchange: () => guard(async () => { await api.saveSettings({ 언어: langSel.value as Language }); reloadTo('settings'); }) },
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
    const nameInput = el('input', { value: p.이름, onchange: () => { p.이름 = nameInput.value; dirty = true; } });
    const useText = el('span');
    useMarks.set(p.id, { text: useText, card });
    card.append(el('div', { class: 'row' },
      el('label', {}, el('input', { type: 'radio', name: 'using', checked: 사용중 === p.id, onchange: () => { 사용중 = p.id; dirty = true; markInUse(); } }), useText),
      nameInput, el('span', { class: 'muted' }, t(`settings.kind.${p.종류}`)),
      p.id === DEFAULT_ID ? null : el('button', { class: 'danger', onclick: () => {
        if (!confirm(t('settings.deleteProfileConfirm', { name: p.이름 }))) return;
        profiles = profiles.filter(x => x.id !== p.id); if (사용중 === p.id) 사용중 = DEFAULT_ID; dirty = true; renderProfiles();
      } }, t('common.delete'))), status);
    // 모델·노력: 프로필마다 고른다(전사·초안·재판정에 같이 쓰임). Codex 모델은 정해진 목록이 없어 이름을 직접 적는다
    const codex = p.종류 === 'codex', gemini = p.종류 === 'gemini', openai = p.종류 === 'openai';
    let modelCtl: HTMLElement;
    if (gemini) {
      const gemSel = el('select', { onchange: () => { p.모델 = gemSel.value; dirty = true; } },
        ...GEMINI_MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_GEMINI_MODEL) === m }, t(m === GEMINI_MODELS[0] ? 'settings.gemini.model.argon' : 'settings.gemini.model.flash'))));
      modelCtl = gemSel;
    } else if (openai) {
      const oaSel = el('select', { onchange: () => { p.모델 = oaSel.value; dirty = true; } },
        ...OPENAI_MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_OPENAI_MODEL) === m }, t(m === OPENAI_MODELS[0] ? 'settings.openai.model.astra' : 'settings.openai.model.sol'))));
      modelCtl = oaSel;
    } else if (codex) {
      const modelInput = el('input', { value: p.모델 ?? '', placeholder: t('settings.codex.modelPlaceholder'), onchange: () => { const v = modelInput.value.trim(); if (v) p.모델 = v; else delete p.모델; dirty = true; } });
      modelInput.size = 22;
      modelCtl = modelInput;
    } else {
      const modelSel = el('select', { onchange: () => { p.모델 = modelSel.value as ModelId; dirty = true; } },
        ...MODELS.map(m => el('option', { value: m, selected: (p.모델 ?? DEFAULT_MODEL) === m }, m === 'claude-opus-5-5' ? t('settings.model.opus') : t('settings.model.sonnet'))));
      modelCtl = modelSel;
    }
    const effortSel = el('select', { onchange: () => { p.노력 = effortSel.value as EffortLevel; dirty = true; } },
      ...EFFORTS.map(e => el('option', { value: e, selected: (p.노력 ?? DEFAULT_EFFORT) === e }, t(`settings.effort.${e}` as Parameters<typeof t>[0]))));
    card.append(el('div', { class: 'row' }, t('settings.model'), modelCtl, t('settings.effort'), effortSel), el('div', { class: 'muted' }, t(codex ? 'settings.codex.modelHelp' : gemini ? 'settings.gemini.modelHelp' : openai ? 'settings.openai.modelHelp' : 'settings.modelHelp')));

    if (p.종류 === 'cli' || codex) {
      const autoFound = el('span', { class: 'muted' }, t('settings.autoFind'));
      const check = () => guard(async () => {
        if (dirty) await persist(); // 메인은 저장된 프로필로 점검한다
        status.textContent = t('settings.checking');
        try {
          const s = await api.cliStatus(p.id);
          status.textContent = cliStatusText(s);
          if (!p.cliPath) autoFound.textContent = s.command ? t('settings.autoFound', { path: s.command }) : t('settings.autoFind');
        } catch (e) { status.textContent = (e as Error).message; }
      });
      card.append(
        el('div', { class: 'band info' }, t(codex ? 'settings.codex.howto' : 'settings.cli.howto')),
        ...(codex ? [el('div', { class: 'band warn' }, t('settings.codex.privacy'))] : []),
        el('div', { class: 'row' }, t(codex ? 'settings.codex.file' : 'settings.cliFile'), p.cliPath ? el('span', { class: 'path' }, p.cliPath) : autoFound,
          el('button', { onclick: () => guard(async () => { const f = await api.pickFile('exe'); if (!f) return; p.cliPath = f; dirty = true; renderProfiles(); }) }, t('settings.pickCliFile')),
          el('button', { disabled: !p.cliPath, onclick: () => { delete p.cliPath; dirty = true; renderProfiles(); } }, t('settings.toAutoFind'))),
        el('div', { class: 'row' }, t('settings.configDir'), p.configDir ? el('span', { class: 'path' }, p.configDir) : el('span', { class: 'muted' }, t('settings.defaultDir')),
          el('button', { onclick: () => guard(async () => { const f = await api.pickFolder(); if (!f) return; p.configDir = f; dirty = true; renderProfiles(); }) }, t('settings.pickConfigDir')),
          el('button', { disabled: !p.configDir, onclick: () => { delete p.configDir; dirty = true; renderProfiles(); } }, t('settings.toDefaultDir'))),
        el('div', { class: 'muted' }, t(codex ? 'settings.codex.configDirHelp' : 'settings.configDirHelp')),
        el('div', { class: 'row' },
          el('button', { onclick: () => guard(async () => {
            if (dirty) await persist();
            const r = await api.cliLogin(p.id);
            if (r.ok) showInfo(t('settings.loginOpened')); else showError(r.message ?? t('settings.loginFailed'));
          }) }, t('settings.openLogin')),
          el('button', { onclick: check }, t('settings.checkAgain')),
          el('button', { onclick: () => guard(() => api.openExternal(codex ? 'codexInstall' : 'install')) }, t('settings.installGuide'))));
      if (store.state.settings.프로필.some(x => x.id === p.id)) void check(); else status.textContent = t('settings.unsavedProfile');
    } else {
      const showSecret = () => guard(async () => { status.textContent = secretText(await api.secretView(p.id)); });
      const keyInput = el('input', { type: 'password', autocomplete: 'off', placeholder: gemini ? 'AIza…' : openai ? 'sk-…' : 'sk-ant-…' });
      keyInput.size = 40;
      card.append(...(gemini ? [el('div', { class: 'band warn' }, t('settings.gemini.privacy'))] : openai ? [el('div', { class: 'band info' }, t('settings.openai.privacy'))] : []),
        el('div', { class: 'row' }, keyInput,
          el('button', { onclick: () => guard(async () => {
            const v = keyInput.value; keyInput.value = ''; // 값은 화면 상태에 남기지 않는다
            if (dirty) await persist();
            status.textContent = secretText(await api.secretSet(p.id, v)); showInfo(t('settings.keySaved'));
          }) }, t('common.save')),
          el('button', { onclick: () => guard(async () => { if (dirty) await persist(); status.textContent = t('settings.testing'); const r = await api.secretTest(p.id); status.textContent = r.message; if (!r.ok) showError(r.message); }) }, t('settings.test')),
          el('button', { class: 'danger', onclick: () => guard(async () => { if (!confirm(t('settings.clearKeyConfirm'))) return; await api.secretClear(p.id); await showSecret(); }) }, t('settings.clearKey')),
          ...(gemini || openai ? [el('button', { onclick: () => guard(() => api.openExternal(gemini ? 'geminiKey' : 'openaiKey')) }, t('settings.getKey'))] : [])),
        el('div', { class: 'muted' }, t(gemini ? 'settings.gemini.keyHelp' : openai ? 'settings.openai.keyHelp' : 'settings.keyHelp')));
      void showSecret();
    }
    return card;
  }

  function renderProfiles(): void {
    clear(profileBox);
    useMarks.clear();
    for (const p of profiles) profileBox.append(profileCard(p));
    markInUse();
    const newName = el('input', { placeholder: t('settings.newProfileName') });
    const newKind = el('select', {}, el('option', { value: 'cli' }, t('settings.kind.cli')), el('option', { value: 'codex' }, t('settings.kind.codex')), el('option', { value: 'gemini' }, t('settings.kind.gemini')), el('option', { value: 'openai' }, t('settings.kind.openai')), el('option', { value: 'api' }, t('settings.kind.api')));
    profileBox.append(el('div', { class: 'row' }, newName, newKind, el('button', { onclick: () => {
      const 이름 = newName.value.trim(); if (!이름) { showError(t('settings.newProfileNameMissing')); return; }
      const 종류 = newKind.value as Profile['종류'];
      profiles.push({ id: `${종류}-${Date.now().toString(36)}`, 이름, 종류 }); dirty = true; renderProfiles();
    } }, t('settings.addProfile')), saveProfilesBtn));
    profileBox.append(el('div', { class: 'band info' }, t('settings.cliNotice')));
  }

  root.append(el('h2', {}, t('settings.title')),
    el('section', {}, semesterBox, rosterBox, rotationBox),
    el('section', {}, el('h2', {}, t('settings.profiles')), el('div', { class: 'band info' }, t('settings.aiNotice')), profileBox),
    el('section', {}, el('h2', {}, t('settings.about')),
      el('div', { class: 'row' }, t('settings.version'), versionText,
        el('button', { onclick: () => guard(() => api.openExternal('guide')) }, t('settings.guide')),
        el('button', { onclick: () => guard(() => api.openExternal('privacy')) }, t('settings.privacy'))),
      updateBox));
  renderBasics();
  renderProfiles();
  api.version().then(v => { versionText.textContent = v; }, () => undefined);
  api.updateStatus().then(renderUpdate, () => undefined);
  api.onUpdate(renderUpdate);
}
