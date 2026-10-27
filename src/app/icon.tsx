import { ImageResponse } from "next/og";
import { site } from "@/config/site";
import { loadOgFonts } from "@/lib/og-fonts";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "#0071e3",
          color: "#fff",
          fontFamily: "Onest",
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        {site.initials}
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
