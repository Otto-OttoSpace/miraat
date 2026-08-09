// Prototype-chain key names in a style object must never be rewritten.
const A = () => (
  <div style={{ constructor: 1, toString: 2, valueOf: 3, hasOwnProperty: 4 }} />
);
export default A;
