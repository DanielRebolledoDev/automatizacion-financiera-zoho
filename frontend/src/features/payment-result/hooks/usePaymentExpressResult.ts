import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { paymentExpressApi } from "../../../api/paymentExpress.api";

const POLLING_INTERVAL_MS = 4_000;
const MAX_AUTOMATIC_CYCLES = 45;

export function isActivePaymentStatus(status: string) {
  return ["CREATED", "PENDING", "IN_PROGRESS"].includes(status);
}

type Session = {
  cycles: number;
  cancellationAttempted: boolean;
  cancellationError: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "No se pudo completar la consulta.";
}

export function usePaymentExpressResult(
  paymentId: string | undefined,
  cancellationRequested = false,
) {
  const sessions = useRef(new Map<string, Session>());
  const sessionKey = `${paymentId ?? ""}:${cancellationRequested}`;

  const getSession = () => {
    let session = sessions.current.get(sessionKey);
    if (!session) {
      session = {
        cycles: 0,
        cancellationAttempted: false,
        cancellationError: null,
      };
      sessions.current.set(sessionKey, session);
    }
    return session;
  };

  const query = useQuery({
    queryKey: ["payment-express-result", paymentId, cancellationRequested],
    queryFn: async () => {
      if (!paymentId) throw new Error("ID de pago no disponible.");

      const session = getSession();
      session.cycles += 1;
      let result = await paymentExpressApi.getPaymentResult(paymentId);
      let refreshError: string | null = null;

      if (
        cancellationRequested &&
        !session.cancellationAttempted &&
        isActivePaymentStatus(result.payment.status)
      ) {
        // Un error o un refetch no deben repetir automáticamente el POST.
        session.cancellationAttempted = true;
        try {
          await paymentExpressApi.cancelPayment(paymentId);
          session.cancellationError = null;
        } catch (error) {
          session.cancellationError = errorMessage(error);
        }
        // El parámetro de URL y el resultado del POST no sustituyen el estado.
        result = await paymentExpressApi.getPaymentResult(paymentId);
      }

      if (isActivePaymentStatus(result.payment.status)) {
        try {
          await paymentExpressApi.refreshPaymentStatus(paymentId);
        } catch (error) {
          refreshError = errorMessage(error);
        }
        // Incluso si falla la reconciliación, un webhook puede haber confirmado.
        result = await paymentExpressApi.getPaymentResult(paymentId);
      }

      const active = isActivePaymentStatus(result.payment.status);
      return {
        ...result,
        cancellationError: active ? session.cancellationError : null,
        refreshError: active ? refreshError : null,
        pollingPaused: active && session.cycles >= MAX_AUTOMATIC_CYCLES,
      };
    },
    enabled: Boolean(paymentId),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data;
      if (
        currentQuery.state.status === "error" ||
        !data ||
        data.pollingPaused ||
        !isActivePaymentStatus(data.payment.status)
      ) {
        return false;
      }
      return POLLING_INTERVAL_MS;
    },
  });

  const refreshStatus = () => {
    if (query.isFetching) return;
    getSession().cycles = 0;
    // Conserva una petición en curso en vez de iniciar otra superpuesta.
    return query.refetch({ cancelRefetch: false });
  };

  const retryCancellation = () => {
    if (query.isFetching) return;
    const session = getSession();
    session.cycles = 0;
    session.cancellationAttempted = false;
    session.cancellationError = null;
    return query.refetch({ cancelRefetch: false });
  };

  return { ...query, refreshStatus, retryCancellation };
}
