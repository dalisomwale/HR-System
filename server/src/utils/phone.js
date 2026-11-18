/*
 * Phone numbers (D119), kept as typed for display and in one standard form (E.164, e.g.
 * +260971234567) for matching and sign-in. Zambian numbers may be typed the local way:
 * 0971234567, 971234567, 260971234567 or +260 97 123 4567 are all the same number.
 */
export function normalisePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!/^\+?[0-9 ()-]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 9 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith('0')) digits = `260${digits.slice(1)}`;
  else if (digits.length === 9) digits = `260${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}

/** "+260971234567" as "+260 97 123 4567". */
export function formatPhone(e164) {
  if (!e164) return null;
  const m = /^\+260(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+260 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
