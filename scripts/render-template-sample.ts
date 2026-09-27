import { writeFileSync } from "node:fs";
import { renderTemplate } from "../src/server/design/templates";

/** Renders sample templates to a folder for visual review: npx tsx scripts/render-template-sample.ts <outDir> */
const out = process.argv[2] ?? ".";
const run = async () => {
  const ar = await renderTemplate("carousel", { headline: "٣ أخطاء تكلفك عملاءك كل يوم بدون ما تحس", body: "الخطأ الأول: الرد المتأخر على الرسائل. العميل اللي يستنى أكتر من ساعة غالبًا يشتري من منافسك.", cta: "احجز استشارة مجانية", brandName: "نوفا للتسويق", pageLabel: "2/5" }, { primary: "#1d3557", secondary: "#f1faee" });
  writeFileSync(`${out}/sample-carousel-ar.png`, ar.png);
  const en = await renderTemplate("story", { headline: "How to double your online sales in ninety days with smart content and targeted ads that actually convert", cta: "Book a free call", brandName: "Nova Growth" }, { primary: "#2b2d42", secondary: "#ef233c" });
  writeFileSync(`${out}/sample-story-en.png`, en.png);
  console.log(ar.layout.warnings, en.layout.warnings);
};
void run();
