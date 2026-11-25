type BrandIconProps = {
  size: number;
};

export function BrandIcon({ size }: BrandIconProps) {
  const fontSize = (220 * size) / 512;
  const borderWidth = size / 512;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
        border: `${borderWidth}px solid #27272a`,
        color: "#fafafa",
        fontSize,
        fontWeight: 700,
        letterSpacing: "-0.08em",
      }}
    >
      <span>B</span>
      <span style={{ color: "#34d399" }}>_</span>
    </div>
  );
}
