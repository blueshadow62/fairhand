import type { CliStatusView, Profile, Rotation, SecretView } from '../../shared/ipc.js';
import type { Ctx } from '../app.js';
import { api } from '../lib/api.js';
import { clear, el } from '../lib/el.js';

const DEFAULT_ID = 'cli-default';

function cliStatusText(s: CliStatusView): string {
  if (!s.installed) return '설치되지 않음';
  const v = `설치됨 ${s.version ?? '(버전 모름)'}`;
  if (s.tooOld) return `${v} · 버전이 오래됨, 2.1.248 이상 필요`;
  if (s.loggedIn) return `${v} · 로그인됨${s.subscriptionType ? `(구독 ${s.subscriptionType})` : ''}`;
  return `${v} · 로그인 필요`;
}

function secretText(v: SecretView): string {
  if (!v.저장됨) return '저장된 키 없음';
  if (v.열림 === false) return '저장된 키를 이 PC에서 열 수 없습니다. 다시 입력하세요';
  return `저장됨 ····${v.끝4자 ?? ''}`;
}

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { store, showError, showInfo } = ctx;
  // 프로필 편집은 화면 안의 사본에서 하고 '프로필 저장'으로 한 번에 보낸다
  let profiles: Profile[] = store.state.settings.프로필.map(p => ({ ...p }));
  let 사용중 = store.state.settings.사용중;
  let dirty = false;

  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { showError((e as Error).message); } };
  const persist = async () => {
    const s = await api.saveSettings({ 프로필: profiles, 사용중 });
    store.update({ settings: s });
    dirty = false; // 카드가 쥔 프로필 객체를 그대로 쓰도록 사본을 바꾸지 않는다
  };

  const semesterBox = el('div');
  const rosterBox = el('div');
  const rotationBox = el('div');
  const profileBox = el('div');
  const saveProfilesBtn = el('button', { class: 'primary', onclick: () => guard(async () => { await persist(); showInfo('프로필을 저장했습니다'); renderProfiles(); }) }, '프로필 저장');
  const versionText = el('span');

  function renderBasics(): void {
    const s = store.state.settings;
    clear(semesterBox);
    semesterBox.append(el('div', { class: 'row' }, '학기 폴더: ', s.학기폴더 ? el('span', { class: 'path' }, s.학기폴더) : el('span', { class: 'muted' }, '고르지 않음'),
      el('button', { onclick: () => guard(async () => {
        const p = await api.pickFolder(); if (!p) return;
        store.update({ settings: await api.saveSettings({ 학기폴더: p }), current: null });
        await store.refreshSets(); renderBasics(); showInfo('학기 폴더를 바꿨습니다');
      }) }, '고르기')),
      el('div', { class: 'muted' }, '세트(글 하나)마다 이 폴더 아래에 폴더가 하나씩 생깁니다.'));
    clear(rosterBox);
    rosterBox.append(el('div', { class: 'row' }, '명단: ', s.명단 ? el('span', { class: 'path' }, s.명단) : el('span', { class: 'muted' }, '없음'),
      el('button', { onclick: () => guard(async () => { const p = await api.pickFile('roster'); if (!p) return; store.update({ settings: await api.saveSettings({ 명단: p }) }); renderBasics(); }) }, '고르기'),
      el('button', { disabled: !s.명단, onclick: () => guard(async () => { store.update({ settings: await api.saveSettings({ 명단: null }) }); renderBasics(); }) }, '지우기')),
      el('div', { class: 'muted' }, '명단이 없어도 학년·반·번호로 채점합니다. 명단은 xlsx 또는 csv(첫 줄에 학년, 반, 번호, 이름).'));
    clear(rotationBox);
    const radios = ([0, 90, 180, 270] as Rotation[]).map(r => el('label', {}, el('input', { type: 'radio', name: 'rot', checked: s.기본회전 === r,
      onchange: () => guard(async () => { store.update({ settings: await api.saveSettings({ 기본회전: r }) }); }) }), `${r}°`));
    rotationBox.append(el('div', { class: 'row' }, '답안지 기본 회전: ', ...radios));
  }

  function profileCard(p: Profile): HTMLElement {
    const status = el('div', { class: 'muted' }, '확인 중…');
    const card = el('div', { class: 'card' });
    const nameInput = el('input', { value: p.이름, onchange: () => { p.이름 = nameInput.value; dirty = true; } });
    card.append(el('div', { class: 'row' },
      el('label', {}, el('input', { type: 'radio', name: 'using', checked: 사용중 === p.id, onchange: () => { 사용중 = p.id; dirty = true; } }), '사용 중'),
      nameInput, el('span', { class: 'muted' }, p.종류 === 'cli' ? 'Claude Code(구독)' : 'API 키'),
      p.id === DEFAULT_ID ? null : el('button', { class: 'danger', onclick: () => {
        if (!confirm(`프로필 '${p.이름}'을 지울까요?`)) return;
        profiles = profiles.filter(x => x.id !== p.id); if (사용중 === p.id) 사용중 = DEFAULT_ID; dirty = true; renderProfiles();
      } }, '삭제')), status);

    if (p.종류 === 'cli') {
      const check = () => guard(async () => {
        if (dirty) await persist(); // 메인은 저장된 프로필로 점검한다
        status.textContent = '확인 중…';
        try { status.textContent = cliStatusText(await api.cliStatus(p.id)); } catch (e) { status.textContent = (e as Error).message; }
      });
      card.append(
        el('div', { class: 'row' }, 'CLI 파일: ', p.cliPath ? el('span', { class: 'path' }, p.cliPath) : el('span', { class: 'muted' }, '자동 찾기'),
          el('button', { onclick: () => guard(async () => { const f = await api.pickFile('exe'); if (!f) return; p.cliPath = f; dirty = true; renderProfiles(); }) }, 'CLI 파일 고르기'),
          el('button', { disabled: !p.cliPath, onclick: () => { delete p.cliPath; dirty = true; renderProfiles(); } }, '자동 찾기로')),
        el('div', { class: 'row' }, '설정 폴더: ', p.configDir ? el('span', { class: 'path' }, p.configDir) : el('span', { class: 'muted' }, '기본 폴더'),
          el('button', { onclick: () => guard(async () => { const f = await api.pickFolder(); if (!f) return; p.configDir = f; dirty = true; renderProfiles(); }) }, '설정 폴더 고르기'),
          el('button', { disabled: !p.configDir, onclick: () => { delete p.configDir; dirty = true; renderProfiles(); } }, '기본 폴더로')),
        el('div', { class: 'muted' }, 'Claude Code가 로그인 정보를 두는 폴더입니다. 다른 계정으로 쓰려면 다른 폴더를 고르세요(예: C:\\Users\\이름\\.claude-max)'),
        el('div', { class: 'row' },
          el('button', { onclick: () => guard(async () => {
            if (dirty) await persist();
            const r = await api.cliLogin(p.id);
            if (r.ok) showInfo("터미널 창에서 로그인을 끝낸 뒤 '다시 확인'을 누르세요"); else showError(r.message ?? '로그인 창을 열지 못했습니다');
          }) }, '로그인 열기'),
          el('button', { onclick: check }, '다시 확인'),
          el('button', { onclick: () => guard(() => api.openExternal('install')) }, '설치 안내')));
      if (store.state.settings.프로필.some(x => x.id === p.id)) void check(); else status.textContent = "아직 저장하지 않은 프로필입니다. '프로필 저장' 뒤 '다시 확인'을 누르세요";
    } else {
      const showSecret = () => guard(async () => { status.textContent = secretText(await api.secretView(p.id)); });
      const keyInput = el('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…' });
      keyInput.size = 40;
      card.append(
        el('div', { class: 'row' }, keyInput,
          el('button', { onclick: () => guard(async () => {
            const v = keyInput.value; keyInput.value = ''; // 값은 화면 상태에 남기지 않는다
            if (dirty) await persist();
            status.textContent = secretText(await api.secretSet(p.id, v)); showInfo('API 키를 저장했습니다');
          }) }, '저장'),
          el('button', { onclick: () => guard(async () => { if (dirty) await persist(); status.textContent = '연결 확인 중…'; const r = await api.secretTest(p.id); status.textContent = r.message; if (!r.ok) showError(r.message); }) }, '연결 확인'),
          el('button', { class: 'danger', onclick: () => guard(async () => { if (!confirm('저장된 API 키를 지울까요?')) return; await api.secretClear(p.id); await showSecret(); }) }, '키 지우기')),
        el('div', { class: 'muted' }, '키는 이 PC의 운영체제 암호화로 저장되며 화면에 다시 표시되지 않습니다. API 사용 요금은 장당 토큰으로 추정해 채점 실행 화면에 보입니다(추정).'));
      void showSecret();
    }
    return card;
  }

  function renderProfiles(): void {
    clear(profileBox);
    for (const p of profiles) profileBox.append(profileCard(p));
    const newName = el('input', { placeholder: '새 프로필 이름' });
    const newKind = el('select', {}, el('option', { value: 'cli' }, 'Claude Code(구독)'), el('option', { value: 'api' }, 'API 키'));
    profileBox.append(el('div', { class: 'row' }, newName, newKind, el('button', { onclick: () => {
      const 이름 = newName.value.trim(); if (!이름) { showError('새 프로필 이름을 적으세요'); return; }
      const 종류 = newKind.value as 'cli' | 'api';
      profiles.push({ id: `${종류}-${Date.now().toString(36)}`, 이름, 종류 }); dirty = true; renderProfiles();
    } }, '프로필 추가'), saveProfilesBtn));
    profileBox.append(el('div', { class: 'band info' }, 'Claude Code는 사용자가 직접 로그인한 구독으로 실행되며, 사용량은 그 요금제 한도에서 차감됩니다. 이 프로그램은 로그인 정보를 읽거나 저장하지 않습니다.'));
  }

  root.append(el('h2', {}, '설정'),
    el('section', {}, semesterBox, rosterBox, rotationBox),
    el('section', {}, el('h2', {}, 'AI 프로필'), profileBox),
    el('section', {}, el('h2', {}, '정보'),
      el('div', { class: 'row' }, '버전: ', versionText, el('button', { onclick: () => guard(() => api.openExternal('privacy')) }, '개인정보 처리 안내(PRIVACY)')),
      el('div', { class: 'muted' }, '자동 업데이트는 다음 버전에서 제공됩니다.')));
  renderBasics();
  renderProfiles();
  api.version().then(v => { versionText.textContent = v; }, () => undefined);
}
