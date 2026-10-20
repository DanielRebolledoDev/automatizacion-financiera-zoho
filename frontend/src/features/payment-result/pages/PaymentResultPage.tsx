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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatCurrency } from "../../../shared/utils/formatCurrency";
import {
  isActivePaymentStatus,
  usePaymentExpressResult,
} from "../hooks/usePaymentExpressResult";

function getStatusContent(status: string) {
  if (status === "PAID") {
    return {
      icon: <CheckCircleOutlined color="success" sx={{ fontSize: 64 }} />,
      chipColor: "success" as const,
      chipLabel: "Pago confirmado",
      title: "Pago realizado correctamente",
      description:
        "Recibimos la confirmación de tu pago. No necesitas volver a pagarlo.",
      alertSeverity: "success" as const,
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      icon: <HourglassEmpty color="info" sx={{ fontSize: 64 }} />,
      chipColor: "info" as const,
      chipLabel: "Pago en verificación",
      title: "Estamos verificando tu pago",
      description:
        "Khipu está verificando la transferencia. Espera la confirmación antes de intentar otro pago.",
      alertSeverity: "info" as const,
    };
  }

  if (status === "PENDING" || status === "CREATED") {
    return {
      icon: <HourglassEmpty color="warning" sx={{ fontSize: 64 }} />,
      chipColor: "warning" as const,
      chipLabel: "Pago pendiente",
      title: "Pago pendiente de confirmación",
      description:
        "Todavía no recibimos la confirmación. Si aún no realizaste la transferencia, puedes continuar con este cobro.",
      alertSeverity: "warning" as const,
    };
  }

  if (status === "CANCELLED") {
    return {
      icon: <ErrorOutlined color="warning" sx={{ fontSize: 64 }} />,
      chipColor: "warning" as const,
      chipLabel: "Pago cancelado",
      title: "El cobro fue cancelado",
      description:
        "Puedes volver a Pago Express, consultar tu deuda y generar un nuevo cobro.",
      alertSeverity: "warning" as const,
    };
  }

  if (status === "EXPIRED") {
    return {
      icon: <HourglassEmpty color="warning" sx={{ fontSize: 64 }} />,
      chipColor: "warning" as const,
      chipLabel: "Cobro expirado",
      title: "Este cobro expiró",
      description:
        "Si no realizaste la transferencia, vuelve a Pago Express para consultar tu deuda y generar un nuevo cobro. Si ya transferiste, verifica el pago antes de repetirlo.",
      alertSeverity: "warning" as const,
    };
  }

  if (status === "FAILED") {
    return {
      icon: <ErrorOutlined color="error" sx={{ fontSize: 64 }} />,
      chipColor: "error" as const,
      chipLabel: "Pago fallido",
      title: "No se pudo completar el pago",
      description:
        "Puedes volver a Pago Express para consultar tu deuda. Si ya realizaste una transferencia, verifica su estado antes de pagar nuevamente.",
      alertSeverity: "error" as const,
    };
  }

  return {
    icon: <ErrorOutlined color="error" sx={{ fontSize: 64 }} />,
    chipColor: "error" as const,
    chipLabel: "Estado no reconocido",
    title: "No pudimos interpretar el estado del pago",
    description: "Vuelve a consultar el estado antes de iniciar otro pago.",
    alertSeverity: "error" as const,
  };
}

export function PaymentResultPage() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cancellationRequested = searchParams.get("cancelled") === "1";
  const resultQuery = usePaymentExpressResult(paymentId, cancellationRequested);
  const paymentResult = resultQuery.data?.payment;
  const statusContent = paymentResult
    ? getStatusContent(paymentResult.status)
    : null;
  const active = paymentResult
    ? isActivePaymentStatus(paymentResult.status)
    : false;
  const busy = resultQuery.isFetching;

  const handleBackToStart = () => navigate("/pago-express");
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
          <Button onClick={handleBackToStart} sx={{ mt: 2 }}>
            Volver al Pago Express
          </Button>
        </Container>
      </Box>
    );
  }

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
                  {cancellationRequested
                    ? "Consultando la cancelación"
                    : "Consultando resultado del pago"}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {cancellationRequested
                    ? "Estamos comprobando el estado del cobro y si puede cancelarse."
                    : "Estamos consultando el estado del pago en el sistema."}
                </Typography>
              </Stack>
            )}

            {resultQuery.isError && (
              <Stack spacing={2} sx={{ mb: paymentResult ? 3 : 0 }}>
                <Alert severity="error">
                  No pudimos actualizar el estado: {resultQuery.error.message}
                  {paymentResult &&
                    " El estado mostrado es el último conocido."}
                </Alert>
                <Button
                  variant="outlined"
                  startIcon={<Refresh />}
                  disabled={busy}
                  onClick={() => void resultQuery.refreshStatus()}
                >
                  Reintentar consulta
                </Button>
                {!paymentResult && (
                  <Button startIcon={<ArrowBack />} onClick={handleBackToStart}>
                    Volver al Pago Express
                  </Button>
                )}
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

                {resultQuery.data?.cancellationError && (
                  <Alert
                    severity="warning"
                    sx={{ width: "100%", boxSizing: "border-box" }}
                  >
                    No se pudo completar la solicitud de cancelación:{" "}
                    {resultQuery.data.cancellationError}
                  </Alert>
                )}
                {resultQuery.data?.refreshError && (
                  <Alert
                    severity="warning"
                    sx={{ width: "100%", boxSizing: "border-box" }}
                  >
                    No se pudo reconciliar el pago:{" "}
                    {resultQuery.data.refreshError} Mostramos el estado guardado
                    en el sistema.
                  </Alert>
                )}
                {active && !resultQuery.isError && (
                  <Alert
                    severity="info"
                    sx={{ width: "100%", boxSizing: "border-box" }}
                  >
                    {resultQuery.data?.pollingPaused
                      ? "Pausamos las consultas automáticas después de 45 comprobaciones. Esto no cambia el estado del pago. Pulsa Actualizar estado para volver a consultar."
                      : "Esta pantalla actualiza el estado automáticamente, aproximadamente cada 4 segundos mientras está visible."}
                  </Alert>
                )}

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
                  sx={{ width: "100%", boxSizing: "border-box" }}
                >
                  {resultQuery.isError
                    ? "Último estado conocido"
                    : "Estado actual"}
                  : {paymentResult.status}
                </Alert>
                <Stack spacing={1} sx={{ width: "100%" }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    ID de pago: {paymentResult.id}
                  </Typography>
                  {paymentResult.paidAt && (
                    <Typography variant="body2" color="text.secondary">
                      Fecha de pago:{" "}
                      {new Date(paymentResult.paidAt).toLocaleString("es-CL")}
                    </Typography>
                  )}
                  {paymentResult.expiresAt && active && (
                    <Typography variant="body2" color="text.secondary">
                      Vencimiento del cobro:{" "}
                      {new Date(paymentResult.expiresAt).toLocaleString(
                        "es-CL",
                      )}
                    </Typography>
                  )}
                </Stack>

                <Stack spacing={2} sx={{ width: "100%" }}>
                  {!cancellationRequested &&
                    !resultQuery.isError &&
                    ["PENDING", "CREATED"].includes(paymentResult.status) &&
                    paymentResult.paymentUrl && (
                      <Button
                        variant="contained"
                        color="secondary"
                        size="large"
                        startIcon={<Payment />}
                        onClick={handleContinuePayment}
                        disabled={busy}
                      >
                        Continuar pago
                      </Button>
                    )}
                  {cancellationRequested &&
                    resultQuery.data?.cancellationError &&
                    ["PENDING", "CREATED"].includes(paymentResult.status) && (
                      <Button
                        variant="outlined"
                        size="large"
                        disabled={busy || resultQuery.isError}
                        onClick={() => void resultQuery.retryCancellation()}
                      >
                        Reintentar cancelación
                      </Button>
                    )}
                  {!resultQuery.isError && (
                    <Button
                      variant="outlined"
                      size="large"
                      startIcon={
                        busy ? (
                          <CircularProgress size={20} color="inherit" />
                        ) : (
                          <Refresh />
                        )
                      }
                      disabled={busy}
                      onClick={() => void resultQuery.refreshStatus()}
                    >
                      {busy ? "Consultando..." : "Actualizar estado"}
                    </Button>
                  )}
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
