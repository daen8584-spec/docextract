import "./load-env";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userRole, users } from "../db/schema";

type Role = (typeof userRole.enumValues)[number];

const isRole = (value: string | undefined): value is Role => userRole.enumValues.includes(value as Role);

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !isRole(role)) {
    console.error(`Usage: npm run user:role -- <email> <${userRole.enumValues.join("|")}>`);
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .update(users)
    .set({ role })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ email: users.email, role: users.role });

  if (!user) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${user.email} is now ${user.role}`);
}

main().finally(() => db.$client.end());
