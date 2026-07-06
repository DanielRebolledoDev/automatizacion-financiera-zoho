import {
  ArrowBack,
  CheckCircleOutlined,
  ErrorOutlined,
  HourglassEmpty,
  Payment,
  Refresh,
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
import { formatCurrency } from "../../../shared/utils/formatCurrency";
import { usePaymentExpressResult } from "../hooks/usePaymentExpressResult";

function getStatusContent(status: string) {
  if (status === "PAID") {
    return {
      icon: <CheckCircleOutlined color="success" sx={{ fontSize: 64 }} />,
      chipColor: "success" as const,
      chipLabel: "Pago confirmado",
      title: "Pago realizado correctamente",
      description:
        "El pago fue registrado correctamente. La deuda asociada quedó actualizada en el sistema.",
      alertSeverity: "success" as const,
    };
  }

  if (
    status === "PENDING" ||
    status === "CREATED" ||
    status === "IN_PROGRESS"
  ) {
    return {
      icon: <HourglassEmpty color="warning" sx={{ fontSize: 64 }} />,
      chipColor: "warning" as const,
      chipLabel: "Pago pendiente",
      title: "Pago pendiente de confirmación",
      description:
        "El pago aún no ha sido confirmado. Puedes volver a consultar el estado o continuar con el pago si corresponde.",
      alertSeverity: "warning" as const,
    };
  }

  return {
    icon: <ErrorOutlined color="error" sx={{ fontSize: 64 }} />,
    chipColor: "error" as const,
    chipLabel: "Pago no completado",
    title: "No se pudo confirmar el pago",
    description:
      "El pago no se encuentra confirmado. Puedes volver al inicio e intentar generar un nuevo pago.",
    alertSeverity: "error" as const,
  };
}

export function PaymentResultPage() {
  const { paymentId } = useParams();
  const navigate = useNavigate();

  const resultQuery = usePaymentExpressResult(paymentId);
  const paymentResult = resultQuery.data?.payment;

  const handleBackToStart = () => {
    navigate("/pago-express");
  };

  const handleContinuePayment = () => {
    if (paymentResult?.paymentUrl) {
      window.location.assign(paymentResult.paymentUrl);
    }
  };

  if (!paymentId) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          py: { xs: 4, md: 8 },
          backgroundColor: "background.default",
        }}
      >
        <Container maxWidth="sm">
          <Alert severity="error">
            No se encontró el identificador del pago.
          </Alert>
        </Container>
      </Box>
    );
  }

  const statusContent = paymentResult
    ? getStatusContent(paymentResult.status)
    : null;

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
        <Card>
          <CardContent>
            {resultQuery.isPending && (
              <Stack
                spacing={3}
                sx={{ alignItems: "center", textAlign: "center" }}
              >
                <CircularProgress />

                <Typography variant="h5" component="h1">
                  Consultando resultado del pago
                </Typography>

                <Typography variant="body1" color="text.secondary">
                  Estamos consultando el estado del pago en el sistema.
                </Typography>
              </Stack>
            )}

            {resultQuery.isError && (
              <Stack spacing={3}>
                <Alert severity="error">{resultQuery.error.message}</Alert>

                <Button
                  variant="contained"
                  startIcon={<ArrowBack />}
                  onClick={handleBackToStart}
                >
                  Volver al Pago Express
                </Button>
              </Stack>
            )}

            {paymentResult && statusContent && (
              <Stack
                spacing={3}
                sx={{ alignItems: "center", textAlign: "center" }}
              >
                {statusContent.icon}

                <Chip
                  label={statusContent.chipLabel}
                  color={statusContent.chipColor}
                  variant="outlined"
                />

                <Stack spacing={1}>
                  <Typography variant="h5" component="h1">
                    {statusContent.title}
                  </Typography>

                  <Typography variant="body1" color="text.secondary">
                    {statusContent.description}
                  </Typography>
                </Stack>

                <Divider flexItem />

                <Stack spacing={1} sx={{ width: "100%" }}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Monto del pago
                  </Typography>

                  <Typography variant="h4" color="primary">
                    {formatCurrency(
                      paymentResult.amount,
                      paymentResult.currency,
                    )}
                  </Typography>
                </Stack>

                <Alert
                  severity={statusContent.alertSeverity}
                  sx={{ width: "100%" }}
                >
                  Estado actual: {paymentResult.status}
                </Alert>

                <Stack spacing={1} sx={{ width: "100%" }}>
                  <Typography variant="body2" color="text.secondary">
                    ID de pago: {paymentResult.id}
                  </Typography>

                  {paymentResult.paidAt && (
                    <Typography variant="body2" color="text.secondary">
                      Fecha de pago:{" "}
                      {new Date(paymentResult.paidAt).toLocaleString("es-CL")}
                    </Typography>
                  )}

                  {paymentResult.expiresAt &&
                    paymentResult.status !== "PAID" && (
                      <Typography variant="body2" color="text.secondary">
                        Expira:{" "}
                        {new Date(paymentResult.expiresAt).toLocaleString(
                          "es-CL",
                        )}
                      </Typography>
                    )}
                </Stack>

                <Stack spacing={2} sx={{ width: "100%" }}>
                  {(paymentResult.status === "PENDING" ||
                    paymentResult.status === "CREATED" ||
                    paymentResult.status === "IN_PROGRESS") &&
                    paymentResult.paymentUrl && (
                      <Button
                        variant="contained"
                        color="secondary"
                        size="large"
                        startIcon={<Payment />}
                        onClick={handleContinuePayment}
                      >
                        Continuar pago
                      </Button>
                    )}

                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<Refresh />}
                    onClick={() => resultQuery.refetch()}
                  >
                    Actualizar estado
                  </Button>

                  <Button
                    variant="text"
                    size="large"
                    startIcon={<ArrowBack />}
                    onClick={handleBackToStart}
                  >
                    Volver al Pago Express
                  </Button>
                </Stack>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
