import { Box, Container, Stack, Typography } from "@mui/material";
import logoClsWhite from "../../assets/logo-cls-white.png";
import { companyFooter } from "../config/companyFooter";

const headingSx = {
  color: "#FFFFFF",
  fontSize: "0.875rem",
  fontWeight: 700,
  mb: 2,
};

const textSx = {
  color: "#CBD7E3",
  fontSize: "0.8125rem",
  lineHeight: 1.85,
  overflowWrap: "anywhere",
};

export function CorporateFooter() {
  return (
    <Box
      component="footer"
      aria-label="Información corporativa y contacto"
      sx={{ bgcolor: "#142D46", color: "#FFFFFF", flexShrink: 0 }}
    >
      <Box
        aria-hidden="true"
        sx={{
          height: 3,
          background:
            "linear-gradient(90deg, #0D8AC7 0%, #0D8AC7 33.333%, #A2CF32 33.333%, #A2CF32 66.666%, #FA2342 66.666%, #FA2342 100%)",
        }}
      />
      <Container maxWidth="lg">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              md: "minmax(0, 1.35fr) repeat(3, minmax(0, 1fr))",
            },
            columnGap: { xs: 3, md: 5 },
            rowGap: 4,
            py: { xs: 4, md: 5 },
          }}
        >
          <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, minWidth: 0 }}>
            <Stack
              direction={{ xs: "row", md: "column" }}
              spacing={2.5}
              sx={{ alignItems: { xs: "center", md: "flex-start" } }}
            >
              <Box
                component="img"
                src={logoClsWhite}
                alt="CLS — Collecte Localisation Satellites"
                width={1588}
                height={1339}
                loading="lazy"
                decoding="async"
                sx={{
                  width: { xs: 90, md: 108 },
                  height: "auto",
                  flexShrink: 0,
                }}
              />
              <Box sx={{ minWidth: 0, maxWidth: 260 }}>
                <Typography sx={{ ...headingSx, mb: 0.75 }}>
                  Portal de pagos
                </Typography>
                <Typography sx={textSx}>{companyFooter.description}</Typography>
              </Box>
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={headingSx}>
              Empresa
            </Typography>
            <Typography sx={{ ...textSx, mb: 1 }}>
              {companyFooter.companyName}
            </Typography>
            <Typography sx={textSx}>{companyFooter.address}</Typography>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={headingSx}>
              Contacto
            </Typography>
            <Box component="dl" sx={{ m: 0 }}>
              <Typography component="dt" sx={{ ...textSx, color: "#FFFFFF" }}>
                Correo electrónico
              </Typography>
              <Typography component="dd" sx={{ ...textSx, m: 0, mb: 1.5 }}>
                {companyFooter.email}
              </Typography>
              <Typography component="dt" sx={{ ...textSx, color: "#FFFFFF" }}>
                Teléfono
              </Typography>
              <Typography component="dd" sx={{ ...textSx, m: 0 }}>
                {companyFooter.phone}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ minWidth: 0, gridColumn: { xs: "1 / -1", md: "auto" } }}>
            <Typography component="h2" sx={headingSx}>
              Horario de atención
            </Typography>
            <Typography sx={{ ...textSx, maxWidth: 280 }}>
              {companyFooter.businessHours}
            </Typography>
          </Box>
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{
            borderTop: "1px solid rgba(255, 255, 255, 0.16)",
            py: 2.5,
            justifyContent: "space-between",
            alignItems: { xs: "flex-start", sm: "center" },
          }}
        >
          <Typography sx={{ color: "#CBD7E3", fontSize: "0.75rem" }}>
            © {new Date().getFullYear()} Cunlogan
          </Typography>
          <Typography sx={{ color: "#CBD7E3", fontSize: "0.75rem" }}>
            Pago Express · Portal de pagos
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
