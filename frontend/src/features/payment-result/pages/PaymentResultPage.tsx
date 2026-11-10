import { useState } from "react";
import {
  ArrowBack,
  CheckCircleOutlined,
  ContentCopyOutlined,
  DownloadOutlined,
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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  buildPaymentSummary,
  formatPaymentDate,
} from "../utils/paymentResultSummary";
import { formatCurrency } from "../../../shared/utils/formatCurrency";
import {
  isActivePaymentStatus,
  usePaymentExpressResult,
} from "../hooks/usePaymentExpressResult";

function getStatusContent(status: string) {
  if (status === "REVIEW_REQUIRED") {
    return {
      icon: <HourglassEmpty color="warning" sx={{ fontSize: 64 }} />,
      chipColor: "warning" as const,
      chipLabel: "Pago en revisión",
      title: "Estamos revisando la confirmación",
      description:
        "No realices otro pago por estas facturas. Contacta a la empresa e indica el ID de pago para revisar el resultado.",
      alertSeverity: "warning" as const,
    };
  }

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
        "Si no realizaste la transferencia, puedes volver a consultar tu deuda. Si ya transferiste, solicita ayuda antes de pagar otra vez.",
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
  const [manualCopyOpen, setManualCopyOpen] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    severity: "success" | "error";
  } | null>(null);
  const cancellationRequested = searchParams.get("cancelled") === "1";
  const resultQuery = usePaymentExpressResult(paymentId, cancellationRequested);
  const payment = resultQuery.data?.payment;
  const content = payment ? getStatusContent(payment.status) : null;
  const active = Boolean(payment && isActivePaymentStatus(payment.status));
  const paid = payment?.status === "PAID";
  const verifying = payment?.status === "IN_PROGRESS";
  const busy = resultQuery.isFetching;
  const paused = resultQuery.data?.pollingPaused === true;
  const refreshError = resultQuery.data?.refreshError;
  const cancellationError = resultQuery.data?.cancellationError;
  const canContinue = Boolean(
    payment?.paymentUrl &&
    ["PENDING", "CREATED"].includes(payment.status) &&
    !cancellationRequested &&
    !resultQuery.isError &&
    !refreshError,
  );
  const stage = paid ? 2 : verifying ? 1 : 0;

  const back = () => navigate("/pago-express");
  const continuePayment = () => {
    if (canContinue && payment?.paymentUrl)
      window.location.assign(payment.paymentUrl);
  };
  const copyReference = async () => {
    if (!paymentId) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(paymentId);
      setNotice({ message: "ID de pago copiado.", severity: "success" });
    } catch {
      setManualCopyOpen(true);
    }
  };
  const downloadSummary = () => {
    if (!payment || payment.status !== "PAID") return;
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const text = buildPaymentSummary(payment);
      url = URL.createObjectURL(
        new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" }),
      );
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `resumen-pago-${payment.id.replace(/[^a-zA-Z0-9_-]/g, "")}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
    } catch {
      setNotice({
        message:
          "No pudimos descargar el resumen. Puedes copiar el ID de pago.",
        severity: "error",
      });
    } finally {
      anchor?.remove();
      // Da tiempo al navegador para iniciar la descarga antes de liberar el recurso.
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  };

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        py: { xs: 3, md: 6 },
        background:
          "linear-gradient(145deg, #EDF5F2 0%, #F4F7FA 45%, #E8EEF5 100%)",
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={3}>
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography
                variant="overline"
                color="secondary.dark"
                sx={{ fontWeight: 700, letterSpacing: 1.5 }}
              >
                Pago Express
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Seguimiento de tu pago
              </Typography>
            </Box>
            <Button startIcon={<ArrowBack />} onClick={back} size="small">
              Volver
            </Button>
          </Stack>

          {!paymentId && (
            <Alert severity="error">
              No encontramos el identificador del pago. Vuelve a Pago Express
              para consultar tu deuda.
            </Alert>
          )}

          {paymentId && resultQuery.isPending && (
            <Card>
              <CardContent sx={{ p: { xs: 3, md: 5 } }}>
                <Stack
                  spacing={3}
                  sx={{ alignItems: "center", textAlign: "center" }}
                  role="status"
                >
                  <CircularProgress aria-label="Consultando el pago" />
                  <Typography variant="h5" component="h1">
                    {cancellationRequested
                      ? "Comprobando la cancelación"
                      : "Consultando tu pago"}
                  </Typography>
                  <Typography color="text.secondary">
                    Estamos obteniendo el estado más reciente disponible.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          )}

          {paymentId && resultQuery.isError && (
            <Alert severity="warning" sx={{ alignItems: "flex-start" }}>
              <Typography component="p" sx={{ fontWeight: 600 }}>
                No pudimos actualizar el estado.
              </Typography>
              <Typography variant="body2">
                {payment
                  ? "Conservamos el último estado conocido. Un error de conexión no significa que el pago haya fallado."
                  : "Si ya transferiste, consulta el estado antes de intentar otro pago."}
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 1, overflowWrap: "anywhere" }}
              >
                {resultQuery.error.message}
              </Typography>
              <Button
                startIcon={<Refresh />}
                disabled={busy}
                onClick={() => void resultQuery.refreshStatus()}
                sx={{ mt: 1 }}
              >
                Reintentar consulta
              </Button>
            </Alert>
          )}

          {payment && content && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(0, 1.3fr) minmax(0, 1fr)",
                },
                gap: 3,
                alignItems: "start",
              }}
            >
              <Card
                sx={{
                  borderTop: "4px solid",
                  borderColor: `${content.chipColor}.main`,
                }}
              >
                <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                  <Stack spacing={3}>
                    <Stack
                      spacing={2}
                      sx={{ alignItems: "center", textAlign: "center" }}
                    >
                      <Box
                        sx={{
                          width: 96,
                          height: 96,
                          borderRadius: "50%",
                          bgcolor: "background.default",
                          display: "grid",
                          placeItems: "center",
                        }}
                        aria-hidden="true"
                      >
                        {content.icon}
                      </Box>
                      <Chip
                        label={content.chipLabel}
                        color={content.chipColor}
                        variant="outlined"
                      />
                      <Typography
                        variant="h5"
                        component="h1"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {content.title}
                      </Typography>
                      <Typography
                        color="text.secondary"
                        sx={{ lineHeight: 1.7 }}
                      >
                        {content.description}
                      </Typography>
                    </Stack>

                    {(active || paid) && (
                      <Box
                        component="ol"
                        aria-label="Etapas del pago"
                        sx={{
                          display: "flex",
                          listStyle: "none",
                          p: 0,
                          m: 0,
                          gap: 1,
                        }}
                      >
                        {["Cobro creado", "Verificación", "Confirmación"].map(
                          (label, index) => (
                            <Box
                              component="li"
                              key={label}
                              aria-current={
                                index === stage ? "step" : undefined
                              }
                              sx={{ flex: 1, textAlign: "center", minWidth: 0 }}
                            >
                              <Box
                                sx={{
                                  width: 30,
                                  height: 30,
                                  mx: "auto",
                                  mb: 1,
                                  borderRadius: "50%",
                                  display: "grid",
                                  placeItems: "center",
                                  fontSize: 13,
                                  fontWeight: 700,
                                  bgcolor:
                                    index <= stage
                                      ? "secondary.main"
                                      : "action.hover",
                                  color:
                                    index <= stage
                                      ? "secondary.contrastText"
                                      : "text.secondary",
                                }}
                              >
                                {index < stage || paid ? (
                                  <CheckCircleOutlined
                                    sx={{ fontSize: 19 }}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  index + 1
                                )}
                              </Box>
                              <Typography
                                variant="caption"
                                sx={{ fontWeight: index === stage ? 700 : 400 }}
                              >
                                {label}
                              </Typography>
                            </Box>
                          ),
                        )}
                      </Box>
                    )}

                    {active && !resultQuery.isError && (
                      <Box
                        sx={{
                          bgcolor: "background.default",
                          p: 2,
                          borderRadius: 2,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600 }}
                          gutterBottom
                        >
                          {paused
                            ? "Puedes seguir consultando"
                            : verifying
                              ? "Esperando la confirmación de Khipu"
                              : "Seguimos consultando el estado"}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {paused
                            ? "Pausamos la actualización automática. Pulsa Actualizar estado para retomarla; esto no crea otro cobro."
                            : "Esta página consulta el estado automáticamente mientras está visible. La verificación puede tardar unos minutos; no necesitas generar otro pago."}
                        </Typography>
                        {verifying && !paused && !refreshError && (
                          <LinearProgress
                            aria-label="Esperando confirmación, sin tiempo estimado"
                            sx={{ mt: 2, borderRadius: 1 }}
                            color="secondary"
                          />
                        )}
                      </Box>
                    )}

                    {cancellationError && (
                      <Alert severity="warning">
                        No pudimos completar la cancelación. {cancellationError}
                      </Alert>
                    )}
                    {refreshError && (
                      <Alert severity="warning">
                        No pudimos consultar Khipu. Mostramos el estado guardado
                        en el portal. {refreshError}
                      </Alert>
                    )}

                    {paid && (
                      <Alert severity="success" icon={false}>
                        Conserva el resumen y el ID de este pago. Si la deuda
                        todavía aparece pendiente, comparte el ID con la empresa
                        antes de volver a pagar.
                      </Alert>
                    )}

                    <Stack spacing={1.5}>
                      {paid && (
                        <Button
                          variant="contained"
                          color="secondary"
                          size="large"
                          startIcon={<DownloadOutlined />}
                          onClick={downloadSummary}
                        >
                          Descargar resumen
                        </Button>
                      )}
                      {canContinue && (
                        <Button
                          variant="contained"
                          color="secondary"
                          size="large"
                          startIcon={<Payment />}
                          onClick={continuePayment}
                          disabled={busy}
                        >
                          Continuar este pago
                        </Button>
                      )}
                      {cancellationRequested &&
                        cancellationError &&
                        ["PENDING", "CREATED"].includes(payment.status) && (
                          <Button
                            variant="outlined"
                            disabled={busy || resultQuery.isError}
                            onClick={() => void resultQuery.retryCancellation()}
                          >
                            Reintentar cancelación
                          </Button>
                        )}
                      {!resultQuery.isError && !paid && (
                        <Button
                          variant="outlined"
                          size="large"
                          startIcon={
                            busy ? (
                              <CircularProgress size={18} color="inherit" />
                            ) : (
                              <Refresh />
                            )
                          }
                          disabled={busy}
                          onClick={() => void resultQuery.refreshStatus()}
                        >
                          {busy ? "Consultando estado…" : "Actualizar estado"}
                        </Button>
                      )}
                      <Button
                        variant={paid ? "outlined" : "text"}
                        startIcon={<ArrowBack />}
                        onClick={back}
                      >
                        Volver a Pago Express
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Stack spacing={2}>
                <Card
                  variant="outlined"
                  sx={{ boxShadow: "none", borderColor: "divider" }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Stack spacing={2.5}>
                      <Typography variant="h6" component="h2">
                        Detalle del pago
                      </Typography>
                      <Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          gutterBottom
                        >
                          {paid ? "Monto confirmado" : "Monto del cobro"}
                        </Typography>
                        <Typography
                          variant="h4"
                          component="p"
                          color="primary.main"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          {formatCurrency(payment.amount, payment.currency)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Moneda: {payment.currency}
                        </Typography>
                      </Box>
                      <Divider />
                      <Box
                        component="dl"
                        sx={{
                          m: 0,
                          "& dt": {
                            color: "text.secondary",
                            fontSize: 12,
                            mb: 0.5,
                          },
                          "& dd": {
                            m: 0,
                            mb: 2,
                            fontSize: 14,
                            overflowWrap: "anywhere",
                          },
                          "& dd:last-child": { mb: 0 },
                        }}
                      >
                        <Box component="dt">
                          {resultQuery.isError || refreshError
                            ? "Último estado disponible"
                            : "Estado registrado"}
                        </Box>
                        <Box component="dd" sx={{ fontWeight: 600 }}>
                          {content.chipLabel}
                        </Box>
                        <Box component="dt">Cobro creado</Box>
                        <Box component="dd">
                          {formatPaymentDate(payment.createdAt)}
                        </Box>
                        {paid && (
                          <>
                            <Box component="dt">Confirmación registrada</Box>
                            <Box component="dd">
                              {formatPaymentDate(payment.paidAt)}
                            </Box>
                          </>
                        )}
                        {payment.expiresAt &&
                          ["PENDING", "CREATED"].includes(payment.status) && (
                            <>
                              <Box component="dt">Vencimiento del cobro</Box>
                              <Box component="dd">
                                {formatPaymentDate(payment.expiresAt)}
                              </Box>
                            </>
                          )}
                        {resultQuery.dataUpdatedAt > 0 && (
                          <>
                            <Box component="dt">Última consulta al portal</Box>
                            <Box component="dd">
                              {formatPaymentDate(resultQuery.dataUpdatedAt)}
                            </Box>
                          </>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Fechas en hora de Chile.
                      </Typography>
                      <Divider />
                      <Box>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600 }}
                          gutterBottom
                        >
                          ID de pago
                        </Typography>
                        <Typography
                          component="code"
                          variant="body2"
                          sx={{
                            display: "block",
                            overflowWrap: "anywhere",
                            userSelect: "all",
                            bgcolor: "background.default",
                            p: 1.5,
                            borderRadius: 1,
                            fontSize: 12,
                          }}
                        >
                          {payment.id}
                        </Typography>
                        <Button
                          size="small"
                          startIcon={<ContentCopyOutlined />}
                          onClick={() => void copyReference()}
                          sx={{ mt: 1 }}
                        >
                          Copiar ID de pago
                        </Button>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
                <Box sx={{ px: 1 }}>
                  <Typography variant="subtitle2" component="h2" gutterBottom>
                    ¿Necesitas ayuda?
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Comparte el ID de pago con la empresa para identificar tu
                    operación. Puedes volver a abrir esta dirección para
                    consultar el mismo pago.
                  </Typography>
                  {paid && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="p"
                      sx={{ mt: 1.5 }}
                    >
                      El resumen refleja el registro del portal. No reemplaza el
                      comprobante bancario ni acredita la actualización de la
                      deuda en otros sistemas.
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          )}

          {paymentId && !payment && resultQuery.isError && (
            <Button
              startIcon={<ContentCopyOutlined />}
              onClick={() => void copyReference()}
            >
              Copiar ID para solicitar ayuda
            </Button>
          )}
        </Stack>
      </Container>

      <Dialog
        open={manualCopyOpen}
        onClose={() => setManualCopyOpen(false)}
        aria-labelledby="copy-payment-title"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="copy-payment-title">Copia el ID de pago</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El navegador no permitió copiar automáticamente. Selecciona este
            código y cópialo:
          </Typography>
          <Typography
            component="code"
            tabIndex={0}
            sx={{
              display: "block",
              p: 2,
              bgcolor: "background.default",
              borderRadius: 1,
              userSelect: "all",
              overflowWrap: "anywhere",
            }}
          >
            {paymentId}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualCopyOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={notice !== null}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
      >
        <Alert
          severity={notice?.severity ?? "success"}
          onClose={() => setNotice(null)}
          sx={{ width: "100%" }}
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
