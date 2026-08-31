import type { SocialPostMoveInput, SocialPostSaveInput, SocialPostSetArchivedInput } from '@/shared/contracts';
import type { SocialPostFormAddInput, SocialPostFormCreateInput } from '@/shared/contracts/social-post';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';

export function createSocialPostApi(repositories: Pick<LibraryDatabaseRepositories, 'socialPosts'>) {
  return {
    listSocialPosts() {
      return repositories.socialPosts.list();
    },

    saveSocialPost(input: SocialPostSaveInput) {
      return repositories.socialPosts.save(input);
    },

    addSocialPostForm(input: SocialPostFormAddInput) {
      return repositories.socialPosts.addForm(input);
    },

    createSocialPostForm(input: SocialPostFormCreateInput) {
      return repositories.socialPosts.createForm(input);
    },

    moveSocialPost(input: SocialPostMoveInput) {
      return repositories.socialPosts.move(input);
    },

    setSocialPostArchived(input: SocialPostSetArchivedInput) {
      return repositories.socialPosts.setArchived(input);
    },
  };
}
