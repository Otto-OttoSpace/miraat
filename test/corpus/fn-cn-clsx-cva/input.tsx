import { cva } from "class-variance-authority";
import clsx from "clsx";
import { cn } from "@/lib/utils";

export const button = cva("ml-2 inline-flex", {
  variants: {
    side: { start: "pl-4", end: "pr-4" },
  },
});

export function Row({ active }: { active: boolean }) {
  return (
    <div className={cn("mr-2", { "pl-1": active }, clsx("text-left"))}>
      <span className={clsx("border-r")}>x</span>
    </div>
  );
}
