'use client';
import { useRef, useState } from 'react';
import { Button } from './Button';
import { MenuItemThumbnail } from './MenuItemThumbnail';

type ImageUploadProps = {
  value: string | null;
  onChange: (url: string | null) => void;
  categoryName: string;
};

export function ImageUpload({ value, onChange, categoryName }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Upload failed');
        return;
      }
      onChange(data.url);
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <MenuItemThumbnail
        image={value}
        categoryName={categoryName}
        alt="Item photo"
        className="w-16 h-16 rounded-xl shrink-0"
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelected}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? 'Uploading…' : value ? 'Change Photo' : 'Upload Photo'}
          </Button>
          {value && (
            <Button variant="outline" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-warning text-xs font-semibold">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
