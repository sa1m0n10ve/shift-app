// 確定シフトを A4 横の画像(1枚)にする。印刷・LINE共有用。
const Poster = (() => {
  // A4 横 297×210mm を 200dpi 相当で描く
  const W = 2339;
  const H = 1654;
  const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const COLOR = {
    text: '#1c2733',
    muted: '#66758a',
    line: '#b9c4d3',
    sun: '#d0453a',
    sat: '#1d5fbf',
    closed: '#eef1f5',
    early: '#dcedfd',
    earlyText: '#0f4a86',
    late: '#1f3f7a',
    lateText: '#ffffff',
  };

  function draw(schedule, year, month) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const margin = 80;
    const pad = (n) => String(n).padStart(2, '0');
    const key = (d) => year + '-' + pad(month + 1) + '-' + pad(d);

    // タイトル
    ctx.fillStyle = COLOR.text;
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 72px ' + FONT;
    ctx.fillText(year + '年' + (month + 1) + '月 シフト表', margin, margin + 60);
    // 凡例
    ctx.font = '36px ' + FONT;
    let lx = W - margin;
    [['遅番', COLOR.late, COLOR.lateText], ['早番', COLOR.early, COLOR.earlyText]].forEach(([label, bg, fg]) => {
      const w = ctx.measureText(label).width + 40;
      lx -= w;
      roundRect(ctx, lx, margin + 14, w, 56, 10, bg);
      ctx.fillStyle = fg;
      ctx.fillText(label, lx + 20, margin + 55);
      lx -= 24;
    });

    // カレンダーの枠
    const top = margin + 120;
    const headH = 56;
    const first = new Date(year, month, 1).getDay();
    const last = new Date(year, month + 1, 0).getDate();
    const weeks = Math.ceil((first + last) / 7);
    const footH = 50;
    const colW = (W - margin * 2) / 7;
    const rowH = (H - top - headH - margin - footH) / weeks;

    // 曜日の見出し
    ctx.font = 'bold 36px ' + FONT;
    ctx.textAlign = 'center';
    WEEK.forEach((w, i) => {
      ctx.fillStyle = i === 0 ? COLOR.sun : i === 6 ? COLOR.sat : COLOR.muted;
      ctx.fillText(w, margin + colW * i + colW / 2, top + 40);
    });

    const assign = schedule.assign || {};
    for (let d = 1; d <= last; d++) {
      const idx = first + d - 1;
      const x = margin + colW * (idx % 7);
      const y = top + headH + rowH * Math.floor(idx / 7);
      const dow = idx % 7;
      const closed = isClosedDay(year, month, d);

      if (closed) {
        ctx.fillStyle = COLOR.closed;
        ctx.fillRect(x, y, colW, rowH);
      }
      // 日付
      ctx.textAlign = 'left';
      ctx.font = 'bold 40px ' + FONT;
      ctx.fillStyle = closed ? '#a3adba' : dow === 0 ? COLOR.sun : dow === 6 ? COLOR.sat : COLOR.text;
      ctx.fillText(String(d), x + 14, y + 46);

      if (closed) {
        ctx.textAlign = 'center';
        ctx.font = '40px ' + FONT;
        ctx.fillStyle = '#a3adba';
        ctx.fillText('休', x + colW / 2, y + rowH / 2 + 30);
        continue;
      }

      // 「新太郎早番」を縦に並べる。人数が多い日は文字を小さくする
      const a = assign[key(d)] || { early: [], late: [] };
      const entries = [];
      ['early', 'late'].forEach((slot) => a[slot].forEach((name) => entries.push({ slot, text: name + (slot === 'early' ? '早番' : '遅番') })));
      const areaTop = y + 62;
      const areaH = rowH - 70;
      const gap = 8;
      let boxH = Math.min(64, (areaH - gap * (entries.length - 1)) / Math.max(entries.length, 1));
      let size = Math.min(38, boxH * 0.62);
      ctx.textAlign = 'center';
      entries.forEach((e, i) => {
        const by = areaTop + i * (boxH + gap);
        roundRect(ctx, x + 10, by, colW - 20, boxH, 8, e.slot === 'early' ? COLOR.early : COLOR.late);
        let fs = size;
        ctx.font = 'bold ' + fs + 'px ' + FONT;
        while (ctx.measureText(e.text).width > colW - 36 && fs > 16) {
          fs -= 1;
          ctx.font = 'bold ' + fs + 'px ' + FONT;
        }
        ctx.fillStyle = e.slot === 'early' ? COLOR.earlyText : COLOR.lateText;
        ctx.fillText(e.text, x + colW / 2, by + boxH / 2 + fs * 0.36);
      });
    }

    // 罫線
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 2;
    for (let r = 0; r <= weeks; r++) {
      const y = top + headH + rowH * r;
      line(ctx, margin, y, W - margin, y);
    }
    for (let c = 0; c <= 7; c++) {
      const x = margin + colW * c;
      line(ctx, x, top + headH, x, top + headH + rowH * weeks);
    }

    // 更新日
    if (schedule.updatedAt) {
      const t = new Date(schedule.updatedAt);
      ctx.textAlign = 'right';
      ctx.font = '28px ' + FONT;
      ctx.fillStyle = COLOR.muted;
      ctx.fillText('最終更新:' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()), W - margin, H - margin + 10);
    }
    return canvas;
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  // スマホでは共有メニュー(LINEなど)を出し、使えなければ画像を保存する
  async function save(schedule, year, month) {
    const canvas = draw(schedule, year, month);
    const name = 'shift-' + year + '-' + String(month + 1).padStart(2, '0') + '.png';
    const blob = await toBlob(canvas);
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: year + '年' + (month + 1) + '月 シフト表' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // 共有をやめただけ
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // A4 横 1枚で印刷する
  function print(schedule, year, month) {
    const canvas = draw(schedule, year, month);
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = '';
    const img = new Image();
    img.alt = year + '年' + (month + 1) + '月 シフト表';
    img.onload = () => setTimeout(() => window.print(), 50);
    img.src = canvas.toDataURL('image/png');
    area.appendChild(img);
  }

  return { draw, save, print };
})();
