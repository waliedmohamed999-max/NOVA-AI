"use client";

import { useEffect, useRef, type ElementType, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Fades content up once it scrolls into view (reference motion: slow-out, one pass, respects reduced motion). */
export function Reveal({ as: As = "div", delay = 0, className, style, ...props }: HTMLAttributes<HTMLElement> & { as?: ElementType; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.in = "true";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.in = "true";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <As ref={ref} className={cn("reveal", className)} style={{ transitionDelay: delay ? `${delay}ms` : undefined, ...style }} {...props} />;
}
