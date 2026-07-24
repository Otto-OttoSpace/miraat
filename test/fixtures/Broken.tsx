import { ChevronLeft } from "lucide-react";

// A component the way an AI code tool typically writes it — quietly broken for Arabic.
export function Card() {
  return (
    <div dir="ltr" className="ml-4 pr-2 text-left border-l rounded-l-lg scroll-ml-4">
      <ChevronLeft />
      <span className="mr-2 pl-1 text-right">مرحبا</span>
      <button style={{ marginLeft: 8, textAlign: "left" }}>إرسال</button>
    </div>
  );
}
