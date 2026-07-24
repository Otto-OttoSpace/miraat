import { cn } from "@/lib/utils";

export const Panel = () => (
  <div
    className="ms-4 pe-2 text-start rounded-s-md border-e"
    style={{ marginInlineStart: 8, textAlign: "start" }}
  >
    <span className={cn("me-2", "ps-1")}>مرحبا 2024</span>
  </div>
);
