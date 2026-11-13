import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          border: "1px solid #27272a",
          color: "#fafafa",
          fontSize: 220,
          fontWeight: 700,
          letterSpacing: "-0.08em",
        }}
      >
        <span>B</span>
        <span style={{ color: "#34d399" }}>_</span>
      </div>
    ),
    { ...size }
  );
}
