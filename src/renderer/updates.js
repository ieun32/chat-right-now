export function wireUpdates() {
  const api = window.overlay?.updates;
  if (!api) return;
  let current;
  const render = state => {
    current = state;
    const messages = {
      development: '개발 모드', idle: '업데이트 확인', checking: '새 버전 확인 중…',
      current: '최신 버전입니다', available: `v${state.latestVersion} 업데이트 가능`,
      downloading: `업데이트 다운로드 ${state.percent}%`, ready: `v${state.latestVersion} 설치 준비 완료`,
      installing: '앱을 재시작합니다…', error: state.message,
    };
    document.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = `v${state.version}`; });
    document.querySelectorAll('[data-update-status]').forEach(el => { el.textContent = messages[state.status] || ''; });
    document.querySelectorAll('[data-update-action]').forEach(el => {
      el.textContent = state.status === 'available' ? '새 버전 다운로드' : state.status === 'ready' ? '재시작하여 설치' : '업데이트 확인';
      el.disabled = ['development', 'checking', 'downloading', 'installing'].includes(state.status);
    });
  };
  document.querySelectorAll('[data-update-action]').forEach(el => el.addEventListener('click', () => {
    const action = current?.status === 'ready' ? 'install' : current?.status === 'available' ? 'download' : 'check';
    api[action]().catch(() => {});
  }));
  api.onState(render);
  api.getState().then(state => { if (state) render(state); }).catch(() => {});
}
