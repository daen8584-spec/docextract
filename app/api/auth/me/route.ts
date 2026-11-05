import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";

export const GET = handle(async (request: Request) => NextResponse.json(await requireUser(request)));
