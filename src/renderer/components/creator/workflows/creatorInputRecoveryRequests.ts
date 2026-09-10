import type { CreatorInputRecoverySession } from '@/renderer/components/creator/workflows/CreatorInputRecoverySession';

interface RecoveryRequest {
  id: number;
  session: CreatorInputRecoverySession;
}

let nextId = 0;
let requests: RecoveryRequest[] = [];
const listeners = new Set<() => void>();

export const creatorInputRecoveryRequests = {
  getSnapshot: () => requests[0] ?? null,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(session: CreatorInputRecoverySession) {
    if (requests.some((request) => request.session === session)) return;
    requests = [...requests, { id: ++nextId, session }];
    listeners.forEach((listener) => listener());
  },
  dismiss(id: number) {
    requests = requests.filter((request) => request.id !== id);
    listeners.forEach((listener) => listener());
  },
  cancel() {
    requests = [];
    listeners.forEach((listener) => listener());
  },
};
