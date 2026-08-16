import type { InputHTMLAttributes, Ref } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };

export function Input({ className = '', ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      className={`[color-scheme:light] transition-colors focus-visible:border-accent disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
      {...props}
    />
  );
}
