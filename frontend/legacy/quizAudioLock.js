/* ============================================================
   public/js/quizAudioLock.js — chặn tua audio bài nghe
   Gắn vào <audio id="quizAudio"> (views/student/quiz-lesson.pug).

   Học từ bai-nghe-1.html: KHÔNG phụ thuộc audio đang phát hay đang tạm dừng.
   Lý do bản trước vẫn tua được: Chrome/Safari TỰ TẠM DỪNG audio khi kéo thanh
   tua rồi mới phát lại, nên điều kiện "chỉ chặn khi đang phát" bị lọt.

   Cơ chế (2 lớp, như file mẫu + thêm lớp bắt ngay lúc tua):
     1) "seeking": vừa tua là đưa về vị trí hợp lệ gần nhất (bất kể paused).
     2) "timeupdate": nếu vị trí nhảy quá ngưỡng so với mốc hợp lệ → đưa về mốc
        (lưới an toàn khi trình duyệt không bắn "seeking" như mong đợi).
     3) Khoá tốc độ phát = 1x (đặt tốc độ 3x cũng là một cách tua).
   Tạm dừng vẫn dùng được. Phát hết thì nghe lại từ đầu được (mốc về 0).
   Sau khi NỘP BÀI, quizTake.js gọi window.quizAudioLock.unlock() để nghe lại tự do.
   Lưu ý: chặn phía trình duyệt, không ngăn được người cố tình.
   ============================================================ */
(function () {
    "use strict";

    var a = document.getElementById("quizAudio");
    if (!a || a.getAttribute("data-audio-lock") === "on") return;
    a.setAttribute("data-audio-lock", "on");

    var locked = true;
    var good = 0;                 // vị trí hợp lệ gần nhất (giây)
    var SEEK_TOL = 0.5;           // "seeking": lệch quá mức này là tua
    var DRIFT_TOL = 2;            // "timeupdate": nhảy quá mức này là tua (chịu được tab nền bị giảm tần suất)

    function setTime(t) {
        try { a.currentTime = t; } catch (e) { /* chưa sẵn sàng: bỏ qua */ }
    }

    a.addEventListener("seeking", function () {
        if (!locked) return;
        if (Math.abs(a.currentTime - good) > SEEK_TOL) setTime(good);
    });

    a.addEventListener("timeupdate", function () {
        if (!locked) { good = a.currentTime; return; }
        if (a.seeking) return;
        if (Math.abs(a.currentTime - good) > DRIFT_TOL) setTime(good);
        else good = a.currentTime;
    });

    a.addEventListener("ratechange", function () {
        if (locked && a.playbackRate !== 1) a.playbackRate = 1;
    });

    // Phát hết → cho nghe lại từ đầu (mốc về 0); nạp lại nguồn → đặt lại mốc
    a.addEventListener("ended", function () { good = 0; });
    a.addEventListener("emptied", function () { good = 0; });

    window.quizAudioLock = {
        unlock: function () { locked = false; good = a.currentTime; },
        lock: function () { locked = true; good = a.currentTime; },
        isLocked: function () { return locked; }
    };
})();
