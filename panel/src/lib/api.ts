"use client";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function api(
  path: string,
  options: { method?: string; body?: unknown; csrf?: boolean } = {}
): Promise<any> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.csrf) {
    const csrf = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("vmp_csrf="));
    if (csrf) headers["x-vmp-csrf"] = csrf.split("=").slice(1).join("=");
  }

  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }

  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data;
}