import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";

type RouteHandler<C> = (request: Request, context: C) => Promise<Response>;

export function errorResponse(error: AppError): NextResponse {
  const body = error.details === undefined ? { error: error.message } : { error: error.message, details: error.details };
  return NextResponse.json(body, { status: error.status });
}

/** Wraps a route handler so that AppErrors become JSON error responses. */
export function handle<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof AppError) return errorResponse(error);
      throw error;
    }
  };
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", "Invalid request body", parsed.error.issues);
  }
  return parsed.data;
}

export function parseDocumentId(id: string): string {
  if (!z.uuid().safeParse(id).success) {
    throw new AppError("BAD_REQUEST", "Invalid document id");
  }
  return id;
}
