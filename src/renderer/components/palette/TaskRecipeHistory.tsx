import type { TaskRecipeSnapshot } from '@/shared/contracts/task-recipe';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

export function TaskRecipeHistory({ recipe }: { recipe: TaskRecipeSnapshot | undefined }) {
  const l = useI18n().messages.recipe.task;
  if (!recipe) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {l.input}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {recipe.name && <strong className="text-sm">{recipe.name}</strong>}
          <p className="whitespace-pre-wrap text-sm">{recipe.instructions || l.defaultMethod}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
