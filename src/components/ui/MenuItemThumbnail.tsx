'use client';
import { useEffect, useState } from 'react';
import { CategoryIcon } from './CategoryIcon';

type MenuItemThumbnailProps = {
  image?: string | null;
  categoryName: string;
  alt: string;
  className?: string;
};

export function MenuItemThumbnail({ image, categoryName, alt, className = '' }: MenuItemThumbnailProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [image]);

  if (image && !failed) {
    return (
      <img
        src={image}
        alt={alt}
        className={`object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return <CategoryIcon category={categoryName} className={className} />;
}
