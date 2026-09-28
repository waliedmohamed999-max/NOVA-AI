/**
 * Deterministic command parsing (AR/EN): normalize → entities. No AI, no database.
 * Everything here is pure so it can be unit-tested and runs for every command before any AI fallback.
 */

export type Platform = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "TIKTOK";
export type DateLabel = "today" | "tomorrow" | "day_after" | "next_week" | "weekday" | "in_days";

export type Entities = {
  count: number | null;
  date: { label: DateLabel; offsetDays: number } | null;
  platform: Platform | null;
  stage: "WON" | "LOST" | null;
  /** Customer / company name candidate (original casing), resolved against the database later. */
  name: string | null;
  topic: string | null;
  phone: string | null;
  email: string | null;
  /** Message body after ":" (send message). */
  body: string | null;
  value: number | null;
  b2b: boolean;
};

/** Arabic-aware normalization: diacritics, tatweel, alef/ya/ta-marbuta variants, Arabic digits, punctuation. */
export function normalize(text: string) {
  return text
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[؟?!.,،؛;"'«»()[\]{}]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  واحد: 1, اثنين: 2, اتنين: 2, ثلاث: 3, تلات: 3, ثلاثه: 3, تلاته: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7,
  ثمان: 8, تمان: 8, ثمانيه: 8, تمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, عشرين: 20,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};
const WEEKDAYS: [RegExp, number][] = [
  [/(^|\s)(ال)?احد(\s|$)|\bsunday\b/, 0],
  [/(^|\s)(ال)?اثنين(\s|$)|(^|\s)(ال)?اتنين(\s|$)|\bmonday\b/, 1],
  [/(^|\s)(ال)?ثلاثا(ء)?(\s|$)|(^|\s)(ال)?تلات(ا|اء)(\s|$)|\btuesday\b/, 2],
  [/(^|\s)(ال)?اربعا(ء)?(\s|$)|\bwednesday\b/, 3],
  [/(^|\s)(ال)?خميس(\s|$)|\bthursday\b/, 4],
  [/(^|\s)(ال)?جمعه(\s|$)|\bfriday\b/, 5],
  [/(^|\s)(ال)?سبت(\s|$)|\bsaturday\b/, 6],
];

export function extractCount(n: string): number | null {
  const digits = n.match(/(^|\s)(\d{1,3})(\s|$)/)?.[2];
  if (digits) return Number(digits);
  for (const tok of n.split(" ")) {
    const bare = tok.replace(/^(و|ب|ل)/, "");
    if (tok in NUMBER_WORDS) return NUMBER_WORDS[tok];
    if (bare !== tok && bare in NUMBER_WORDS && bare.length > 2) return NUMBER_WORDS[bare];
  }
  if (/(^|\s)منشورين(\s|$)|(^|\s)بوستين(\s|$)/.test(n)) return 2;
  return null;
}

/** Relative dates only (today/tomorrow/next week/weekday/in N days). `todayWeekday` is 0=Sunday in the org's time zone. */
export function extractDate(n: string, todayWeekday: number): Entities["date"] {
  if (/بعد (بكره|بكرا|غدا)|day after tomorrow/.test(n)) return { label: "day_after", offsetDays: 2 };
  if (/(^|\s)(بكره|بكرا|غدا|الغد|باكر)(\s|$)|\btomorrow\b/.test(n)) return { label: "tomorrow", offsetDays: 1 };
  if (/(^|\s)(اليوم|النهارده|النهاردا|الليله)(\s|$)|\btoday\b|\btonight\b/.test(n)) return { label: "today", offsetDays: 0 };
  const inDays = n.match(/بعد (\d{1,2}) (ايام|يوم)|in (\d{1,2}) days?/);
  if (inDays) return { label: "in_days", offsetDays: Number(inDays[1] ?? inDays[3]) };
  if (/(الاسبوع|اسبوع) (القادم|الجاي|المقبل|الجاي)|الاسبوع الجاي|next week/.test(n)) return { label: "next_week", offsetDays: ((8 - todayWeekday) % 7) || 7 };
  for (const [re, day] of WEEKDAYS) if (re.test(n)) return { label: "weekday", offsetDays: ((day - todayWeekday + 7) % 7) || 7 };
  return null;
}

export function extractPlatform(n: string): Platform | null {
  if (/instagram|انستغرام|انستجرام|انستقرام|انستا|insta/.test(n)) return "INSTAGRAM";
  if (/linkedin|لينكد|لينكدان/.test(n)) return "LINKEDIN";
  if (/tiktok|تيك توك|تيكتوك/.test(n)) return "TIKTOK";
  if (/facebook|فيسبوك|فيس بوك|فيس/.test(n)) return "FACEBOOK";
  return null;
}

// Words that describe the command itself, never a customer name.
const STOP = new Set(
  (
    "افتح افتحلي روح وديني خذني اذهب اعمل اعملي انشي انشئ اضف ضيف ضف سجل حط جهز جهزلي حضر اكتب ابعت ابعث ارسل اغلق اقفل قفل سكر علم حدد " +
    "متابعه المتابعه متابعات المتابعات تذكير موعد مكالمه اتصال لمتابعه " +
    "ل لل مع عن الي في من يا و او الخاص بتاع بتاعت بخصوص " +
    "بكره بكرا غدا الغد باكر اليوم النهارده بعد الاسبوع اسبوع القادم الجاي المقبل ايام يوم الساعه " +
    "عميل عميله العميل للعميل لعميل العملاء عملاء زبون الزبون شركه لشركه الشركه للشركه بشركه " +
    "فرصه الفرصه فرص صفقه الصفقه لصفقه b2b بي تو بي جديد جديده جديدة " +
    "عرض العرض سعر اسعار الاسعار رساله الرساله رسايل واتساب واتس ايميل بريد " +
    "اسمه اسمها باسم رقمه رقمها رقم تليفون موبايل جوال بقيمه قيمه قيمتها بمبلغ " +
    "كسبنا كسبناها مكسوبه ربحنا خسرنا خسرناها خاسره ناجحه تم " +
    "لو سمحت فضلك من فضلك please pls اول اولي ثاني اخر my our your first another " +
    "open go to the a an for with of and create add new make schedule set up remind me follow-up follow up followup followups " +
    "lead leads customer client contact company opportunity deal b2b quote proposal send close mark as won lost named called " +
    "tomorrow today next week on at in days message email whatsapp value worth"
  ).split(" "),
);

function stripPrefix(token: string) {
  // "لـFalcon" / "لـأحمد": the tatweel marks a prefixed name.
  return token.replace(/^(ل|لل|ب)ـ+/, "").replace(/^[:\-–—]+|[:\-–—]+$/g, "");
}

/** Leftover words after removing command vocabulary, numbers, dates, phones and emails — the name candidate. */
export function extractName(original: string): string | null {
  const explicit = original.match(/(?:اسمه|اسمها|باسم|named|called)\s+([^\d:،,]+?)(?=\s+(?:رقم|رقمه|رقمها|ايميل|إيميل|email|phone|بقيمة|بقيمه|value|\+?\d)|[:،,]|$)/i)?.[1];
  const source = explicit ?? original.split(":")[0];
  const tokens = source
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ")
    .replace(/\+?\d[\d\s-]{5,}\d/g, " ")
    .split(/\s+/)
    .map(stripPrefix)
    .filter(Boolean)
    .filter((t) => {
      const n = normalize(t);
      if (!n || STOP.has(n) || /^[\d\s%]+$/.test(n) || n in NUMBER_WORDS) return false;
      if (!explicit && WEEKDAYS.some(([re]) => re.test(n))) return false;
      if (extractPlatform(n) && n.length < 12) return false;
      return true;
    });
  const name = tokens.join(" ").replace(/[؟?!.,،]+$/g, "").trim();
  return name.length >= 2 ? name.slice(0, 120) : null;
}

export function extractEntities(original: string, todayWeekday: number): Entities {
  const n = normalize(original);
  // From the original text: normalize() turns "12,000" into "12 000".
  const value = original.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).match(/(?:بقيمة|بقيمه|قيمة|قيمه|بمبلغ|value|worth)\s*(\d[\d,]*(?:\.\d+)?)/i)?.[1];
  const topic = original.match(/(?:عن|حول|بخصوص|about|on the topic of)\s+(.{3,160}?)\s*$/i)?.[1]?.trim() ?? null;
  const body = original.includes(":") ? original.slice(original.indexOf(":") + 1).trim().slice(0, 1000) || null : null;
  return {
    count: extractCount(n),
    date: extractDate(n, todayWeekday),
    platform: extractPlatform(n),
    stage: /(^|\s)(كسبنا|كسبناها|مكسوبه|ربحنا|ناجحه)(\s|$)|\bwon\b/.test(n) ? "WON" : /(^|\s)(خسرنا|خسرناها|خاسره)(\s|$)|\blost\b/.test(n) ? "LOST" : null,
    name: extractName(original),
    topic,
    phone: original.match(/\+?\d[\d\s-]{6,}\d/)?.[0]?.replace(/[\s-]/g, "") ?? null,
    email: original.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]?.toLowerCase() ?? null,
    body,
    value: value ? Number(value.replace(/,/g, "")) : null,
    b2b: /b2b|بي تو بي|شركات/.test(n),
  };
}
