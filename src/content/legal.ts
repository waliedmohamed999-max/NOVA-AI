/**
 * Public legal pages (privacy, terms, data deletion, acceptable use). They describe what the product
 * actually does. Anything the company must confirm (registered address, governing law, hosting region,
 * subprocessor list) comes from env and is shown as a clearly marked placeholder when not set — the
 * pages never invent legal commitments. Have counsel review before launch.
 */
export type LegalDoc = { title: string; updated: string; intro: string; sections: { h: string; p: string[] }[] };
export type LegalKey = "privacy" | "terms" | "data-deletion" | "acceptable-use";

export function legalFacts(env: NodeJS.ProcessEnv = process.env) {
  const pending = { en: "[to be completed by the company]", ar: "[تستكمله الشركة]" };
  return {
    company: env.LEGAL_COMPANY_NAME || "NOVA Technologies",
    email: env.LEGAL_CONTACT_EMAIL || "privacy@nova.ai",
    address: env.LEGAL_ADDRESS || null,
    law: env.LEGAL_GOVERNING_LAW || null,
    hosting: env.LEGAL_HOSTING_REGION || null,
    updated: env.LEGAL_LAST_UPDATED || "2026-09-28",
    pending,
  };
}

const SUBPROCESSORS_EN = [
  "AI providers (only those configured): OpenAI (text and images), Anthropic (text)",
  "Social platforms you connect: Meta (Facebook, Instagram, WhatsApp Business), LinkedIn, TikTok",
  "Account connections you enable: Google (Gmail, Calendar), Microsoft (Outlook, Calendar)",
  "Email delivery provider (SMTP or a transactional email service)",
  "Object storage (e.g. AWS S3 or Cloudflare R2) and the hosting / database provider",
  "Payments provider (when billing is enabled)",
];
const SUBPROCESSORS_AR = [
  "مزوّدو الذكاء الاصطناعي (المُفعّلون فقط): OpenAI (النصوص والصور) وAnthropic (النصوص)",
  "المنصات التي تربطها: Meta (فيسبوك وإنستغرام وواتساب للأعمال) ولينكدإن وتيك توك",
  "الحسابات التي تفعّلها: Google (Gmail والتقويم) وMicrosoft (Outlook والتقويم)",
  "مزوّد إرسال البريد الإلكتروني (SMTP أو خدمة بريد معاملات)",
  "تخزين الملفات (مثل AWS S3 أو Cloudflare R2) ومزوّد الاستضافة وقاعدة البيانات",
  "مزوّد المدفوعات (عند تفعيل الفوترة)",
];

export function legalDoc(key: LegalKey, locale: "en" | "ar", env: NodeJS.ProcessEnv = process.env): LegalDoc {
  const f = legalFacts(env);
  const P = f.pending[locale];
  const contact = `${f.company} — ${f.email}${f.address ? ` — ${f.address}` : ` — ${locale === "ar" ? "العنوان" : "Address"}: ${P}`}`;
  const en: Record<LegalKey, LegalDoc> = {
    privacy: {
      title: "Privacy Policy",
      updated: f.updated,
      intro: `This policy explains what ${f.company} ("NOVA", "we") collects when a business uses NOVA — an AI-assisted marketing and sales workspace — and how it is used. Contact: ${contact}.`,
      sections: [
        { h: "Who is responsible", p: [`For account data, ${f.company} is the controller. For data a business puts into NOVA about its own customers (leads, conversations), the business is the controller and NOVA processes it on the business's behalf.`] },
        {
          h: "Data we process",
          p: [
            "Account data: name, work email, password hash (never the password itself), language and security logs (sign-ins, IP address where available).",
            "Workspace data: company profile, brand kit, website content you ask NOVA to read, content drafts, designs, campaigns, analytics.",
            "Customer data you manage: leads, contact details, messages and notes entered or received through connected channels.",
            "Connected accounts: OAuth access and refresh tokens (encrypted at rest with AES-256-GCM), the account names/IDs you choose to connect, and the data those platforms return (posts, metrics, messages). NOVA never asks for or stores passwords of social or email accounts.",
          ],
        },
        {
          h: "How we use it",
          p: [
            "To provide the service: create and schedule content, publish only after the approval rules you set, collect performance metrics, qualify and follow up leads, and send emails or messages you approve.",
            "Security, abuse prevention, support and legally required records.",
            "We do not sell personal data and do not use customer data to train our own AI models.",
          ],
        },
        {
          h: "AI processing",
          p: [
            "When you use AI features, the relevant content (for example company information, a draft post or a lead's message) is sent to the configured AI provider's API to generate a result. Use of that data by the provider is governed by the provider's API terms.",
            "AI output can be wrong. NOVA shows it as a suggestion and publishes or sends only according to your approval settings.",
          ],
        },
        {
          h: "Connected platforms",
          p: [
            "When you connect Instagram, Facebook Pages, LinkedIn, TikTok, WhatsApp Business, Google or Microsoft, NOVA uses the official APIs and only the permissions you grant. You can disconnect at any time in Settings → Connected accounts; NOVA then deletes the stored tokens.",
          ],
        },
        { h: "Subprocessors", p: [...SUBPROCESSORS_EN, `The current list with locations: ${P}.`] },
        {
          h: "Retention",
          p: [
            "Workspace data is kept while the account is active. Tokens are deleted when an account is disconnected. When a workspace or account is deleted, its data is deleted from the live database; backups expire under the backup retention schedule.",
            `Hosting / data location: ${f.hosting ?? P}.`,
          ],
        },
        { h: "Your rights", p: ["You can access, export (Settings → Data & privacy), correct or delete your data. Requests: " + f.email + ". See the Data Deletion page for step-by-step instructions."] },
        { h: "Security", p: ["Encryption in transit and at rest for credentials, tenant isolation, role-based access, audit logs and rate limiting. No system is perfectly secure; report issues to " + f.email + "."] },
        { h: "Changes", p: ["We will update this page and the date above when this policy changes."] },
      ],
    },
    terms: {
      title: "Terms of Service",
      updated: f.updated,
      intro: `These terms govern use of NOVA provided by ${f.company}. Contact: ${contact}.`,
      sections: [
        { h: "The service", p: ["NOVA is a workspace with AI assistants for content, social media, analytics and sales follow-up. Features that depend on third-party platforms work only while those platforms and your connections allow it."] },
        {
          h: "Your responsibilities",
          p: [
            "You are responsible for the accounts you connect, the content you approve and publish, the messages sent to your customers, and having a lawful basis to contact the people in your CRM.",
            "Review AI suggestions before approving them. You remain responsible for claims, prices, offers and contract terms communicated to your customers.",
            "Follow the Acceptable Use Policy and the terms of each connected platform.",
          ],
        },
        { h: "AI output", p: ["AI-generated text and images may be inaccurate or similar to other content. They are provided as-is for your review."] },
        { h: "Plans and billing", p: ["Plans include usage limits (for example channels, seats and monthly AI designs). Paid plans and payment terms apply once billing is enabled for your account."] },
        { h: "Termination", p: ["You can stop using NOVA and delete your workspace at any time. We may suspend accounts that break these terms or the Acceptable Use Policy."] },
        { h: "Liability", p: [`Limitations of liability and warranty terms: ${P}.`] },
        { h: "Governing law", p: [f.law ?? P] },
      ],
    },
    "data-deletion": {
      title: "Data Deletion",
      updated: f.updated,
      intro: "How to delete your data from NOVA, including data received from Facebook, Instagram, LinkedIn, TikTok, Google or Microsoft.",
      sections: [
        {
          h: "Remove a connected platform",
          p: ["Go to Settings → Connected accounts and choose Disconnect. NOVA deletes the stored access tokens immediately and stops collecting data from that account. You can also remove NOVA from the platform's own settings (for example Facebook → Settings → Business Integrations)."],
        },
        {
          h: "Delete your workspace or account",
          p: ["Owners: Settings → Data & privacy → Delete organization. Any user: Settings → Data & privacy → Delete my account. Deletion removes the data from the live database; backups expire under the retention schedule."],
        },
        { h: "Request deletion by email", p: [`Email ${f.email} from the address on the account with the subject "Data deletion request". We confirm and complete the request within 30 days.`] },
      ],
    },
    "acceptable-use": {
      title: "Acceptable Use Policy",
      updated: f.updated,
      intro: "Rules for using NOVA and its AI features.",
      sections: [
        {
          h: "Not allowed",
          p: [
            "Spam, unsolicited bulk messaging, or contacting people without a lawful basis.",
            "Deceptive, fraudulent or impersonating content; fake reviews or testimonials; misleading health, financial or legal claims.",
            "Illegal, hateful, harassing or sexual content involving minors; content that infringes intellectual property.",
            "Scraping platforms, automating personal accounts, or bypassing platform limits and policies.",
            "Attempting to access other workspaces, attack the service or bypass approval and security controls.",
          ],
        },
        { h: "Platform and AI provider policies", p: ["You must also follow the policies of the connected platforms (Meta, LinkedIn, TikTok, Google, Microsoft) and of the AI providers used by NOVA."] },
        { h: "Enforcement", p: ["We may remove content, block features or suspend accounts that violate this policy. Report abuse to " + f.email + "."] },
      ],
    },
  };
  const ar: Record<LegalKey, LegalDoc> = {
    privacy: {
      title: "سياسة الخصوصية",
      updated: f.updated,
      intro: `توضح هذه السياسة ما تجمعه ${f.company} ("NOVA") عند استخدام شركة لمنصة NOVA — مساحة عمل للتسويق والمبيعات بمساعدة الذكاء الاصطناعي — وكيف تُستخدم. للتواصل: ${contact}.`,
      sections: [
        { h: "من المسؤول", p: [`بالنسبة لبيانات الحساب، ${f.company} هي المتحكم. أما البيانات التي تضعها الشركة عن عملائها (العملاء المحتملون والمحادثات) فالشركة هي المتحكم وNOVA تعالجها نيابة عنها.`] },
        {
          h: "البيانات التي نعالجها",
          p: [
            "بيانات الحساب: الاسم، البريد الإلكتروني للعمل، تجزئة كلمة المرور (وليس كلمة المرور نفسها)، اللغة وسجلات الأمان (تسجيلات الدخول وعنوان IP عند توفره).",
            "بيانات مساحة العمل: ملف الشركة، هوية العلامة، محتوى الموقع الذي تطلب من NOVA قراءته، المسودات والتصاميم والحملات والتحليلات.",
            "بيانات العملاء التي تديرها: العملاء المحتملون وبيانات التواصل والرسائل والملاحظات المُدخلة أو المستلمة عبر القنوات المربوطة.",
            "الحسابات المربوطة: رموز الوصول والتحديث (مشفّرة بـ AES-256-GCM)، أسماء ومعرّفات الحسابات التي تختار ربطها، والبيانات التي تعيدها المنصات. لا تطلب NOVA كلمات مرور حسابات التواصل أو البريد ولا تخزنها.",
          ],
        },
        {
          h: "كيف نستخدمها",
          p: [
            "لتقديم الخدمة: إنشاء المحتوى وجدولته، والنشر فقط وفق قواعد الموافقة التي تضعها، وجمع مقاييس الأداء، وتأهيل العملاء ومتابعتهم، وإرسال الرسائل التي توافق عليها.",
            "الأمان ومنع الإساءة والدعم والسجلات المطلوبة قانونيًا.",
            "لا نبيع البيانات الشخصية ولا نستخدم بيانات العملاء لتدريب نماذجنا.",
          ],
        },
        {
          h: "المعالجة بالذكاء الاصطناعي",
          p: [
            "عند استخدام ميزات الذكاء الاصطناعي يُرسل المحتوى المعني (مثل معلومات الشركة أو مسودة منشور أو رسالة عميل) إلى واجهة مزوّد الذكاء الاصطناعي المُعد لإنتاج النتيجة، ويخضع استخدام المزوّد لهذه البيانات لشروط واجهته.",
            "قد تكون مخرجات الذكاء الاصطناعي غير دقيقة؛ تعرضها NOVA كاقتراح ولا تنشر أو ترسل إلا وفق إعدادات الموافقة لديك.",
          ],
        },
        { h: "المنصات المربوطة", p: ["عند ربط إنستغرام أو صفحات فيسبوك أو لينكدإن أو تيك توك أو واتساب للأعمال أو Google أو Microsoft تستخدم NOVA الواجهات الرسمية والصلاحيات التي تمنحها فقط. يمكنك الفصل في أي وقت من الإعدادات ← الحسابات المرتبطة، فتحذف NOVA الرموز المخزنة."] },
        { h: "المعالِجون الفرعيون", p: [...SUBPROCESSORS_AR, `القائمة الحالية مع المواقع: ${P}.`] },
        { h: "الاحتفاظ", p: ["نحتفظ ببيانات مساحة العمل طوال نشاط الحساب، وتُحذف الرموز عند فصل الحساب. عند حذف مساحة العمل أو الحساب تُحذف البيانات من قاعدة البيانات الحية، وتنتهي النسخ الاحتياطية وفق جدول الاحتفاظ.", `مكان الاستضافة والبيانات: ${f.hosting ?? P}.`] },
        { h: "حقوقك", p: [`يمكنك الوصول إلى بياناتك وتصديرها (الإعدادات ← البيانات والخصوصية) وتصحيحها وحذفها. الطلبات: ${f.email}. راجع صفحة حذف البيانات للخطوات.`] },
        { h: "الأمان", p: [`تشفير أثناء النقل وتشفير الرموز أثناء التخزين، وعزل بين المساحات، وصلاحيات حسب الدور، وسجلات تدقيق وحدود معدل. لا يوجد نظام آمن تمامًا؛ أبلغ عن المشكلات إلى ${f.email}.`] },
        { h: "التغييرات", p: ["سنحدّث هذه الصفحة والتاريخ أعلاه عند تغيير السياسة."] },
      ],
    },
    terms: {
      title: "شروط الخدمة",
      updated: f.updated,
      intro: `تنظّم هذه الشروط استخدام NOVA المقدّمة من ${f.company}. للتواصل: ${contact}.`,
      sections: [
        { h: "الخدمة", p: ["NOVA مساحة عمل بمساعدين أذكياء للمحتوى والتواصل الاجتماعي والتحليلات ومتابعة المبيعات. الميزات المعتمدة على منصات خارجية تعمل فقط ما دامت هذه المنصات وربطك يسمحان بذلك."] },
        {
          h: "مسؤولياتك",
          p: [
            "أنت مسؤول عن الحسابات التي تربطها والمحتوى الذي توافق عليه وتنشره والرسائل المرسلة لعملائك، ووجود أساس قانوني للتواصل مع الأشخاص في قاعدة عملائك.",
            "راجع اقتراحات الذكاء الاصطناعي قبل الموافقة؛ تظل مسؤولًا عن الادعاءات والأسعار والعروض وشروط العقود المرسلة لعملائك.",
            "التزم بسياسة الاستخدام المقبول وشروط كل منصة مربوطة.",
          ],
        },
        { h: "مخرجات الذكاء الاصطناعي", p: ["قد تكون النصوص والصور المولّدة غير دقيقة أو مشابهة لمحتوى آخر، وتُقدَّم كما هي لمراجعتك."] },
        { h: "الخطط والفوترة", p: ["تتضمن الخطط حدود استخدام (مثل القنوات والمقاعد وتصاميم الذكاء الشهرية). تنطبق شروط الدفع للخطط المدفوعة عند تفعيل الفوترة لحسابك."] },
        { h: "الإنهاء", p: ["يمكنك التوقف عن استخدام NOVA وحذف مساحة عملك في أي وقت، وقد نعلّق الحسابات المخالفة لهذه الشروط أو لسياسة الاستخدام المقبول."] },
        { h: "المسؤولية", p: [`حدود المسؤولية والضمانات: ${P}.`] },
        { h: "القانون الحاكم", p: [f.law ?? P] },
      ],
    },
    "data-deletion": {
      title: "حذف البيانات",
      updated: f.updated,
      intro: "كيف تحذف بياناتك من NOVA بما فيها البيانات الواردة من فيسبوك وإنستغرام ولينكدإن وتيك توك وGoogle وMicrosoft.",
      sections: [
        { h: "إزالة منصة مربوطة", p: ["اذهب إلى الإعدادات ← الحسابات المرتبطة واختر فصل. تحذف NOVA رموز الوصول المخزنة فورًا وتتوقف عن جمع البيانات من ذلك الحساب. يمكنك أيضًا إزالة NOVA من إعدادات المنصة نفسها."] },
        { h: "حذف مساحة العمل أو الحساب", p: ["المالكون: الإعدادات ← البيانات والخصوصية ← حذف المؤسسة. أي مستخدم: الإعدادات ← البيانات والخصوصية ← حذف حسابي. يحذف ذلك البيانات من قاعدة البيانات الحية، وتنتهي النسخ الاحتياطية وفق جدول الاحتفاظ."] },
        { h: "طلب الحذف بالبريد", p: [`راسل ${f.email} من البريد المسجل في الحساب بعنوان "طلب حذف بيانات"، وسنؤكد الطلب وننفذه خلال 30 يومًا.`] },
      ],
    },
    "acceptable-use": {
      title: "سياسة الاستخدام المقبول",
      updated: f.updated,
      intro: "قواعد استخدام NOVA وميزات الذكاء الاصطناعي فيها.",
      sections: [
        {
          h: "غير مسموح",
          p: [
            "الرسائل المزعجة أو الجماعية غير المطلوبة أو التواصل دون أساس قانوني.",
            "المحتوى المضلل أو الاحتيالي أو انتحال الشخصيات، والمراجعات أو الشهادات المزيفة، والادعاءات الصحية أو المالية أو القانونية المضللة.",
            "المحتوى غير القانوني أو الكاره أو المسيء أو الذي يستغل القاصرين، أو المنتهك للملكية الفكرية.",
            "استخراج بيانات المنصات آليًا (scraping) أو أتمتة الحسابات الشخصية أو تجاوز حدود وسياسات المنصات.",
            "محاولة الوصول إلى مساحات عمل أخرى أو مهاجمة الخدمة أو تجاوز ضوابط الموافقة والأمان.",
          ],
        },
        { h: "سياسات المنصات ومزوّدي الذكاء", p: ["يجب الالتزام أيضًا بسياسات المنصات المربوطة (Meta ولينكدإن وتيك توك وGoogle وMicrosoft) ومزوّدي الذكاء الاصطناعي المستخدمين في NOVA."] },
        { h: "التطبيق", p: [`قد نزيل محتوى أو نوقف ميزات أو نعلّق حسابات مخالفة. للإبلاغ: ${f.email}.`] },
      ],
    },
  };
  return (locale === "ar" ? ar : en)[key];
}
