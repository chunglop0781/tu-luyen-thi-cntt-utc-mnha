import '../legacy/subjectPicker.js';   // chép nguyên public/js/subjectPicker.js của luyen-thi (ô chọn có tìm kiếm); gắn window.SubjectPicker

/* Tên AI = tên người dùng tự đặt cho key của một nhà cung cấp (Cài đặt → Nhà cung cấp AI) để sau này tìm lại.
   Chữ hiện trong ô chọn: "<Tên AI> — <Nhà cung cấp>" → gõ tên hoặc tên nhà cung cấp đều tìm ra (giống ô "AI Key" của bản cũ). */
export const aiName = (it) => String((it && it.name) || '').trim();
export const aiTitle = (p, it) => (aiName(it) ? `${aiName(it)} — ${p.label}` : p.label);

/** Thuộc tính biến <select> thành ô chọn có tìm kiếm (data-subject-picker …) — như select#aiKeySelect / #modelSelect của bản cũ. */
export const pickerAttrs = (kind) => (kind === 'model'
  ? { 'data-subject-picker': '', 'data-sp-compact': '', 'data-sp-placeholder': '— Mặc định —', 'data-sp-search': 'Tìm model...', 'data-sp-empty': 'Không tìm thấy model nào', 'data-sp-unit': 'model', 'data-sp-unit-short': 'model' }
  : { 'data-subject-picker': '', 'data-sp-compact': '', 'data-sp-placeholder': '— Chọn AI —', 'data-sp-search': 'Tìm AI (tên, nhà cung cấp)...', 'data-sp-empty': 'Không tìm thấy AI nào', 'data-sp-unit': 'AI', 'data-sp-unit-short': 'AI' });

/** Bộ chọn cần phần tử đã nằm trong trang (đọc style của cha) → đợi tới khi gắn vào DOM rồi mới nâng cấp. */
export function enhancePickers(root) {
  let n = 0;
  (function tick() {
    if (root.isConnected) { if (window.SubjectPicker) window.SubjectPicker.initAll(root); }
    else if (n++ < 200) requestAnimationFrame(tick);
  })();
}
