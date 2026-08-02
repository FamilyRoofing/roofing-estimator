import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// API error responses are shaped { error: string }. Pull that out for a
// clean toast message instead of showing the raw JSON body to the user.
export async function extractErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) return parsed.error;
    } catch {}
  }
  return text || res.statusText || `Request failed (${res.status})`;
}
