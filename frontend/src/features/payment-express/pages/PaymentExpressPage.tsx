import { zodResolver } from "@hookform/resolvers/zod";
import {
  AccountBalanceWallet,
  ArrowForward,
  CheckCircleOutlined,
  LockOutlined,
  SearchOutlined,
  ReceiptLongOutlined,
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
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { formatCurrency } from "../../../shared/utils/formatCurrency";
import { formatRutInput } from "../../../shared/utils/rut";
import { usePaymentExpressPayTotal } from "../hooks/usePaymentExpressPayTotal";
import { usePaymentExpressSummary } from "../hooks/usePaymentExpressSummary";
import {
  paymentExpressRutSchema,
  type PaymentExpressRutFormValues,
} from "../schemas/paymentExpress.schema";

const steps = [
  { title: "Consulta tu deuda", text: "Ingresa el RUT asociado a tu cuenta." },
  {
    title: "Revisa el monto",
    text: "Confirma el total antes de continuar al pago.",
  },
  {
    title: "Realiza el pago",
    text: "Sigue las instrucciones de la pasarela y consulta el resultado.",
  },
];

export function PaymentExpressPage() {
  const [lastConsultedRut, setLastConsultedRut] = useState<string | null>(null);

  const summaryMutation = usePaymentExpressSummary();
  const payTotalMutation = usePaymentExpressPayTotal();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentExpressRutFormValues>({
    resolver: zodResolver(paymentExpressRutSchema),
    defaultValues: {
      rut: "",
    },
  });

  const onSubmit = (values: PaymentExpressRutFormValues) => {
    payTotalMutation.reset();

    summaryMutation.mutate(
      {
        rut: values.rut,
      },
      {
        onSuccess: () => {
          setLastConsultedRut(values.rut);
        },
      },
    );
  };

  const handleRutChange = (
    value: string,
    onChange: (value: string) => void,
  ) => {
    const formattedRut = formatRutInput(value);

    onChange(formattedRut);

    if (summaryMutation.data || summaryMutation.error) {
      summaryMutation.reset();
    }

    if (payTotalMutation.error) {
      payTotalMutation.reset();
    }

    setLastConsultedRut(null);
  };

  const handlePayTotal = () => {
    if (
      !summaryMutation.data?.canPay ||
      !lastConsultedRut ||
      summaryMutation.isPending ||
      payTotalMutation.isPending
    )
      return;

    payTotalMutation.mutate(
      { rut: lastConsultedRut },
      {
        onSuccess: (response) => {
          window.location.assign(
            response.payment.paymentUrl ||
              `/pago-express/resultado/${response.payment.id}`,
          );
        },
      },
    );
  };

  const summary = summaryMutation.data;
  const isLoading = summaryMutation.isPending || payTotalMutation.isPending;

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        py: { xs: 3, md: 7 },
        background:
          "linear-gradient(135deg, #F4F7FA 0%, #E8EEF5 45%, #F7FAFC 100%)",
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", mb: { xs: 3, md: 5 } }}
        >
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 44,
              height: 44,
              bgcolor: "primary.main",
              color: "white",
              borderRadius: "14px",
            }}
          >
            <AccountBalanceWallet aria-hidden="true" />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700, color: "primary.main" }}>
              Pago Express
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Portal de pagos
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
            },
            gap: { xs: 3, md: 6 },
            alignItems: "start",
          }}
        >
          <Stack spacing={3} sx={{ pt: { md: 3 }, minWidth: 0 }}>
            <Chip
              label="Simple, desde el primer paso"
              variant="outlined"
              color="secondary"
              sx={{
                alignSelf: "flex-start",
                bgcolor: "rgba(255,255,255,0.65)",
              }}
            />
            <Box>
              <Typography
                component="h1"
                sx={{
                  fontSize: { xs: "2rem", md: "2.8rem" },
                  fontWeight: 700,
                  lineHeight: 1.18,
                  letterSpacing: "-0.04em",
                  color: "primary.main",
                  maxWidth: 440,
                }}
              >
                Tus pagos, en un solo lugar.
              </Typography>
              <Typography
                color="text.secondary"
                sx={{ mt: 2, lineHeight: 1.8, maxWidth: 420 }}
              >
                Consulta tu deuda con tu RUT y paga el total en pocos pasos.
                Revisa el monto y continúa cuando estés listo.
              </Typography>
            </Box>
            <Stack
              component="ol"
              spacing={2.5}
              sx={{ listStyle: "none", p: 0, m: 0 }}
            >
              {steps.map((step, index) => (
                <Stack
                  component="li"
                  key={step.title}
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: "flex-start" }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      flexShrink: 0,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: "50%",
                      bgcolor: "white",
                      border: "1px solid #D5E2E8",
                      color: "secondary.main",
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 600, mb: 0.3 }}>
                      {step.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ lineHeight: 1.6 }}
                    >
                      {step.text}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start", maxWidth: 420, pt: 1 }}
            >
              <LockOutlined
                sx={{ fontSize: 19, color: "secondary.main", mt: 0.2 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.7 }}
              >
                En esta consulta solo se muestra el total. No se presentan datos
                personales ni el detalle de tus facturas.
              </Typography>
            </Stack>
          </Stack>

          <Card sx={{ minWidth: 0, border: "1px solid rgba(30,58,95,0.08)" }}>
            <CardContent
              sx={{
                p: { xs: 2.5, sm: 4 },
                "&:last-child": { pb: { xs: 2.5, sm: 4 } },
              }}
            >
              <Stack spacing={3}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center" }}
                >
                  <Box
                    sx={{
                      p: 1.2,
                      bgcolor: "#EEF5F3",
                      color: "secondary.main",
                      borderRadius: "14px",
                      display: "flex",
                    }}
                  >
                    <ReceiptLongOutlined />
                  </Box>
                  <Box>
                    <Typography component="h2" variant="h5">
                      Consulta tu deuda
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      Comienza ingresando tu RUT.
                    </Typography>
                  </Box>
                </Stack>

                <Stack
                  component="form"
                  spacing={2.5}
                  onSubmit={handleSubmit(onSubmit)}
                  noValidate
                  aria-busy={isLoading}
                >
                  <Controller
                    name="rut"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="RUT"
                        placeholder="Ej: 76.123.456-0"
                        helperText={
                          errors.rut?.message ??
                          "Puedes ingresarlo con o sin puntos."
                        }
                        error={Boolean(errors.rut)}
                        disabled={isLoading}
                        onChange={(event) =>
                          handleRutChange(event.target.value, field.onChange)
                        }
                      />
                    )}
                  />
                  <Button
                    type="submit"
                    variant={summary ? "outlined" : "contained"}
                    size="large"
                    startIcon={
                      summaryMutation.isPending ? (
                        <CircularProgress size={20} color="inherit" />
                      ) : (
                        <SearchOutlined />
                      )
                    }
                    disabled={isLoading}
                    sx={{ minHeight: 50 }}
                  >
                    {summaryMutation.isPending
                      ? "Consultando deuda..."
                      : summary
                        ? "Consultar nuevamente"
                        : "Consultar deuda"}
                  </Button>
                </Stack>

                {summaryMutation.isError && (
                  <Alert severity="error">
                    {summaryMutation.error.message}
                  </Alert>
                )}
                {payTotalMutation.isError && (
                  <Alert severity="error">
                    {payTotalMutation.error.message}
                  </Alert>
                )}

                <Box role="status" aria-live="polite" aria-atomic="true">
                  {summaryMutation.isPending ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ textAlign: "center" }}
                    >
                      Estamos consultando la información de tu cuenta.
                    </Typography>
                  ) : summary && !summaryMutation.isError ? (
                    <Stack spacing={2.5}>
                      <Divider />
                      <Box
                        sx={{
                          p: { xs: 2.5, sm: 3 },
                          borderRadius: "20px",
                          bgcolor: "#F0F6F4",
                          border: "1px solid #D8E8E2",
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "center", mb: 2 }}
                        >
                          <CheckCircleOutlined
                            sx={{ color: "secondary.main", fontSize: 20 }}
                          />
                          <Typography
                            variant="body2"
                            sx={{ color: "secondary.dark", fontWeight: 600 }}
                          >
                            Consulta realizada
                          </Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          Deuda total consultada
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: { xs: "2rem", sm: "2.6rem" },
                            fontWeight: 700,
                            color: "primary.main",
                            letterSpacing: "-0.04em",
                            overflowWrap: "anywhere",
                            mt: 0.5,
                          }}
                        >
                          {formatCurrency(summary.totalDebt, summary.currency)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Moneda: {summary.currency}
                        </Typography>
                        {lastConsultedRut && (
                          <Typography
                            variant="body2"
                            sx={{ mt: 2, overflowWrap: "anywhere" }}
                          >
                            RUT consultado: {lastConsultedRut}
                          </Typography>
                        )}
                      </Box>
                      {!summary.canPay && (
                        <Alert severity="info">
                          {summary.totalDebt === 0
                            ? "No registras deuda pendiente para Pago Express."
                            : "Por el momento no es posible pagar este monto desde el portal. Contacta a la empresa para revisar tu cuenta."}
                        </Alert>
                      )}
                    </Stack>
                  ) : !summaryMutation.isError ? (
                    <Box
                      sx={{
                        p: 2.5,
                        border: "1px dashed #CFDBE4",
                        borderRadius: "16px",
                        bgcolor: "#F8FAFC",
                      }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ textAlign: "center", lineHeight: 1.7 }}
                      >
                        Aquí aparecerá el monto disponible para pago una vez que
                        consultes tu RUT.
                      </Typography>
                    </Box>
                  ) : null}
                </Box>

                {summary?.canPay &&
                  !summaryMutation.isPending &&
                  !summaryMutation.isError && (
                    <Stack spacing={1.5}>
                      <Button
                        variant="contained"
                        color="secondary"
                        size="large"
                        onClick={handlePayTotal}
                        disabled={isLoading || !lastConsultedRut}
                        sx={{ minHeight: 52 }}
                        startIcon={
                          payTotalMutation.isPending ? (
                            <CircularProgress size={20} color="inherit" />
                          ) : (
                            <AccountBalanceWallet />
                          )
                        }
                        endIcon={
                          !payTotalMutation.isPending ? (
                            <ArrowForward />
                          ) : undefined
                        }
                      >
                        {payTotalMutation.isPending
                          ? "Preparando tu pago..."
                          : "Pagar deuda total"}
                      </Button>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ textAlign: "center", lineHeight: 1.6 }}
                      >
                        {payTotalMutation.isPending
                          ? "Espera mientras preparamos el acceso a la pasarela."
                          : "Al continuar, abrirás la pasarela para realizar el pago. Consultar tu deuda no genera un cobro."}
                      </Typography>
                    </Stack>
                  )}
              </Stack>
            </CardContent>
          </Card>
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", textAlign: "center", mt: 5, lineHeight: 1.7 }}
        >
          ¿Ya realizaste un pago? Revisa su confirmación antes de volver a
          intentarlo.
        </Typography>
      </Container>
    </Box>
  );
}
