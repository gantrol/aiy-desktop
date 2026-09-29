import { UserProfile } from '@/renderer/features/me/UserProfile';

export default function MeScreen({ spaceName }: { spaceName: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-xl px-6 py-8">
        <UserProfile spaceName={spaceName} />
      </main>
    </div>
  );
}
