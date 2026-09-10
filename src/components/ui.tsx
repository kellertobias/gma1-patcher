'use client';

import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react';

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const variants = {
  primary: 'bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-700',
  secondary: 'border border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800',
  quiet: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
};

export function Button({ variant = 'secondary', className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function FileButton({ label, accept, multiple, onFiles, variant = 'secondary' }: {
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  variant?: keyof typeof variants;
}) {
  return (
    <label className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${variants[variant]}`}>
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950 ' +
  'focus:border-amber-500 focus:outline-none';

/** Text input that commits on blur or Enter; Escape reverts. `commit` returns false to reject. */
export function EditCell({ value, commit, className = '', placeholder, title }: {
  value: string;
  commit: (text: string) => boolean;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // the stored value changed (e.g. MVR import): drop the draft
    setShown(value);
    setDraft(value);
    setBad(false);
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      title={title}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={() => {
        if (draft !== value) setBad(!commit(draft));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setBad(false);
        }
      }}
      className={`${inputClass} ${bad ? 'border-red-500 focus:border-red-500' : ''} ${className}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {label}
      {children}
    </label>
  );
}
