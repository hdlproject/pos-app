import { CategoryIcon } from './CategoryIcon';

type MenuItemThumbnailProps = {
  image?: string | null;
  categoryName: string;
  alt: string;
  className?: string;
};

export function MenuItemThumbnail({ image, categoryName, alt, className = '' }: MenuItemThumbnailProps) {
  if (image) {
    return <img src={image} alt={alt} className={`object-cover ${className}`} />;
  }
  return <CategoryIcon category={categoryName} className={className} />;
}
