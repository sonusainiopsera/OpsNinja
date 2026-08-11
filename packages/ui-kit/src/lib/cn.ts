import { twMerge } from 'tailwind-merge';

type ClassValue = string | undefined | null | false | 0 | ClassValue[];

function clsx(...inputs: ClassValue[]): string {
  return inputs
    .flat(Infinity as 20)
    .filter(Boolean)
    .join(' ');
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
