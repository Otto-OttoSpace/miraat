export const Panel = () => {
  const node = document.body;
  node.style.transform = "translateX(24px)";
  node.style.transform = "translateY(24px)";
  return (
    <div style={{ transform: "scaleX(-1)", backgroundPosition: "left top" }}>
      <span style={{ transform: "rotate(5deg)", backgroundPosition: "center" }}>ok</span>
    </div>
  );
};
