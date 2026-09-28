import { defineWorkflow } from "../runtime";

/** Command Center: "prepare a carousel about X" — the Content Studio carousel generator, run as a job. */
defineWorkflow("command_carousel", {
  agent: "DESIGNER",
  steps: ["writing_content", "design_briefs"],
  async run(ctx) {
    const { generateCarousel } = await import("../../studio/carousel");
    const contentItemId = String(ctx.params.contentItemId);
    const r = await ctx.step("writing_content", () =>
      generateCarousel(ctx.scope, contentItemId, { topic: (ctx.params.topic as string | null) ?? null, slideCount: Number(ctx.params.slides ?? 6), userId: ctx.requestedById ?? "" }),
    );
    await ctx.step("design_briefs", async () => ctx.task("DESIGNER", `Carousel: ${r.slides.length} slides`, { type: "ContentItem", id: contentItemId }));
    return {
      type: "content_plan",
      title: `${r.slides.length} slides`,
      summary: r.outline.join(" · ").slice(0, 400),
      items: r.slides.map((s) => ({ title: s.headline, subtitle: s.body })),
      actions: [{ label: "review", href: `/content/${contentItemId}`, primary: true }],
      entity: { type: "ContentItem", id: contentItemId },
    };
  },
});
