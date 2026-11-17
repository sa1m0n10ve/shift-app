// 画面を動かす前の入口。合言葉やパスワードはなく、リンクを知っていればそのまま使える。
// 本番モードでは、ここでスプレッドシートからスタッフ名の一覧を読み込む。
const Gate = (() => {
  const STAFF_KEY = 'shiftapp:staff';

  function readCache() {
    try {
      const list = JSON.parse(localStorage.getItem(STAFF_KEY));
      return Array.isArray(list) && list.length > 0 ? list : null;
    } catch (e) {
      return null;
    }
  }

  function saveCache(session) {
    try {
      localStorage.setItem(STAFF_KEY, JSON.stringify(session.staff));
    } catch (e) {
      // 保存できなくても動作には影響しない
    }
  }

  async function enter() {
    if (Api.isLocal) return { staff: CONFIG.STAFF };
    // 前回読み込んだスタッフ名があれば、それで先に画面を出す(最新は裏で取り直し、次回から反映)
    const cached = readCache();
    if (cached) {
      CONFIG.STAFF = cached;
      Api.login().then(saveCache).catch(() => {});
      return { staff: cached };
    }
    try {
      const session = await Api.login();
      CONFIG.STAFF = session.staff;
      saveCache(session);
      return session;
    } catch (e) {
      // 読み込めなかったときは、読み込み直しを案内する
      const overlay = document.createElement('div');
      overlay.className = 'gate';
      overlay.innerHTML =
        '<div class="gate-box"><h2>読み込めませんでした</h2><p class="gate-error" role="alert"></p>' +
        '<button class="primary-btn" type="button">もう一度読み込む</button></div>';
      overlay.querySelector('.gate-error').textContent = e.message;
      overlay.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(overlay);
      return new Promise(() => {}); // 読み込み直すまで先へ進めない
    }
  }

  return { enter };
})();
