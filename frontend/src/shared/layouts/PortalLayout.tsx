import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import { CorporateFooter } from "../components/CorporateFooter";

export function PortalLayout() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        "@supports (height: 100dvh)": { minHeight: "100dvh" },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: "1 0 auto",
          // El layout controla la altura de las pantallas existentes.
          // Evita sumar 100vh de contenido más la altura del footer.
          "& > *": { minHeight: 0, flex: "1 0 auto" },
        }}
      >
        <Outlet />
      </Box>
      <CorporateFooter />
    </Box>
  );
}
