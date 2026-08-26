import type { ReactNode } from "react";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: "bg-neutral-900 text-white",
  secondary: "bg-neutral-100 text-neutral-700",
  destructive: "bg-red-100 text-red-800",
  outline: "border border-neutral-300 text-neutral-800",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      data-slot="badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
