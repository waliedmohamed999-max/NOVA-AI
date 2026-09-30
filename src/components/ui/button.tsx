import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "outline" | "danger" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<ButtonVariant, string> = {
  // Reference: Ink Black filled CTA, a light-grey "Login"-style secondary, hairline outline, violet only for identity.
  primary: "bg-ink text-ink-inverse hover:bg-[#3a3a3a] dark:hover:bg-white/85 active:scale-[0.98]",
  accent: "bg-accent text-white hover:bg-accent-strong active:scale-[0.98]",
  secondary: "bg-black/[0.05] text-ink hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.12] active:scale-[0.98]",
  outline: "border border-line bg-surface text-ink hover:border-nova-blue hover:text-nova-blue",
  ghost: "text-ink-2 hover:text-ink hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
  danger: "bg-danger text-white hover:bg-danger/90 active:scale-[0.98]",
  link: "text-nova-blue underline-offset-4 hover:underline px-0 h-auto",
};

// Reference: rounded rectangles (8px nav buttons, 10-12px CTAs); big CTAs carry 16-20px bold labels.
const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-[6px]",
  sm: "h-8 px-3.5 text-[13px] gap-1.5 rounded-[8px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-[52px] px-6 text-[17px] gap-2.5 rounded-[12px] tracking-[-0.02em]",
  icon: "size-10 rounded-[10px]",
  "icon-sm": "size-8 rounded-[8px]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
};

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-bold tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out-soft)] disabled:opacity-50 disabled:pointer-events-none select-none",
    variants[variant],
    sizes[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, iconEnd, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
      {!loading && iconEnd}
    </button>
  );
});
