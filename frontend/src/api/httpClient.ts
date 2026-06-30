const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

interface RequestOptions extends RequestInit {
  body?: BodyInit | null;
}

export class HttpError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

async function request<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : "Ocurrió un error inesperado.";

    throw new HttpError(message, response.status, data);
  }

  return data as TResponse;
}

export const httpClient = {
  get: <TResponse>(path: string) =>
    request<TResponse>(path, {
      method: "GET",
    }),

  post: <TResponse, TBody>(path: string, body: TBody) =>
    request<TResponse>(path, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
