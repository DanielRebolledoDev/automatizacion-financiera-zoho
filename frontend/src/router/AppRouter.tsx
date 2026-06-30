import { Navigate, Route, Routes } from "react-router-dom";
import { PaymentExpressPage } from "../features/payment-express/pages/PaymentExpressPage";
import { PaymentResultPage } from "../features/payment-result/pages/PaymentResultPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/pago-express" replace />} />
      <Route path="/pago-express" element={<PaymentExpressPage />} />
      <Route
        path="/pago-express/resultado/:paymentId"
        element={<PaymentResultPage />}
      />
      <Route path="*" element={<Navigate to="/pago-express" replace />} />
    </Routes>
  );
}
