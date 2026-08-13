import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'success';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40',
  dark: 'bg-dark-ui text-white hover:bg-dark-ui/90 disabled:bg-dark-ui/40',
  outline: 'bg-surface text-text-muted-2 border border-border-strong hover:bg-surface-input disabled:opacity-50',
  success: 'bg-success text-white hover:bg-success/90 disabled:bg-success/40',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-colors disabled:cursor-not-allowed disabled:pointer-events-none ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
