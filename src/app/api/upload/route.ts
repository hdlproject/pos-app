import { createContext } from '@/server/trpc/context';
import { uploadMenuImage } from '@/server/storage';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: Request) {
  const { user } = await createContext();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const url = await uploadMenuImage(bytes, file.name, file.type);
  return Response.json({ url });
}
