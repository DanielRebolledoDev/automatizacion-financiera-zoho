import { AccountBalanceWallet, LockOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

export function PaymentExpressPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        py: { xs: 4, md: 8 },
        background:
          "linear-gradient(135deg, #F4F7FA 0%, #E8EEF5 45%, #F7FAFC 100%)",
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={3}>
          <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
            <Chip
              icon={<LockOutlined />}
              label="Pago seguro"
              color="primary"
              variant="outlined"
            />

            <Typography variant="h4" component="h1">
              Portal de Pago Express
            </Typography>

            <Typography variant="body1" color="text.secondary">
              Ingresa el RUT asociado a tu cuenta para consultar tu deuda total
              y generar un pago de forma simple.
            </Typography>
          </Stack>

          <Card>
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="info">
                  Por seguridad, en este flujo solo se mostrará la deuda total.
                  El detalle de documentos estará disponible en el portal de
                  clientes autenticado.
                </Alert>

                <TextField
                  label="RUT"
                  placeholder="Ej: 76.123.456-0"
                  helperText="Ingresa el RUT con o sin puntos."
                />

                <Button
                  variant="contained"
                  size="large"
                  startIcon={<AccountBalanceWallet />}
                >
                  Consultar deuda
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
