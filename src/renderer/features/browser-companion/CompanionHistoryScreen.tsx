import { RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BrowserCompanionHistoryItem, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

const TARGET_LABELS = {
  chatgpt: { en: 'ChatGPT', zh: 'ChatGPT' },
  wechat: { en: 'WeChat Official Account', zh: '微信公众号' },
  weibo: { en: 'Weibo', zh: '微博' },
} as const;

function displayTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function CompanionHistoryScreen({
  active,
  locale,
  notify,
}: {
  active: boolean;
  locale: Locale;
  notify(message: string): void;
}) {
  const zh = locale === 'zh';
  const [items, setItems] = useState<BrowserCompanionHistoryItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectedCount = selectedIds.size;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const stateLabels = useMemo(
    () => ({
      ready: zh ? '待交接' : 'Ready',
      claimed: zh ? '填入中' : 'Filling',
      delivered: zh ? '已填入' : 'Delivered',
    }),
    [zh],
  );

  const loadHistory = useStableCallback(async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      const next = await window.desktopApi.browserCompanionHistory();
      setItems(next);
      setSelectedIds(
        (current) => new Set([...current].filter((handoffId) => next.some((item) => item.handoffId === handoffId))),
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    if (active) void loadHistory();
  }, [active, loadHistory]);

  function select(handoffId: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(handoffId);
      else next.delete(handoffId);
      return next;
    });
  }

  async function deleteSelected(): Promise<void> {
    if (deleting || selectedCount === 0) return;
    setDeleting(true);
    try {
      const result = await window.desktopApi.browserCompanionDelete({ handoffIds: [...selectedIds] });
      const deleted = new Set(result.deletedHandoffIds);
      setItems((current) => current.filter((item) => !deleted.has(item.handoffId)));
      setSelectedIds(new Set());
      setConfirmOpen(false);
      notify(
        zh
          ? `已删除 ${result.deletedHandoffIds.length} 条交接记录`
          : `Deleted ${result.deletedHandoffIds.length} handoff records`,
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main data-browser-companion-history className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-5">
        <h1 className="font-semibold">{zh ? 'AIY 伴侣历史' : 'AIY Companion history'}</h1>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={loading || deleting}
            aria-label={zh ? '刷新' : 'Refresh'}
            title={zh ? '刷新' : 'Refresh'}
            onClick={() => void loadHistory()}
          >
            <RefreshCwIcon className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          <Button
            type="button"
            data-action="browser-companion-delete"
            variant="ghost"
            size="sm"
            disabled={selectedCount === 0 || deleting}
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon className="size-4" />
            {zh
              ? `删除${selectedCount ? ` (${selectedCount})` : ''}`
              : `Delete${selectedCount ? ` (${selectedCount})` : ''}`}
          </Button>
        </div>
      </header>

      <ScrollArea type="always" className="min-h-0 flex-1">
        <div className="p-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={zh ? '全选' : 'Select all'}
                    checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                    onCheckedChange={(checked) =>
                      setSelectedIds(checked ? new Set(items.map((item) => item.handoffId)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>{zh ? '内容' : 'Content'}</TableHead>
                <TableHead>{zh ? '目标' : 'Target'}</TableHead>
                <TableHead>{zh ? '类型' : 'Type'}</TableHead>
                <TableHead>{zh ? '状态' : 'Status'}</TableHead>
                <TableHead>{zh ? '时间' : 'Time'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const selected = selectedIds.has(item.handoffId);
                return (
                  <TableRow
                    key={item.handoffId}
                    data-browser-companion-handoff={item.handoffId}
                    aria-selected={selected}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={zh ? '选择交接记录' : 'Select handoff record'}
                        checked={selected}
                        onCheckedChange={(checked) => select(item.handoffId, Boolean(checked))}
                      />
                    </TableCell>
                    <TableCell className="max-w-[42rem] whitespace-normal">
                      <span className="line-clamp-2 break-words" title={item.text}>
                        {item.text}
                      </span>
                    </TableCell>
                    <TableCell>{TARGET_LABELS[item.target][zh ? 'zh' : 'en']}</TableCell>
                    <TableCell>{item.contentKind === 'prompt' ? 'Prompt' : zh ? '贴文正文' : 'Social post'}</TableCell>
                    <TableCell data-handoff-state={item.state}>{stateLabels[item.state]}</TableCell>
                    <TableCell>{displayTime(item.createdAt, locale)}</TableCell>
                  </TableRow>
                );
              })}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {zh ? '暂无交接记录' : 'No handoff history'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {zh ? `删除 ${selectedCount} 条交接记录？` : `Delete ${selectedCount} handoff records?`}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={deleting}>
                {zh ? '取消' : 'Cancel'}
              </Button>
            </DialogClose>
            <Button
              type="button"
              data-action="browser-companion-confirm-delete"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteSelected()}
            >
              {deleting ? (zh ? '删除中' : 'Deleting') : zh ? '删除' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
