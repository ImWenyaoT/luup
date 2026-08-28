import type { ReactNode } from "react";
import { Status } from "../../styles";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: BadgeVariant }) {
  return (
    <Status
      data-slot="badge"
      tone={variant === "destructive" ? "danger" : variant === "default" ? "success" : "neutral"}
    >
      {children}
    </Status>
  );
}
