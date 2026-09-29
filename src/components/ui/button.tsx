import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "outline" | "danger" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ink-inverse hover:bg-ink/85 active:translate-y-px",
  accent: "bg-accent text-white hover:bg-accent-strong active:translate-y-px",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2",
  outline: "border border-line text-ink hover:border-nova-blue hover:text-nova-blue",
  ghost: "text-ink-2 hover:text-ink hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
  danger: "bg-danger text-white hover:bg-danger/90",
  link: "text-nova-blue underline-offset-4 hover:underline px-0 h-auto",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-full",
  sm: "h-8 px-3.5 text-[13px] gap-1.5 rounded-full",
  md: "h-10 px-5 text-sm gap-2 rounded-full",
  lg: "h-12 px-7 text-[15px] gap-2.5 rounded-full",
  icon: "size-10 rounded-full",
  "icon-sm": "size-8 rounded-full",
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
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-bold tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none select-none",
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
