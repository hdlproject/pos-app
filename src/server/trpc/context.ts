import { cookies } from 'next/headers';
import { db } from '../db';
import { verifySession } from '../auth/session';

export async function createContext() {
  const token = (await cookies()).get('session')?.value;
  const payload = token ? await verifySession(token) : null;

  let user = null;
  if (payload) {
    const dbUser = await db.user.findUnique({ where: { id: payload.userId } });
    if (dbUser && dbUser.active) {
      user = { userId: dbUser.id, role: dbUser.role, name: dbUser.name };
    }
  }

  return { db, user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
