import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox } from '../src/renderer/components/ui/combobox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../src/renderer/components/ui/command';
import { Kbd, KbdGroup } from '../src/renderer/components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/renderer/components/ui/tabs';
import { hasTruthyJsxAttribute } from './support/source-ast';

const rendererRoot = path.resolve(__dirname, '../src/renderer');

function readRendererFile(relativePath: string) {
  return fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
}

function rendererFiles(directory = rendererRoot): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? rendererFiles(absolute) : [absolute];
  });
}

describe('workbench navigation primitives', () => {
  it('renders searchable command structure with semantic interaction states', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Command,
        { label: 'Search commands' },
        React.createElement(CommandInput, { placeholder: 'Search' }),
        React.createElement(
          CommandList,
          { ariaLabel: 'Command suggestions' },
          React.createElement(CommandEmpty, null, 'Nothing found'),
          React.createElement(
            CommandGroup,
            { heading: 'Models' },
            React.createElement(CommandItem, { value: 'image-model' }, 'Image model'),
          ),
        ),
      ),
    );

    expect(html).toContain('data-slot="command"');
    expect(html).toContain('data-slot="command-input"');
    expect(html).toContain('data-slot="command-list"');
    expect(html).toContain('aria-label="Command suggestions"');
    expect(html).toContain('data-slot="command-item"');
    expect(html).toContain('Search commands');
    const source = readRendererFile('components/ui/command.tsx');
    expect(source).toContain('data-[selected=true]:bg-hover');
    expect(source).toContain('data-[disabled=true]:text-disabled-foreground');
    expect(source).toContain('focus-within:ring-inset');
    expect(source).not.toContain('shadow-');
  });

  it('exposes a controlled searchable combobox trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(Combobox, {
        value: 'v2',
        options: [
          { value: 'v1', label: 'Version 1' },
          { value: 'v2', label: 'Version 2' },
        ],
        onValueChange: () => undefined,
        ariaLabel: 'Version',
        placeholder: 'Choose version',
        searchPlaceholder: 'Search versions',
        emptyText: 'No versions',
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Version"');
    expect(html).toContain('Version 2');

    const source = readRendererFile('components/ui/combobox.tsx');
    expect(hasTruthyJsxAttribute(source, 'Popover', 'modal')).toBe(true);
    expect(source).toContain('<Command label={ariaLabel}>');
    expect(source).toContain('<CommandList ariaLabel={ariaLabel}>');
    expect(source).toContain('bg-selected text-selected-foreground');
    expect(source).toContain('data-[selected=true]:bg-selected');
  });

  it('keeps tabs distinct from segmented controls and provides tab semantics', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Tabs,
        { defaultValue: 'details' },
        React.createElement(
          TabsList,
          null,
          React.createElement(TabsTrigger, { value: 'details' }, 'Details'),
          React.createElement(TabsTrigger, { value: 'rating' }, 'Rating'),
        ),
        React.createElement(TabsContent, { value: 'details' }, 'File details'),
        React.createElement(TabsContent, { value: 'rating' }, 'Image rating'),
      ),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-selected="true"');

    const source = readRendererFile('components/ui/tabs.tsx');
    expect(source).toContain('data-[state=active]:border-selected-foreground');
    expect(source).not.toContain('rounded-full');
    expect(source).not.toContain('shadow-');
  });

  it('builds Sheet as a semantic modal layer', () => {
    const source = readRendererFile('components/ui/sheet.tsx');
    expect(source).toContain('bg-dialog-scrim');
    expect(source).toContain('bg-overlay');
    expect(source).toContain('shadow-dialog');
    expect(source).toContain('rounded-xl');
    expect(source).toContain("side: 'right'");
    expect(source).toContain('sheet-overlay-motion');
    expect(source).toContain('sheet-content-motion');
    expect(source).not.toContain('shadow-2xl');
    expect(source).not.toContain('bg-black');

    const baseStyles = readRendererFile('styles/base.css');
    expect(baseStyles).toContain('animation: sheet-in-right var(--motion-overlay) var(--ease-enter)');
    expect(baseStyles).toContain('animation: sheet-out-right var(--motion-overlay) var(--ease-exit)');
  });

  it('renders native keyboard hints without elevation', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        KbdGroup,
        null,
        React.createElement(Kbd, null, 'Ctrl'),
        React.createElement(Kbd, null, 'Enter'),
      ),
    );
    expect(html).toContain('<kbd');
    expect(html).toContain('data-slot="kbd"');
    expect(html).toContain('font-mono');
    expect(html).toContain('text-2xs');
    expect(html).toContain('tabular-nums');
    expect(html).not.toContain('shadow-');

    const rawKbdFiles = rendererFiles()
      .filter((file) => /\.tsx?$/.test(file) && fs.readFileSync(file, 'utf8').includes('<kbd'))
      .map((file) => path.relative(rendererRoot, file).replaceAll('\\', '/'));
    expect(rawKbdFiles).toEqual(['components/ui/kbd.tsx']);
  });

  it('migrates real workbench interactions to the new primitives', () => {
    const modelSelector = readRendererFile('components/creator/ModelTargetSelector.tsx');
    const comparisonPicker = readRendererFile('components/creator/ComparisonModelPicker.tsx');
    const modelCommand = readRendererFile('components/creator/ModelSelectionCommand.tsx');
    expect(modelSelector).toContain('<ModelSelectionCommand');
    expect(comparisonPicker).toContain('<ModelSelectionCommand');
    expect(hasTruthyJsxAttribute(modelSelector, 'Popover', 'modal')).toBe(true);
    expect(hasTruthyJsxAttribute(comparisonPicker, 'Popover', 'modal')).toBe(true);
    expect(modelSelector).not.toContain('<Checkbox');
    expect(comparisonPicker).not.toContain('<Checkbox');
    expect(modelCommand).toContain('aria-multiselectable="true"');
    expect(modelCommand).toContain('aria-selected={checked}');
    expect(modelCommand).toContain("checked && 'bg-selected text-selected-foreground hover:bg-selected'");
    expect(modelCommand).not.toContain('<CommandItem');

    expect(readRendererFile('components/CreatorScreen.tsx')).toContain('<Combobox');

    const inspector = readRendererFile('components/gallery/MaterialInspector.tsx');
    expect(inspector).toContain('<Sheet');
    expect(inspector).toContain('<Tabs');
    expect(inspector).toContain('bg-media-surround');
    expect(inspector).not.toContain('useNarrowInspector');
    expect(inspector).not.toContain('<details');

    const gallery = readRendererFile('components/GalleryScreen.tsx');
    expect(gallery).not.toContain('grid-cols-[minmax(0,1fr)_minmax(320px,360px)]');
    expect(gallery).toContain('<QuietEmpty');
    expect(gallery).not.toContain('<KbdGroup>');
    expect(gallery).not.toContain('l.pasteHint');

    expect(readRendererFile('components/app/ReturnToMaterialsBar.tsx')).toContain('aria-keyshortcuts="Alt+ArrowLeft"');
    expect(readRendererFile('components/creator/GenerationLauncher.tsx')).toContain(
      'aria-keyshortcuts="Control+Enter Meta+Enter"',
    );
    expect(
      fs.readFileSync(path.resolve(__dirname, '../extensions/com.aiy.language.zh-cn/messages.json'), 'utf8'),
    ).not.toContain('Ctrl+V');
    expect(readRendererFile('i18n/locales/en.ts')).not.toContain('Ctrl+V');
  });

  it('keeps popovers on the E3 overlay contract', () => {
    const source = readRendererFile('components/ui/popover.tsx');
    expect(source).toContain('bg-overlay');
    expect(source).toContain('shadow-overlay');
    expect(source).not.toContain('shadow-md');
    expect(source).not.toContain('bg-popover');
  });
});
