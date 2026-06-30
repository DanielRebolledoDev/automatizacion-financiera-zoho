import { CheckCircleOutlined } from "@mui/icons-material";
import {
  Box,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";

export function PaymentResultPage() {
  const { paymentId } = useParams();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        py: { xs: 4, md: 8 },
        backgroundColor: "background.default",
      }}
    >
      <Container maxWidth="sm">
        <Card>
          <CardContent>
            <Stack
              spacing={2}
              sx={{ alignItems: "center", textAlign: "center" }}
            >
              <CheckCircleOutlined color="success" sx={{ fontSize: 56 }} />

              <Typography variant="h5" component="h1">
                Resultado del pago
              </Typography>

              <Typography variant="body1" color="text.secondary">
                Más adelante esta pantalla consultará el estado público del pago
                usando el backend.
              </Typography>

              <Typography variant="body2" color="text.secondary">
                ID de pago: {paymentId}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
