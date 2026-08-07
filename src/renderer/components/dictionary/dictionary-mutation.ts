interface DictionaryMutationOptions<T> {
  setPending(pending: boolean): void;
  mutate(): Promise<T>;
  onSuccess(result: T): void | Promise<void>;
  notify(message: string): void;
  fallbackError: string;
}

export function dictionaryMutationError(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return fallback;
}

/** Runs a dictionary write without leaking rejected promises or pending UI state. */
export async function runDictionaryMutation<T>({
  setPending,
  mutate,
  onSuccess,
  notify,
  fallbackError,
}: DictionaryMutationOptions<T>): Promise<boolean> {
  setPending(true);
  try {
    const result = await mutate();
    await onSuccess(result);
    return true;
  } catch (reason) {
    notify(dictionaryMutationError(reason, fallbackError));
    return false;
  } finally {
    setPending(false);
  }
}
