import { cookies } from 'next/headers';
import { db } from '../db';
import { verifySession } from '../auth/session';

export async function createContext() {
  const token = (await cookies()).get('session')?.value;
  const user = token ? await verifySession(token) : null;
  return { db, user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
