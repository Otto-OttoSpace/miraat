import { cva } from "class-variance-authority";
import clsx from "clsx";
import { cn } from "@/lib/utils";

export const button = cva("ms-2 inline-flex", {
  variants: {
    side: { start: "ps-4", end: "pe-4" },
  },
});

export function Row({ active }: { active: boolean }) {
  return (
    <div className={cn("me-2", { "ps-1": active }, clsx("text-start"))}>
      <span className={clsx("border-e")}>x</span>
    </div>
  );
}
