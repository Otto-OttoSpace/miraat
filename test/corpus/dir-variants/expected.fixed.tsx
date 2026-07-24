export const A = () => <div dir="ltr">a</div>;
export const B = () => <div dir={"ltr"}>b</div>;
export const C = () => <div dir='rtl'>c</div>;
const styleObj = { direction: "ltr" };
function set(el: HTMLElement) {
  el.setAttribute("dir", "ltr");
}
export const D = () => <div dir={`ltr`}>d</div>;
