import * as React from 'react';
import { cn } from '@/renderer/lib/utils';

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'h-9 border-b transition-colors duration-fast hover:bg-hover data-[state=selected]:bg-selected data-[state=selected]:text-selected-foreground data-[state=selected]:hover:bg-selected aria-selected:bg-selected aria-selected:text-selected-foreground aria-selected:hover:bg-selected',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, numeric = false, ...props }: React.ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-9 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, numeric = false, ...props }: React.ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn('h-9 p-2 align-middle whitespace-nowrap', numeric && 'text-right tabular-nums', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
