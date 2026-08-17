'use client';
import { useRef, useState } from 'react';
import { MenuItemThumbnail } from './MenuItemThumbnail';
import { uploadImage } from '@/lib/uploadImage';

type MenuItemThumbnailUploadProps = {
  image?: string | null;
  categoryName: string;
  alt: string;
  onChange: (url: string) => void;
  className?: string;
};

export function MenuItemThumbnailUpload({ image, categoryName, alt, onChange, className = '' }: MenuItemThumbnailUploadProps) {
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
      onChange(await uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`relative shrink-0 ${className}`}>
      <MenuItemThumbnail image={image} categoryName={categoryName} alt={alt} className="w-full h-full rounded-[inherit]" />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelected}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label="Upload photo"
        title="Upload photo"
        className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/0 hover:bg-black/30 transition-colors"
      >
        <span className="absolute -bottom-1.5 -right-1.5 flex items-center justify-center w-6 h-6 rounded-full bg-black/35 backdrop-blur-sm text-white shadow-sm">
          {uploading ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3m0 0-4 4m4-4 4 4" />
              <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
            </svg>
          )}
        </span>
      </button>
      {error && (
        <p role="alert" className="absolute top-full left-0 mt-1 text-warning text-xs font-semibold whitespace-nowrap z-10">
          {error}
        </p>
      )}
    </div>
  );
}
