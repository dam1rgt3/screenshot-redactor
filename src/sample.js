// Render the same fictional screenshot that goes through the OCR pipeline on upload.
export function makeSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 600;
  const c = canvas.getContext("2d");
  function fill(color, x, y, w, h) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }
  function write(value, x, y, size, options = {}) {
    c.fillStyle = options.color || "#26362f";
    c.font = (options.weight || 400) + " " + size + "px Arial, sans-serif";
    c.fillText(value, x, y);
  }
  fill("#ffffff", 0, 0, 1000, 600);
  fill("#203c35", 0, 0, 1000, 80);
  write("Northline Support", 48, 51, 32, { weight: 700, color: "#ffffff" });
  write("Support inbox", 48, 129, 23, { color: "#596d66" });
  write("Delivery instructions", 48, 193, 48, { weight: 700 });
  write("I need to update the delivery note on my order.", 48, 245, 28);
  fill("#d3dbd6", 48, 276, 904, 2);
  const rows = [
    ["Customer", "Avery Morgan"],
    ["Email", "avery.morgan@example.org"],
    ["Phone", "+1 (415) 555-0146"],
    ["Delivery note", "Door code: 8246"],
  ];
  rows.forEach(([name, value], i) => {
    const y = 333 + i * 68;
    write(name, 48, y, 25, { color: "#56665e" });
    write(value, 292, y, 31, { weight: 500 });
    if (i < 3) fill("#e4e9e5", 48, y + 27, 904, 1);
  });
  return canvas;
}
