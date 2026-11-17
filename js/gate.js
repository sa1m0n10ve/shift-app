// 画面を動かす前の入口。合言葉やパスワードはなく、リンクを知っていればそのまま使える。
// 本番モードでは、ここでスプレッドシートからスタッフ名の一覧を読み込む。
const Gate = (() => {
  async function enter() {
    if (Api.isLocal) return { staff: CONFIG.STAFF };
    try {
      const session = await Api.login();
      CONFIG.STAFF = session.staff;
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
