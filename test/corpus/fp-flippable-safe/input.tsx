// transform key on a NON-style object must never flag (not a style context)
const animConfig = { transform: "translateX(200px)", duration: 300 };

export const Safe = () => (
  <section
    data-transform="translateX(9px)"
    style={{
      transform: "translateY(40px) rotate(3deg)",
      backgroundPosition: "center bottom",
    }}
  >
    <Icon name="chevron-down" />
    <Icon icon="settings-panel" />
    <input name="left-margin" placeholder="x" />
    <span>{animConfig.transform}</span>
  </section>
);
