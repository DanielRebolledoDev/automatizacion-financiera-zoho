import {
  AccountBalance,
  ArrowBack,
  CheckCircleOutlined,
  LockOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { useMockKhipuPaid } from "../hooks/useMockKhipuPaid";

export function MockKhipuCheckoutPage() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const paidMutation = useMockKhipuPaid();

  const handleMockPaid = async () => {
    if (!paymentId) return;

    await paidMutation.mutateAsync(paymentId);

    navigate(`/pago-express/resultado/${paymentId}`);
  };

  const handleCancel = () => {
    navigate("/pago-express");
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        py: { xs: 4, md: 8 },
        background:
          "linear-gradient(135deg, #EAF4F1 0%, #F4F7FA 50%, #E8EEF5 100%)",
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={3}>
          <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
            <Chip
              icon={<LockOutlined />}
              label="Ambiente de prueba"
              color="secondary"
              variant="outlined"
            />

            <Typography variant="h4" component="h1">
              Khipu Mock
            </Typography>

            <Typography variant="body1" color="text.secondary">
              Esta pantalla simula el checkout de Khipu para probar el flujo de
              pago completo.
            </Typography>
          </Stack>

          <Card>
            <CardContent>
              <Stack spacing={3}>
                <Stack
                  spacing={1}
                  sx={{ alignItems: "center", textAlign: "center" }}
                >
                  <AccountBalance color="secondary" sx={{ fontSize: 56 }} />

                  <Typography variant="h5" component="h2">
                    Simulación de pago bancario
                  </Typography>

                  <Typography variant="body2" color="text.secondary">
                    ID de pago: {paymentId}
                  </Typography>
                </Stack>

                <Alert severity="info">
                  En producción, esta pantalla será reemplazada por la URL real
                  entregada por Khipu.
                </Alert>

                {paidMutation.isError && (
                  <Alert severity="error">{paidMutation.error.message}</Alert>
                )}

                <Divider />

                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    color="secondary"
                    size="large"
                    startIcon={
                      paidMutation.isPending ? (
                        <CircularProgress size={20} color="inherit" />
                      ) : (
                        <CheckCircleOutlined />
                      )
                    }
                    onClick={handleMockPaid}
                    disabled={!paymentId || paidMutation.isPending}
                  >
                    {paidMutation.isPending
                      ? "Procesando pago..."
                      : "Simular pago exitoso"}
                  </Button>

                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<ArrowBack />}
                    onClick={handleCancel}
                    disabled={paidMutation.isPending}
                  >
                    Cancelar y volver
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
