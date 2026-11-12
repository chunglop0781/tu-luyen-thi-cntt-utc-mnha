/* Khoá tua chuông báo hết giờ (trang tự luận + trắc nghiệm).
   Chuông phát LẶP nên khi hết bài nó tự quay về 0 — việc đó không bị tính là tua.
   Cơ chế như legacy/quizAudioLock.js: bắt "seeking" + "timeupdate" + khoá tốc độ 1x.
   Trả về { reset() }: gọi trước khi chủ động đặt currentTime (phát lại / dừng) để không bị kéo ngược. */
export function lockSeek(a) {
  if (!a || a.__seekLock) return a && a.__seekLock;
  let good = 0;
  const SEEK_TOL = 0.5, DRIFT_TOL = 2;
  const wrapped = (t) => { const d = a.duration; return isFinite(d) && d > 0 && good > d - 3 && t < 3; };   // vòng lặp tự về đầu
  const set = (t) => { try { a.currentTime = t; } catch { /* chưa sẵn sàng */ } };
  a.setAttribute('controlsList', 'nodownload noplaybackrate');
  a.addEventListener('seeking', () => {
    const t = a.currentTime;
    if (Math.abs(t - good) > SEEK_TOL && !wrapped(t)) set(good);
  });
  a.addEventListener('timeupdate', () => {
    if (a.seeking) return;
    const t = a.currentTime;
    if (Math.abs(t - good) <= DRIFT_TOL || wrapped(t)) good = t; else set(good);
  });
  a.addEventListener('ratechange', () => { if (a.playbackRate !== 1) a.playbackRate = 1; });
  a.addEventListener('ended', () => { good = 0; });
  a.addEventListener('emptied', () => { good = 0; });
  a.__seekLock = { reset() { good = 0; } };
  return a.__seekLock;
}
