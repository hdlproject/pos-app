import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'success';
type ButtonSize = 'md' | 'sm';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  dark: 'bg-dark-ui text-white hover:bg-dark-ui/90 disabled:bg-dark-ui/40',
  outline: 'bg-surface text-text-muted-2 border border-border-strong hover:bg-surface-input disabled:opacity-50',
  success: 'bg-success text-white hover:bg-success/90 disabled:bg-success/40',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'px-4 py-2.5 text-sm',
  sm: 'px-3 py-1.5 text-xs',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={`rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
