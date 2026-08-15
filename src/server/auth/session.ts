import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;

export interface SessionPayload {
  userId: string;
  role: 'ADMIN' | 'STAFF' | 'KITCHEN';
  name: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    return jwt.verify(token, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}
