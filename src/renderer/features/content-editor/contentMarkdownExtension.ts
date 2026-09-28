import { Markdown } from '@tiptap/markdown';
import { ContentMarkdownManager } from '@/shared/content-markdown-manager';
import { Marked, type marked } from 'marked';

export const ContentMarkdownExtension = Markdown.extend({
  onBeforeCreate(event) {
    // Marked's default singleton otherwise accumulates every editor's tokenizers.
    this.options.marked = new Marked() as unknown as typeof marked;
    this.parent?.(event);
    // Keep the official import commands and initialization, with literal-dollar-safe exports.
    this.storage.manager = new ContentMarkdownManager({
      ...this.options,
      marked: new Marked() as unknown as typeof marked,
      extensions: this.editor.extensionManager.baseExtensions,
    });
    this.editor.markdown = this.storage.manager;
  },
});
