import { describe, expect, it } from "vitest";
import { detectIntent, INTENTS, intentDef } from "@/server/command/registry";
import { extractCount, extractDate, extractEntities, extractName, normalize } from "@/server/command/parse";
import ar from "@/i18n/messages/ar/common.json";
import en from "@/i18n/messages/en/common.json";

const intent = (text: string, files = false) => detectIntent(normalize(text), files, { name: extractName(text) })?.key ?? null;

describe("command parser — local intents (no AI)", () => {
  it.each([
    // navigation
    ["افتح العملاء الساخنين", "open_hot_leads"],
    ["روح للموافقات", "open_approvals"],
    ["افتح الموافقات", "open_approvals"],
    ["افتح التقويم", "open_calendar"],
    ["المتابعات اليوم", "open_followups"],
    ["افتح المبيعات", "open_sales"],
    ["افتح العملاء", "open_customers"],
    ["افتح الرسائل", "open_messages"],
    ["افتح التحليلات", "open_analytics"],
    ["افتح الإعدادات", "open_settings"],
    ["افتح المحتوى بانتظار الموافقة", "open_content_pending"],
    ["افتح Falcon Group", "open_entity"],
    ["اربط حساباتك", "open_integrations"],
    ["open approvals", "open_approvals"],
    ["go to the calendar", "open_calendar"],
    // read
    ["من العملاء اللي محتاجين متابعة اليوم؟", "followups_today"],
    ["لخص لي حالة المبيعات", "sales_summary"],
    ["لخص المبيعات", "sales_summary"],
    ["كم صفقة مفتوحة عندي؟", "sales_summary"],
    ["مين العملاء الساخنين؟", "hot_leads"],
    ["لخص الـpipeline", "sales_summary"],
    ["إيه الصفقات المتوقفة؟", "stalled_deals"],
    ["إيه اللي محتاج موافقتي؟", "approvals_summary"],
    ["لخص أداء الأسبوع", "analytics_summary"],
    ["إيه أفضل محتوى؟", "best_content"],
    ["منين جت أفضل leads؟", "lead_sources"],
    ["راجع المتابعات المتأخرة", "overdue_followups"],
    ["Summarize our pipeline", "sales_summary"],
    ["Who needs a follow-up today?", "followups_today"],
    // create / action
    ["جهز المتابعات", "prepare_followups"],
    ["جهز رسائل المتابعة", "prepare_followups"],
    ["أنشئ متابعة لعميل", "create_followup"],
    ["اعمل متابعة لشركة Falcon بكرة", "create_followup"],
    ["أنشئ متابعة لفلان بكرة", "create_followup"],
    ["جهز 5 منشورات للأسبوع القادم", "prepare_week_content"],
    ["جهز أول أسبوع محتوى", "prepare_week_content"],
    ["أنشئ فرصة B2B", "create_b2b_opportunity"],
    ["جهز عرض سعر", "create_quote"],
    ["أضف أول عميل", "create_lead"],
    ["حسن المنشور الأخير", "improve_content"],
    ["اعمل تصميم للبوست", "design_post"],
    ["جهز كاروسيل عن الخدمة X", "create_carousel"],
    ["أنشئ حملة لرمضان.", "create_campaign"],
    ["Create a Ramadan campaign.", "create_campaign"],
    ["Prepare next week's Instagram posts.", "prepare_week_content"],
    ["Follow up with hot leads.", "prepare_followups"],
    // Company Brain facts (no AI)
    ["ما الخدمات التي نقدمها؟", "brain_services"],
    ["اي الخدمات بتاعتنا", "brain_services"],
    ["ما المنتجات؟", "brain_products"],
    ["ما الجمهور المستهدف؟", "brain_audience"],
    ["ما مميزات الشركة؟", "brain_strengths"],
    ["ما سياسة الأسعار؟", "brain_pricing"],
    ["ما نبرة العلامة؟", "brain_tone"],
    ["What services do we offer?", "brain_services"],
    // local lookups (no AI)
    ["كم قيمة الـPipeline؟", "pipeline_value"],
    ["انقل Falcon لمرحلة التفاوض", "move_stage"],
    ["من العملاء المتأخرين؟", "overdue_followups"],
    ["إيه مواعيدي بكرة؟", "calendar_lookup"],
    ["إيه حالة الحسابات المربوطة؟", "integrations_status"],
    // brain + AI
    ["اعمل بوست عن خدمات البرمجة", "prepare_week_content"],
    ["اعمل بوست عن تصميم المواقع", "prepare_week_content"], // "design" is the topic here, not an image request
    ["جهز رسالة متابعة لشركة Falcon", "draft_sales_message"],
    // high-risk
    ["ابعت العرض", "send_quote"],
    ["انشر المحتوى", "publish_content"],
    ["أرسل خصم", "send_discount"],
    ["أغلق الصفقة", "close_deal"],
    ["وافق على الكل", "approve_all"],
    ["احذف كل العملاء", "delete_anything"],
  ])("%s → %s", (text, key) => {
    expect(intent(text)).toBe(key);
  });

  it("free-form text falls through to the AI router (no local guess)", () => {
    expect(intent("اكتب لي قصيدة عن القهوة والمطر في الشتاء")).toBeNull();
    expect(intent("what is the meaning of our brand story in one line for investors")).toBeNull();
  });

  it("a CSV attachment + 'extract customers' → import", () => {
    expect(intent("استخرج العملاء من الملف ده", true)).toBe("import_leads");
  });

  it("every suggestion and example command maps to a local intent in both languages", () => {
    for (const messages of [ar, en]) {
      const commands = (messages as { cmd: { commands: Record<string, string> } }).cmd.commands;
      for (const [key, text] of Object.entries(commands)) expect(intent(text), `${key}: ${text}`).not.toBeNull();
    }
  });

  it("every intent declares a permission and approval rule; high-risk never runs without approval/confirmation", () => {
    for (const i of INTENTS) {
      expect(i.permission).toBeTruthy();
      if (i.kind === "high_risk") expect(i.approval).not.toBe("never");
    }
    expect(intentDef("nope")).toBeNull();
  });
});

describe("command parser — entities", () => {
  it("normalizes Arabic variants and digits", () => {
    expect(normalize("أنشئ مُتابَعة  لـشركة  ٥")).toBe("انشي متابعه لشركه 5");
  });

  it("counts: digits and number words", () => {
    expect(extractCount(normalize("جهز 5 منشورات"))).toBe(5);
    expect(extractCount(normalize("جهز خمس منشورات"))).toBe(5);
    expect(extractCount(normalize("prepare ten posts"))).toBe(10);
    expect(extractCount(normalize("جهز منشورات"))).toBeNull();
  });

  it("relative dates: today / tomorrow / next week / weekday", () => {
    // weekday 1 = Monday
    expect(extractDate(normalize("بكرة"), 1)).toEqual({ label: "tomorrow", offsetDays: 1 });
    expect(extractDate(normalize("tomorrow"), 1)).toEqual({ label: "tomorrow", offsetDays: 1 });
    expect(extractDate(normalize("اليوم"), 1)).toEqual({ label: "today", offsetDays: 0 });
    expect(extractDate(normalize("الأسبوع القادم"), 1)).toEqual({ label: "next_week", offsetDays: 7 });
    expect(extractDate(normalize("يوم الخميس"), 1)).toEqual({ label: "weekday", offsetDays: 3 });
    expect(extractDate(normalize("بعد بكرة"), 1)).toEqual({ label: "day_after", offsetDays: 2 });
  });

  it("names: the leftover words after command vocabulary", () => {
    expect(extractName("اعمل متابعة لشركة Falcon بكرة")).toBe("Falcon");
    expect(extractName("افتح Falcon Group")).toBe("Falcon Group");
    expect(extractName("أنشئ متابعة لـأحمد علي يوم الخميس")).toBe("أحمد علي");
    expect(extractName("أضف عميل اسمه سارة محمد رقمها 0501234567")).toBe("سارة محمد");
    expect(extractName("Schedule a follow-up with Acme tomorrow")).toBe("Acme");
    expect(extractName("أنشئ متابعة لعميل")).toBeNull();
  });

  it("phone, email, value, message body, stage", () => {
    const e = extractEntities("أضف عميل اسمه سارة 050-123-4567 sara@example.com بقيمة 12,000", 1);
    expect(e).toMatchObject({ name: "سارة", phone: "0501234567", email: "sara@example.com", value: 12000 });
    expect(extractEntities("ابعت رسالة لـFalcon: نشكرك على وقتك", 1).body).toBe("نشكرك على وقتك");
    expect(extractEntities("علم صفقة Falcon إنها خسرناها", 1).stage).toBe("LOST");
    expect(extractEntities("أغلق صفقة Falcon", 1).stage).toBeNull();
  });
});
