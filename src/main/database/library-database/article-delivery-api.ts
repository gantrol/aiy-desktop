import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type {
  ArticleDeliveryJobCreateInput,
  ArticleDeliveryJobFailure,
} from '@/main/database/extensions/article-delivery-job-repository';
import type { ArticleDeliveryJobListInput, ArticleDeliveryUploadResult } from '@/shared/contracts/article-delivery';

export function createArticleDeliveryApi(repositories: Pick<LibraryDatabaseRepositories, 'articleDeliveryJobs'>) {
  return {
    enqueueArticleDeliveryJob(input: ArticleDeliveryJobCreateInput) {
      return repositories.articleDeliveryJobs.enqueue(input);
    },

    listArticleDeliveryJobs(input: ArticleDeliveryJobListInput) {
      return repositories.articleDeliveryJobs.list(input);
    },

    nextQueuedArticleDeliveryJob() {
      return repositories.articleDeliveryJobs.nextQueued();
    },

    markArticleDeliveryJobRunning(jobId: string) {
      return repositories.articleDeliveryJobs.markRunning(jobId);
    },

    completeArticleDeliveryJob(jobId: string, result: ArticleDeliveryUploadResult) {
      return repositories.articleDeliveryJobs.succeed(jobId, result);
    },

    failArticleDeliveryJob(jobId: string, failure: ArticleDeliveryJobFailure) {
      return repositories.articleDeliveryJobs.fail(jobId, failure);
    },

    retryArticleDeliveryJob(jobId: string) {
      return repositories.articleDeliveryJobs.retry(jobId);
    },

    recoverArticleDeliveryJobs() {
      return repositories.articleDeliveryJobs.recoverRunning();
    },
  };
}
