import type {
  ArticleMoveInput,
  ArticleRenameInput,
  ArticleSaveInput,
  ArticleSetArchivedInput,
} from '@/shared/contracts';
import type { ArticleFormAddInput } from '@/shared/contracts/article';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';

export function createArticleApi(repositories: Pick<LibraryDatabaseRepositories, 'articles'>) {
  return {
    listArticles() {
      return repositories.articles.list();
    },

    getArticle(id: string) {
      return repositories.articles.get(id);
    },

    saveArticle(input: ArticleSaveInput) {
      return repositories.articles.save(input);
    },

    addArticleForm(input: ArticleFormAddInput) {
      return repositories.articles.addForm(input);
    },

    renameArticle(input: ArticleRenameInput) {
      return repositories.articles.rename(input);
    },

    moveArticle(input: ArticleMoveInput) {
      return repositories.articles.move(input);
    },

    setArticleArchived(input: ArticleSetArchivedInput) {
      return repositories.articles.setArchived(input);
    },
  };
}
