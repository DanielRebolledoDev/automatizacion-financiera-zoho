import { zodResolver } from "@hookform/resolvers/zod";
import {
  AccountBalanceWallet,
  LockOutlined,
  SearchOutlined,
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
import { Controller, useForm } from "react-hook-form";
import { formatCurrency } from "../../../shared/utils/formatCurrency";
import { usePaymentExpressPayTotal } from "../hooks/usePaymentExpressPayTotal";
import { usePaymentExpressSummary } from "../hooks/usePaymentExpressSummary";
import {
  paymentExpressRutSchema,
  type PaymentExpressRutFormValues,
} from "../schemas/paymentExpress.schema";

export function PaymentExpressPage() {
  const summaryMutation = usePaymentExpressSummary();
  const payTotalMutation = usePaymentExpressPayTotal();

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<PaymentExpressRutFormValues>({
    resolver: zodResolver(paymentExpressRutSchema),
    defaultValues: {
      rut: "",
    },
  });

  const onSubmit = (values: PaymentExpressRutFormValues) => {
    summaryMutation.mutate({
      rut: values.rut,
    });
  };

  const handlePayTotal = async () => {
    const rut = getValues("rut");

    const response = await payTotalMutation.mutateAsync({
      rut,
    });

    if (response.payment.paymentUrl) {
      window.location.assign(response.payment.paymentUrl);
      return;
    }

    window.location.assign(`/pago-express/resultado/${response.payment.id}`);
  };

  const summary = summaryMutation.data;
  const isLoading = summaryMutation.isPending || payTotalMutation.isPending;

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
              <Stack
                component="form"
                spacing={3}
                onSubmit={handleSubmit(onSubmit)}
              >
                <Alert severity="info">
                  Por seguridad, en este flujo solo se mostrará la deuda total.
                  El detalle de documentos estará disponible en el portal de
                  clientes autenticado.
                </Alert>

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
                        "Ingresa el RUT con o sin puntos."
                      }
                      error={Boolean(errors.rut)}
                      disabled={isLoading}
                    />
                  )}
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  startIcon={
                    summaryMutation.isPending ? (
                      <CircularProgress size={20} color="inherit" />
                    ) : (
                      <SearchOutlined />
                    )
                  }
                  disabled={isLoading}
                >
                  {summaryMutation.isPending
                    ? "Consultando..."
                    : "Consultar deuda"}
                </Button>

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

                {summary && (
                  <>
                    <Divider />

                    <Stack spacing={2}>
                      <Typography variant="subtitle2" color="text.secondary">
                        Deuda total encontrada
                      </Typography>

                      <Typography variant="h4" color="primary">
                        {formatCurrency(summary.totalDebt, summary.currency)}
                      </Typography>

                      {summary.canPay ? (
                        <Alert severity="success">
                          Puedes continuar con el pago de la deuda total.
                        </Alert>
                      ) : (
                        <Alert severity="info">
                          No registras deuda pendiente para pago express.
                        </Alert>
                      )}

                      <Button
                        type="button"
                        variant="contained"
                        color="secondary"
                        size="large"
                        startIcon={
                          payTotalMutation.isPending ? (
                            <CircularProgress size={20} color="inherit" />
                          ) : (
                            <AccountBalanceWallet />
                          )
                        }
                        disabled={!summary.canPay || isLoading}
                        onClick={handlePayTotal}
                      >
                        {payTotalMutation.isPending
                          ? "Generando pago..."
                          : "Pagar deuda total"}
                      </Button>
                    </Stack>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
