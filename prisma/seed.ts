/**
 * Development-only demo workspace. Every row belongs to an organization
 * flagged `isDemo`, social data is flagged `isDemo`, and the UI shows a
 * "demo data" banner. Never run against production.
 */
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/server/db/client");
  const { hashPassword } = await import("../src/server/auth/password");
  const { provisionOrganization } = await import("../src/server/tenancy/provision");
  const { createContentFromPlan, approveContent } = await import("../src/server/content/service");
  const { addLeadEvent } = await import("../src/server/sales/service");
  const { recordMetrics } = await import("../src/server/social/sync");
  const { startRun, executeRun } = await import("../src/server/agents/runtime");
  await import("../src/server/agents/jobs");
  const { generateDailyBrief, generateWeeklyReport } = await import("../src/server/reports/service");
  const { offlinePost } = await import("../src/server/agents/offline-content");
  const { loadBrain } = await import("../src/server/agents/brain");

  const email = "demo@nova.local";
  const password = "NovaDemo2026!";
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    const orgs = await db.organizationMember.findMany({ where: { userId: existing.id } });
    const { deleteOrganization } = await import("../src/server/privacy/service");
    for (const o of orgs) await deleteOrganization(o.organizationId, existing.id);
    await db.user.delete({ where: { id: existing.id } });
  }

  const user = await db.user.create({
    data: { email, name: "Waleed Aboelazz", passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), isPlatformAdmin: true, locale: "en" },
  });
  const { organization, workspace } = await provisionOrganization({ userId: user.id, name: "Luma Skin Studio", locale: "en", timezone: "Asia/Dubai", website: "https://luma-skin.example", isDemo: true });
  const scope = { organizationId: organization.id, workspaceId: workspace.id };
  await db.subscription.update({ where: { organizationId: organization.id }, data: { plan: "GROWTH", status: "TRIALING" } });
  await db.agent.updateMany({ where: scope, data: { enabled: true } });

  // Company Brain
  await db.companyProfile.updateMany({
    where: scope,
    data: {
      summary: "Luma Skin Studio is a modern skincare clinic in Dubai offering medical-grade facials, acne treatment programs and personalized skincare plans.",
      description: "Clinic-grade skincare with honest advice and visible results.",
      industry: "Beauty & skincare clinic",
      tagline: "Skin, understood.",
      markets: ["Dubai", "UAE"],
      languages: ["en", "ar"],
      audience: [
        { name: "Busy professionals 25–40", description: "Want healthy, glowing skin without spending hours on routines.", pains: ["No time", "Confusing product advice"], motivations: ["Confidence", "Simple routines"] },
        { name: "Acne-prone young adults", description: "Tried everything; want a treatment plan that works.", pains: ["Breakouts", "Scarring"], motivations: ["Clear skin", "Expert guidance"] },
      ],
      valueProps: ["Dermatologist-designed treatment plans", "Honest advice — no upselling", "Visible results in 4 weeks"],
      differentiators: ["In-clinic skin analysis", "Arabic & English consultations"],
      goals: ["Get more customers", "Generate leads"],
      primaryGoal: "Get more customers",
      contentPillars: ["Education", "Before & after", "Behind the scenes", "Offers"],
      completeness: 85,
      strategy: { positioning: "The honest, results-driven skin clinic in Dubai.", firstMonthFocus: "Educational carousels that answer common skin questions", postingCadence: "4 posts per week", kpis: ["Saves", "Consultation requests", "Leads"] },
      discoveries: {
        brand: { tone: "Warm, expert, reassuring", traits: ["Warm", "Expert", "Honest"] },
        audience: [{ name: "Busy professionals 25–40", description: "Want healthy skin with simple routines." }],
        contentOpportunities: [{ title: "Answer skin questions", description: "Your clients ask the same 10 questions — each is a post." }],
        salesOpportunities: [{ title: "Free skin analysis offer", description: "A consultation CTA converts education into bookings." }],
        recommendedChannels: [{ platform: "INSTAGRAM", reason: "Visual results and local reach" }, { platform: "TIKTOK", reason: "Short routines reach younger audiences" }],
        strategy: { firstMonthFocus: "Educational carousels", postingCadence: "4 posts per week", kpis: ["Saves", "Leads"] },
        generatedBy: "seed",
      },
    },
  });
  await db.brandKit.updateMany({
    where: scope,
    data: { tone: "Warm, expert, reassuring", voiceTraits: ["Warm", "Expert", "Honest"], primaryColors: ["#1F3A34", "#E9D8C4"], secondaryColors: ["#C9785A"], headingFont: "Instrument Serif", bodyFont: "Geist", imageStyle: "Soft natural light, real skin texture, minimal props", layoutRules: ["Generous whitespace", "One idea per slide"], forbiddenStyles: ["Heavy filters", "Stock-photo smiles"], dontSay: ["miracle", "guaranteed"] },
  });
  await db.offering.createMany({
    data: [
      { ...scope, type: "SERVICE", name: "Signature Hydra Facial", priceText: "AED 450", priceCents: 45000, currency: "AED" },
      { ...scope, type: "SERVICE", name: "Acne Clear Program (6 weeks)", priceText: "AED 2,400", priceCents: 240000, currency: "AED" },
      { ...scope, type: "SERVICE", name: "Skin Analysis Consultation", priceText: "Free", priceCents: 0, currency: "AED" },
      { ...scope, type: "PRODUCT", name: "Luma Barrier Serum", priceText: "AED 180", priceCents: 18000, currency: "AED" },
    ],
  });
  await db.knowledgeSource.create({
    data: {
      ...scope,
      type: "FAQ",
      title: "Clinic FAQ",
      status: "PENDING",
      rawText:
        "Opening hours: Saturday to Thursday, 10am–8pm.\nLocation: Jumeirah, Dubai.\nThe skin analysis consultation is free and takes 30 minutes.\nThe Acne Clear Program runs for 6 weeks with weekly check-ins.\nWe offer consultations in Arabic and English.\nPayment: card or cash. Installments available for programs over AED 1,500.",
    },
  });
  const { ingestSource } = await import("../src/server/knowledge/service");
  const faq = await db.knowledgeSource.findFirstOrThrow({ where: { ...scope, title: "Clinic FAQ" } });
  await ingestSource(scope, faq.id);
  await db.organization.update({ where: { id: organization.id }, data: { onboardingStatus: "COMPLETED" } });

  // Historical posts with metrics (demo) — educational carousels perform best, so the analyst finds a real pattern.
  const brain = await loadBrain(scope);
  const rnd = mulberry(42);
  for (let i = 0; i < 26; i++) {
    const daysAgo = 45 - i * 1.7;
    const isCarousel = i % 3 === 0;
    const pillar = ["Education", "Before & after", "Behind the scenes", "Offers"][i % 4];
    const platform = i % 5 === 0 ? "TIKTOK" : "INSTAGRAM";
    const reach = Math.round(1800 + rnd() * 1400 + i * 40);
    const boost = (pillar === "Education" ? 1.45 : 1) * (isCarousel ? 1.25 : 1) * (pillar === "Offers" ? 0.7 : 1);
    const likes = Math.round(reach * 0.035 * boost * (0.85 + rnd() * 0.3));
    const post = await db.socialPost.create({
      data: {
        ...scope,
        platform,
        externalId: `demo-${i}`,
        format: platform === "TIKTOK" ? "SHORT_VIDEO" : isCarousel ? "CAROUSEL" : "POST",
        pillar,
        caption: offlinePost(brain, i, { pillar }).caption,
        publishedAt: new Date(Date.now() - daysAgo * 86_400_000),
        isDemo: true,
      },
    });
    await recordMetrics(scope, post.id, {
      reach,
      impressions: Math.round(reach * 1.4),
      likes,
      comments: Math.round(likes * 0.08),
      shares: Math.round(likes * 0.06 * boost),
      saves: Math.round(likes * 0.18 * boost),
      clicks: Math.round(reach * 0.006 * boost),
      videoViews: platform === "TIKTOK" ? Math.round(reach * 1.8) : null,
      followersGained: Math.round(3 + rnd() * 10),
      raw: { demo: true },
    });
  }
  for (let d = 30; d >= 0; d--) {
    await db.accountMetricSnapshot.create({
      data: { ...scope, platform: "INSTAGRAM", date: new Date(new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)), followers: 4200 + (30 - d) * 11, isDemo: true },
    });
  }

  // Content: a week awaiting approval + a scheduled campaign week
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  const pending = Array.from({ length: 5 }, (_, i) => offlinePost(brain, i));
  await createContentFromPlan(scope, pending, { agent: "CONTENT_STRATEGIST", startDate: monday, generatedBy: "seed" });
  const campaign = await db.campaign.create({
    data: {
      ...scope,
      name: "Summer Glow Week",
      objective: "Book 30 skin analysis consultations",
      audience: "Busy professionals 25–40 in Dubai",
      offer: "Free skin analysis",
      channels: ["INSTAGRAM", "TIKTOK"],
      startDate: new Date(Date.now() + 86_400_000),
      endDate: new Date(Date.now() + 15 * 86_400_000),
      status: "ACTIVE",
      createdByAgent: "SOCIAL_MANAGER",
      plan: { concept: "Summer-proof your skin in 3 simple steps", keyMessage: "Healthy skin is a routine, not a miracle.", creativeDirection: "Sunlit, natural textures, deep green and sand tones", cta: "Book your free skin analysis", kpis: ["Consultations booked", "Saves", "Leads"] },
    },
  });
  const campaignPosts = Array.from({ length: 4 }, (_, i) => ({ ...offlinePost(brain, i + 5, { topic: "summer skincare" }), dayOffset: i + 1 }));
  const ids = await createContentFromPlan(scope, campaignPosts, { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "seed", campaignId: campaign.id });
  await approveContent(scope, ids, { userId: user.id, label: "Waleed" });

  // Leads across the pipeline
  const leads = [
    { name: "Mariam Al Hashimi", company: null, email: "mariam@example.ae", stage: "NEW", temperature: "HOT", score: 82, source: "Website form", intent: "Wants the Acne Clear Program before her wedding in 8 weeks", value: 240000, channel: "WEBSITE" },
    { name: "Omar Nasser", company: "Nasser Consulting", email: "omar@nasser.example", stage: "QUALIFIED", temperature: "HOT", score: 76, source: "Instagram DM", intent: "Corporate wellness package for 12 employees", value: 540000, channel: "INSTAGRAM_DM" },
    { name: "Sara Khalil", company: null, email: "sara.k@example.com", stage: "CONTACTED", temperature: "WARM", score: 58, source: "Summer Glow Week", intent: "Asked about hydra facial pricing", value: 45000, channel: "WEBSITE" },
    { name: "Lina Haddad", company: null, email: "lina@example.com", stage: "PROPOSAL", temperature: "WARM", score: 64, source: "Referral", intent: "3-session facial package", value: 135000, channel: "MANUAL" },
    { name: "Ahmed Saleh", company: "Saleh Events", email: "ahmed@saleh.example", stage: "NEGOTIATION", temperature: "HOT", score: 79, source: "LinkedIn", intent: "Bridal party skincare day", value: 360000, channel: "LINKEDIN" },
    { name: "Noura Ali", company: null, email: "noura@example.com", stage: "WON", temperature: "WARM", score: 70, source: "Website form", intent: "Acne Clear Program", value: 240000, channel: "WEBSITE" },
    { name: "Hind Youssef", company: null, email: null, stage: "LOST", temperature: "COLD", score: 22, source: "Instagram DM", intent: "Price shopping", value: null, channel: "INSTAGRAM_DM" },
    { name: "Rami Farah", company: null, email: "rami@example.com", stage: "NEW", temperature: "COLD", score: 31, source: "Website form", intent: "General question about opening hours", value: null, channel: "WEBSITE" },
    { name: "Dana Mansour", company: "Glow Co", email: "dana@glow.example", stage: "QUALIFIED", temperature: "WARM", score: 61, source: "Summer Glow Week", intent: "Interested in the barrier serum wholesale", value: 90000, channel: "EMAIL" },
  ] as const;
  for (const [i, l] of leads.entries()) {
    const lead = await db.lead.create({
      data: {
        ...scope,
        name: l.name,
        company: l.company,
        email: l.email,
        channel: l.channel,
        source: l.source,
        stage: l.stage,
        temperature: l.temperature,
        score: l.score,
        intent: l.intent,
        summary: l.intent,
        estimatedValueCents: l.value,
        currency: "AED",
        campaignId: l.source === "Summer Glow Week" ? campaign.id : null,
        nextAction: l.stage === "WON" || l.stage === "LOST" ? null : l.temperature === "HOT" ? "Call today" : "Send a follow-up",
        nextActionAt: new Date(Date.now() + (i % 3) * 86_400_000),
        lastContactAt: l.stage === "NEW" ? null : new Date(Date.now() - (i + 1) * 86_400_000),
        stageChangedAt: new Date(Date.now() - (i === 3 ? 18 : i) * 86_400_000),
        isDemo: true,
        createdAt: new Date(Date.now() - (i + 1) * 2 * 86_400_000),
      },
    });
    await addLeadEvent(scope, lead.id, { type: "CREATED", title: "Lead created", data: { source: l.source }, actor: { type: "SYSTEM" } });
    await addLeadEvent(scope, lead.id, { type: "AI_ANALYSIS", title: "Sales Agent analyzed this lead", body: l.intent, data: { score: l.score }, actor: { type: "AGENT", label: "AI Sales Agent" } });
    if (l.stage !== "WON" && l.stage !== "LOST") {
      await db.salesActivity.create({ data: { ...scope, leadId: lead.id, type: i === 4 ? "MEETING" : "FOLLOW_UP", title: i === 4 ? "Meeting: bridal party plan" : "Follow up", dueAt: new Date(Date.now() + (i % 3) * 86_400_000 - 3600_000), createdByAgent: "SALES_ASSISTANT" } });
    }
    if (l.channel === "WEBSITE" && l.stage === "NEW") {
      const conv = await db.conversation.create({ data: { ...scope, leadId: lead.id, channel: "WEBSITE", subject: "Website form" } });
      await db.message.create({ data: { ...scope, conversationId: conv.id, direction: "INBOUND", authorType: "USER", body: `Hi, ${l.intent.toLowerCase()}. Can you tell me more?`, status: "RECEIVED", sentAt: new Date() } });
    }
  }

  // Let the real analyst + brief generators run over the demo data.
  const review = await startRun(scope, { kind: "performance_review", agent: "PERFORMANCE_ANALYST", steps: [], input: "How is our content performing?" });
  await executeRun(scope, review.id);
  await generateDailyBrief(scope);
  await generateWeeklyReport(scope);
  await db.leadCaptureForm.create({
    data: { ...scope, publicKey: "demo-luma-form", name: "Website contact form", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "Phone", type: "tel", required: false }, { key: "message", label: "How can we help?", type: "textarea", required: true }], allowedOrigins: [] },
  });

  console.log(`\nDemo workspace ready.\n  Sign in: ${email}\n  Password: ${password}\n`);
  await db.$disconnect();
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
