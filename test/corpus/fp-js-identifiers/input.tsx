type Props = { marginLeft: number; paddingRight?: string };

function layout(marginLeft: number, paddingRight = 0) {
  const marginRight = marginLeft + paddingRight;
  return marginRight;
}

export function apply(el: HTMLElement) {
  el.style.marginLeft = "8px";
  return layout(1, 2);
}
